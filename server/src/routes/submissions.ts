import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { enqueueSubmission } from '../judge/queue';
import type { FirstDiff } from '../judge/comparator';
import { isLanguageId } from '../judge/languages';
import { authenticateStream, optionalAuth, requireAuth } from '../middleware/auth';
import { ProblemRow, SubmissionCaseRow, SubmissionRow } from '../types';
import { ah, AppError, forbidden, notFound, unauthorized } from '../utils/errors';
import { issueStreamTicket } from '../utils/streamTickets';
import { canSubmitToProblem, canViewProblem, nowSqlUtc, isSubmissionFrozen, loadFrozenWindows } from '../utils/contest';
import { consumeRateLimit } from '../utils/requestLimits';

export const submissionsRouter = Router();

const createSchema = z.object({
  problemId: z.coerce.number().int().positive('题目 ID 不合法'),
  language: z.string().refine(isLanguageId, '不支持的语言'),
  code: z.string().min(1, '代码不能为空').max(65536, '代码不能超过 64KB'),
});

const listQuery = z.object({
  mine: z.coerce.number().int().default(0),
  problemId: z.coerce.number().int().positive().optional(),
  /** 查看指定用户（仅本人或管理员），用于「与上次提交对比」定位同一人的历史记录 */
  userId: z.coerce.number().int().positive().optional(),
  /** 只看 id 小于该值的记录，避免翻页找「上一条」 */
  beforeId: z.coerce.number().int().positive().optional(),
  status: z.string().max(10).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});



submissionsRouter.post(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const { problemId, language, code } = createSchema.parse(req.body);
    const user = req.user!;

    const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId) as ProblemRow | undefined;
    if (!problem) throw notFound('题目不存在');
    if (!canSubmitToProblem(problemId, user.role)) throw notFound('题目不存在');

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ipLimit = consumeRateLimit(`submit-ip:${ip}`, 10 * 60_000, 30);
    if (!ipLimit.allowed) throw new AppError(`提交请求过多，请 ${ipLimit.retryAfterSec} 秒后再试`, 429, 'TOO_MANY_REQUESTS');

    const id = db.transaction(() => {
      const last = db
        .prepare("SELECT strftime('%s','now') - strftime('%s', created_at) AS age FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1")
        .get(user.id) as { age: number } | undefined;
      const cooldown = config.submitCooldownSec;
      if (last && last.age < cooldown) {
        throw new AppError(`提交过于频繁，请 ${cooldown - last.age} 秒后再试`, 429, 'TOO_MANY_REQUESTS');
      }
      const queued = (db.prepare('SELECT COUNT(*) AS c FROM judge_queue').get() as { c: number }).c;
      if (queued >= config.maxQueueSize) throw new AppError('判题队列已满，请稍后重试', 429, 'TOO_MANY_REQUESTS');
      const info = db
        .prepare('INSERT INTO submissions (user_id, problem_id, language, code, status) VALUES (?,?,?,?,?)')
        .run(user.id, problemId, language, code, 'PENDING');
      const submissionId = Number(info.lastInsertRowid);
      enqueueSubmission(submissionId);
      return submissionId;
    })();

    res.status(201).json({ id, status: 'PENDING' });
  })
);

