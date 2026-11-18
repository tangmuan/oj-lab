import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { enqueueSubmission, judgeEvents } from '../judge';
import type { FirstDiff } from '../judge/comparator';
import { isLanguageId } from '../judge/languages';
import { authenticateStream, optionalAuth, requireAuth } from '../middleware/auth';
import { ProblemRow, SubmissionCaseRow, SubmissionRow } from '../types';
import { ah, AppError, forbidden, notFound, unauthorized } from '../utils/errors';
import { issueStreamTicket } from '../utils/streamTickets';
import { nowSqlUtc } from '../utils/contest';

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
    if (problem.is_public !== 1 && user.role !== 'admin') throw notFound('题目不存在');

    const last = db
      .prepare("SELECT strftime('%s','now') - strftime('%s', created_at) AS age FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(user.id) as { age: number } | undefined;
    const cooldown = config.submitCooldownSec;
    if (last && last.age < cooldown) {
      throw new AppError(`提交过于频繁，请 ${cooldown - last.age} 秒后再试`, 429, 'TOO_MANY_REQUESTS');
    }

    const info = db
      .prepare('INSERT INTO submissions (user_id, problem_id, language, code, status) VALUES (?,?,?,?,?)')
      .run(user.id, problemId, language, code, 'PENDING');

    const id = Number(info.lastInsertRowid);
    enqueueSubmission(id);

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

    const items = db
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
      .all(...(params as never[]), q.pageSize, (q.page - 1) * q.pageSize);

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

    res.json({ ticket: issueStreamTicket(req.user!.id, id), expiresIn: 60 });
  })
);

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

    // 收尾必须只做一次：done 主动结束时与客户端断开时都会走到这里
    const cleanup = (): void => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      judgeEvents.off(`sub:${id}`, listener);
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

    const listener = (payload: unknown): void => {
      if (closed) return;
      send(payload);
      // 判题已收尾，服务端主动断流，客户端不必再等心跳或依赖自己 close
      if ((payload as { type?: string }).type === 'done') finish();
    };

    const cases = db
      .prepare(
        'SELECT case_index, status, time_ms, memory_kb, is_sample, message FROM submission_cases WHERE submission_id = ? ORDER BY case_index ASC'
      )
      .all(id) as Pick<SubmissionCaseRow, 'case_index' | 'status' | 'time_ms' | 'memory_kb' | 'is_sample' | 'message'>[];

    send({ type: 'snapshot', submissionId: id, status: sub.status, cases });

    if (!['PENDING', 'JUDGING'].includes(sub.status)) {
      send({ type: 'done', submissionId: id, status: sub.status });
      finish();
      return;
    }

    judgeEvents.on(`sub:${id}`, listener);
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