submissionsRouter.get(
  '/',
  optionalAuth,
  ah(async (req, res) => {
    const q = listQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];

    if (req.user?.role !== 'admin') {
      where.push(`EXISTS (
        SELECT 1 FROM problems vp WHERE vp.id = s.problem_id AND vp.is_public = 1
          AND NOT EXISTS (
            SELECT 1 FROM contest_problems cp JOIN contests c ON c.id = cp.contest_id
            WHERE cp.problem_id = s.problem_id
            GROUP BY cp.problem_id HAVING MIN(c.start_at) > ?
          )
      )`);
      const now = nowSqlUtc();
      params.push(now);
    }

    if (q.mine === 1) {
      if (!req.user) throw new AppError('请先登录', 401, 'UNAUTHORIZED');
      where.push('s.user_id = ?');
      params.push(req.user.id);
    } else if (q.userId) {
      // 看别人的提交只允许管理员，前端隐藏按钮不算数
      if (!req.user) throw unauthorized();
      if (req.user.id !== q.userId && req.user.role !== 'admin') throw forbidden('只能查看自己的提交');
      where.push('s.user_id = ?');
      params.push(q.userId);
    }
    if (q.beforeId) {
      where.push('s.id < ?');
      params.push(q.beforeId);
    }
    if (q.problemId) {
      where.push('s.problem_id = ?');
      params.push(q.problemId);
    }
    if (q.status) {
      where.push('s.status = ?');
      params.push(q.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (db.prepare(`SELECT COUNT(*) AS c FROM submissions s ${whereSql}`).get(...(params as never[])) as { c: number }).c;

    interface SubmissionListItem {
      id: number;
      user_id: number;
      problem_id: number;
      language: string;
      status: string;
      time_ms: number;
      memory_kb: number;
      pass_count: number;
      total_count: number;
      created_at: string;
      username: string;
      problem_title: string;
    }

    const rows = db
      .prepare(
        `SELECT s.id, s.user_id, s.problem_id, s.language, s.status, s.time_ms, s.memory_kb,
                s.pass_count, s.total_count, s.created_at, u.username, p.title AS problem_title
         FROM submissions s
         JOIN users u ON u.id = s.user_id
         JOIN problems p ON p.id = s.problem_id
         ${whereSql}
         ORDER BY s.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...(params as never[]), q.pageSize, (q.page - 1) * q.pageSize) as SubmissionListItem[];

    // 封榜期语义：非本人（含匿名）看到的他人封榜后提交一律打码；本人与管理员不受影响。
    // 封榜窗口一次性查出（Map），不在循环里逐条回表。
    const windows = req.user?.role === 'admin' ? null : loadFrozenWindows(req.user?.role);
    const items = windows
      ? rows.map((r) => {
          if (req.user && r.user_id === req.user.id) return r;
          if (!isSubmissionFrozen(windows, r.problem_id, r.created_at)) return r;
          return { ...r, status: 'HIDDEN', time_ms: 0, memory_kb: 0, pass_count: 0 };
        })
      : rows;

    res.json({ items, page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
  })
);

function loadSubmission(id: number): SubmissionRow {
  const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as SubmissionRow | undefined;
  if (!sub) throw notFound('提交记录不存在');
  return sub;
}

type CaseSummary = Pick<SubmissionCaseRow, 'case_index' | 'status' | 'time_ms' | 'memory_kb' | 'is_sample' | 'message'>;

/**
 * submission_cases 表不新增列，差异定位只存在 submissions.detail 的 JSON 里；
 * 旧提交没有该字段，统一补 null，前端据此决定是否展示差异块。
 */
function attachFirstDiffs(sub: SubmissionRow, rows: CaseSummary[]): Array<CaseSummary & { first_diff: FirstDiff | null }> {
  const diffs = new Map<number, FirstDiff | null>();
  if (sub.detail) {
    try {
      const parsed = JSON.parse(sub.detail) as Array<{ caseIndex?: number; firstDiff?: FirstDiff | null }>;
      for (const item of parsed) {
        if (typeof item.caseIndex === 'number') diffs.set(item.caseIndex, item.firstDiff ?? null);
      }
    } catch {
      /* detail 是历史遗留字段，格式坏了就当没有差异信息，不影响查看结果 */
    }
  }
  return rows.map((c) => ({ ...c, first_diff: diffs.get(c.case_index) ?? null }));
}

submissionsRouter.get(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('提交记录不存在');

    const sub = loadSubmission(id);
    if (!canViewProblem(sub.problem_id, req.user!.role)) throw notFound('提交记录不存在');
    // 比赛进行中，别人的提交详情（代码/用例/差异）可能泄题，一律拒绝
    if (sub.user_id !== req.user!.id && req.user!.role !== 'admin') {
      const inRunningContest = db
        .prepare(
          `SELECT 1 AS hit FROM contests c JOIN contest_problems cp ON cp.contest_id = c.id
           WHERE cp.problem_id = ? AND c.start_at <= ? AND c.end_at > ? LIMIT 1`
        )
        .get(sub.problem_id, sub.created_at, nowSqlUtc());
      if (inRunningContest) throw forbidden('比赛进行中，无法查看他人的提交详情');
    }

    const canSeeCode = sub.user_id === req.user!.id || req.user!.role === 'admin';
    const caseRows = db
      .prepare('SELECT case_index, status, time_ms, memory_kb, is_sample, message FROM submission_cases WHERE submission_id = ? ORDER BY case_index ASC')
      .all(id) as CaseSummary[];
    const cases = attachFirstDiffs(sub, caseRows);

    const problem = db.prepare('SELECT id, title FROM problems WHERE id = ?').get(sub.problem_id) as { id: number; title: string };
    const owner = db.prepare('SELECT username FROM users WHERE id = ?').get(sub.user_id) as { username: string };

    res.json({
      submission: {
        ...sub,
        code: canSeeCode ? sub.code : '',
        codeHidden: !canSeeCode,
        username: owner.username,
        problemTitle: problem?.title ?? '',
      },
      cases,
    });
  })
);

/**
 * 换取 SSE 入场券：把 JWT 从 URL 上挪走，避免长期凭证落进浏览器历史、
 * 反向代理访问日志和 Referer。票据 60 秒有效且只能用一次。
 */
submissionsRouter.post(
  '/:id/stream-ticket',
  requireAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('提交记录不存在');

    const sub = db.prepare('SELECT user_id FROM submissions WHERE id = ?').get(id) as
      | Pick<SubmissionRow, 'user_id'>
      | undefined;
    if (!sub) throw notFound('提交记录不存在');
    if (sub.user_id !== req.user!.id && req.user!.role !== 'admin') throw forbidden('无权查看该提交');

    res.json({ ticket: issueStreamTicket(req.user!.id, `sub:${id}`), expiresIn: 60 });
  })
);

/** first_diff 列存的是 JSON 字符串，空值为 NULL；坏数据按缺失处理不让流断掉 */
function parseDiff(raw: string | null): FirstDiff | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FirstDiff;
  } catch {
    return null;
  }
}

const LIVE_CASE_SQL =
  'SELECT case_index, status, time_ms, memory_kb, is_sample, message, first_diff FROM submission_cases WHERE submission_id = ?';

submissionsRouter.get(
  '/:id/stream',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('提交记录不存在');

    const user = authenticateStream(req, id);
    if (!user) throw unauthorized('判题数据连接已失效，请重新提交后再试');

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as SubmissionRow | undefined;
    if (!sub) throw notFound('提交记录不存在');
    if (sub.user_id !== user.id && user.role !== 'admin') throw forbidden('无权查看该提交');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    let heartbeat: NodeJS.Timeout | null = null;
    let pollTimer: NodeJS.Timeout | null = null;

    // 收尾必须只做一次：done 主动结束时与客户端断开时都会走到这里
    const cleanup = (): void => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const finish = (): void => {
      if (closed) return;
      closed = true;
      cleanup();
      if (!res.writableEnded) res.end();
    };

    const send = (payload: unknown): void => {
      if (closed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    /**
     * 判题已经拆到独立 worker 进程，同进程 EventEmitter 收不到了；
     * 改为轮询库里的增量（逐点结果行 + 提交状态），事件 payload 与旧实现逐字段一致。
     */
    const caseRows = db.prepare(`${LIVE_CASE_SQL} ORDER BY case_index ASC`).all(id) as Array<
      Pick<SubmissionCaseRow, 'case_index' | 'status' | 'time_ms' | 'memory_kb' | 'is_sample' | 'message'> & { first_diff: string | null }
    >;
    const cases = caseRows.map((c) => ({ ...c, first_diff: parseDiff(c.first_diff) }));

    send({ type: 'snapshot', submissionId: id, status: sub.status, cases });

    const toDone = (row: SubmissionRow): void => {
      send({
        type: 'done',
        submissionId: id,
        status: row.status,
        timeMs: row.time_ms,
        memoryKb: row.memory_kb,
        passCount: row.pass_count,
        totalCount: row.total_count,
        compileMsg: row.compile_msg,
      });
      finish();
    };

    if (!['PENDING', 'JUDGING'].includes(sub.status)) {
      toDone(sub);
      return;
    }

    let lastCaseIndex = cases.length > 0 ? cases[cases.length - 1].case_index : 0;
    let lastStatus = sub.status;

    pollTimer = setInterval(() => {
      if (closed) return;
      const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as SubmissionRow | undefined;
      if (!row) {
        finish();
        return;
      }
      if (row.status !== lastStatus) {
        lastStatus = row.status;
        send({ type: 'status', submissionId: id, status: row.status });
      }
      const fresh = db.prepare(`${LIVE_CASE_SQL} AND case_index > ? ORDER BY case_index ASC`).all(id, lastCaseIndex) as Array<
        Pick<SubmissionCaseRow, 'case_index' | 'status' | 'time_ms' | 'memory_kb' | 'is_sample' | 'message'> & { first_diff: string | null }
      >;
      for (const c of fresh) {
        send({
          type: 'case',
          submissionId: id,
          case: {
            case_index: c.case_index,
            status: c.status,
            time_ms: c.time_ms,
            memory_kb: c.memory_kb,
            is_sample: c.is_sample,
            message: c.message,
            first_diff: parseDiff(c.first_diff),
          },
        });
        lastCaseIndex = c.case_index;
      }
      // 终态：补完剩余用例事件再收流，保证前端案例列表完整
      if (!['PENDING', 'JUDGING'].includes(row.status)) toDone(row);
    }, 300);

    heartbeat = setInterval(() => {
      if (!closed && !res.writableEnded) res.write(': ping\n\n');
    }, 15000);

    res.on('close', () => {
      closed = true;
      cleanup();
    });
  })
);

/** 撤销权限检查用，保持 403 语义一致 */
export function assertOwner(sub: SubmissionRow, userId: number, role: string): void {
  if (sub.user_id !== userId && role !== 'admin') throw forbidden();
}
