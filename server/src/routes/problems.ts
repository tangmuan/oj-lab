import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { ProblemRow, TestcaseRow } from '../types';
import { ah, notFound, unauthorized } from '../utils/errors';
import { nowSqlUtc } from '../utils/contest';

/**
 * 题目可见性规则（比赛窗口）：
 *   可见 = is_public = 1，且【不是「挂了比赛但所有关联比赛都未开始」】。
 *   - 管理员永远可见；
 *   - 挂了 ≥1 场比赛、且没有任何一场关联比赛已开赛（start_at <= now 的比赛，
 *     即 running / ended）→ 对普通用户不可见（列表过滤 + 详情 404，不泄露存在性）；
 *   - 只要有任意一场关联比赛已开赛，题目立即恢复可见；
 *   - 不涉及任何比赛的题与旧行为完全一致。
 * 由于 running/ended 都满足 start_at <= now，「全部未开始」等价于 MIN(start_at) > now；
 * 无关联比赛时 MIN 为 NULL，天然不命中隐藏条件。
 */
function hiddenByUpcomingContest(problemId: number, now: string): boolean {
  const row = db
    .prepare(
      `SELECT MIN(c.start_at) AS earliest
       FROM contest_problems cp JOIN contests c ON c.id = cp.contest_id
       WHERE cp.problem_id = ?`
    )
    .get(problemId) as { earliest: string | null };
  return row.earliest !== null && row.earliest > now;
}

export const problemsRouter = Router();

const listQuery = z.object({
  keyword: z.string().trim().max(50).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  tag: z.string().trim().max(30).optional(),
  /** 1 = 只看我收藏的，需要登录 */
  favorite: z.coerce.number().int().min(0).max(1).default(0),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

type ProblemListRow = Pick<
  ProblemRow,
  'id' | 'title' | 'difficulty' | 'time_limit_ms' | 'memory_limit_mb' | 'is_public' | 'created_at'
> & {
  submit_count: number;
  ac_count: number;
  case_count: number;
  tag_names: string;
  favorited: number;
};

/** tag_names 来自 json_group_array，理论上永远是合法 JSON；坏数据不该让整个列表 500 */
function parseTags(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 列表统计不再用「每行三个相关子查询」，改成三张预聚合派生表 JOIN 一次；
 * 每个派生表按 problem_id 唯一，不会像直接 JOIN 明细表那样把计数放大。
 */
const LIST_FROM = `
  FROM problems p
  LEFT JOIN (
    SELECT problem_id, COUNT(*) AS submit_count, SUM(CASE WHEN status = 'AC' THEN 1 ELSE 0 END) AS ac_count
    FROM submissions GROUP BY problem_id
  ) agg ON agg.problem_id = p.id
  LEFT JOIN (
    SELECT problem_id, COUNT(*) AS case_count FROM testcases GROUP BY problem_id
  ) tc ON tc.problem_id = p.id
  LEFT JOIN (
    SELECT pt.problem_id, json_group_array(tg.name) AS tag_names
    FROM problem_tags pt JOIN tags tg ON tg.id = pt.tag_id
    GROUP BY pt.problem_id
  ) tagagg ON tagagg.problem_id = p.id
  LEFT JOIN favorites fav ON fav.problem_id = p.id AND fav.user_id = ?
`;

/**
 * 比赛窗口聚合：每个 problem_id 一行，earliest_start = 最早开赛的关联比赛时间（无关联比赛为 NULL）。
 * 与 hiddenByUpcomingContest 是同一条规则：earliest_start > 当前时间 ⟺ 所有关联比赛都未开赛 → 隐藏。
 * 计数查询与列表查询共用，保证分页 total 与过滤结果一致。
 */
const CONTEST_AGG = `
  LEFT JOIN (
    SELECT cp.problem_id, MIN(c.start_at) AS earliest_start
    FROM contest_problems cp JOIN contests c ON c.id = cp.contest_id
    GROUP BY cp.problem_id
  ) cst ON cst.problem_id = p.id
`;

problemsRouter.get(
  '/',
  optionalAuth,
  ah(async (req, res) => {
    const { keyword, difficulty, tag, favorite, page, pageSize } = listQuery.parse(req.query);
    const isAdmin = req.user?.role === 'admin';
    // 未登录时用 -1 做 JOIN 条件，永远不会命中任何收藏
    const viewerId = req.user?.id ?? -1;

    if (favorite === 1 && !req.user) throw unauthorized('登录后才能查看收藏');

    const where: string[] = [];
    const params: unknown[] = [];
    const now = nowSqlUtc();
    if (!isAdmin) {
      where.push('p.is_public = 1');
      // 挂了比赛但全部未开赛的题：列表里直接过滤，不泄露标题与存在性。
      // 这是「保留」条件：无关联比赛（earliest_start 为 NULL）或已有比赛开赛 → 保留
      where.push('(cst.earliest_start IS NULL OR cst.earliest_start <= ?)');
      params.push(now);
    }
    if (keyword) {
      where.push('(p.title LIKE ? OR p.description LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (difficulty) {
      where.push('p.difficulty = ?');
      params.push(difficulty);
    }
    if (tag) {
      where.push(
        'EXISTS (SELECT 1 FROM problem_tags pt2 JOIN tags tg2 ON tg2.id = pt2.tag_id WHERE pt2.problem_id = p.id AND tg2.name = ?)'
      );
      params.push(tag);
    }
    if (favorite === 1) where.push('fav.user_id IS NOT NULL');

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS c
           FROM problems p
           ${CONTEST_AGG}
           LEFT JOIN favorites fav ON fav.problem_id = p.id AND fav.user_id = ?
           ${whereSql}`
        )
        .get(viewerId, ...(params as never[])) as { c: number }
    ).c;

    const rows = db
      .prepare(
        `SELECT p.id, p.title, p.difficulty, p.time_limit_ms, p.memory_limit_mb, p.is_public, p.created_at,
                COALESCE(agg.submit_count, 0) AS submit_count,
                COALESCE(agg.ac_count, 0) AS ac_count,
                COALESCE(tc.case_count, 0) AS case_count,
                COALESCE(tagagg.tag_names, '[]') AS tag_names,
                CASE WHEN fav.user_id IS NULL THEN 0 ELSE 1 END AS favorited
         ${LIST_FROM}
         ${CONTEST_AGG}
         ${whereSql}
         ORDER BY p.id ASC
         LIMIT ? OFFSET ?`
      )
      .all(viewerId, ...(params as never[]), pageSize, (page - 1) * pageSize) as ProblemListRow[];

    // 当前用户在列表中的解题状态
    const statusMap: Record<number, { tried: boolean; solved: boolean }> = {};
    if (req.user && rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const solved = db
        .prepare(`SELECT problem_id, status FROM submissions WHERE user_id = ? AND problem_id IN (${placeholders})`)
        .all(req.user.id, ...(ids as never[])) as { problem_id: number; status: string }[];
      for (const r of solved) {
        const cur = statusMap[r.problem_id] ?? { tried: false, solved: false };
        cur.tried = true;
        if (r.status === 'AC') cur.solved = true;
        statusMap[r.problem_id] = cur;
      }
    }

    res.json({
      items: rows.map((r) => ({
        ...r,
        tags: parseTags(r.tag_names),
        favorited: r.favorited === 1,
        ac_rate: r.submit_count > 0 ? Math.round((r.ac_count / r.submit_count) * 1000) / 10 : null,
        my_status: statusMap[r.id] ?? { tried: false, solved: false },
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  })
);

/** 标签云：必须放在 /:id 之前，否则 tags 会被当成题目 id */
problemsRouter.get(
  '/tags',
  ah(async (_req, res) => {
    const items = db
      .prepare(
        `SELECT tg.name, COUNT(pt.problem_id) AS count
         FROM tags tg LEFT JOIN problem_tags pt ON pt.tag_id = tg.id
         GROUP BY tg.id
         ORDER BY count DESC, tg.name ASC`
      )
      .all();
    res.json({ items });
  })
);

problemsRouter.get(
  '/:id',
  optionalAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('题目不存在');

    const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(id) as ProblemRow | undefined;
    if (!problem) throw notFound('题目不存在');
    if (problem.is_public !== 1 && req.user?.role !== 'admin') throw notFound('题目不存在');
    // 挂了比赛且全部未开赛 → 与私有题同等对待，404 且文案一致，不泄露存在性
    if (req.user?.role !== 'admin' && hiddenByUpcomingContest(id, nowSqlUtc())) throw notFound('题目不存在');

    const samples = db
      .prepare('SELECT id, input, expected_output, ord FROM testcases WHERE problem_id = ? AND is_sample = 1 ORDER BY ord ASC, id ASC')
      .all(id) as Pick<TestcaseRow, 'id' | 'input' | 'expected_output' | 'ord'>[];

    const agg = db
      .prepare(
        `SELECT COUNT(*) AS submit_count,
                SUM(CASE WHEN status = 'AC' THEN 1 ELSE 0 END) AS ac_count,
                COUNT(DISTINCT CASE WHEN status = 'AC' THEN user_id END) AS solved_users
         FROM submissions WHERE problem_id = ?`
      )
      .get(id) as { submit_count: number; ac_count: number; solved_users: number };

    const tags = db
      .prepare('SELECT tg.name FROM tags tg JOIN problem_tags pt ON pt.tag_id = tg.id WHERE pt.problem_id = ? ORDER BY tg.name ASC')
      .all(id) as { name: string }[];

    const favorited = req.user
      ? !!db.prepare('SELECT 1 AS hit FROM favorites WHERE user_id = ? AND problem_id = ?').get(req.user.id, id)
      : false;

    let mine = { submitCount: 0, lastStatus: null as string | null, solved: false };
    if (req.user) {
      const rows = db
        .prepare('SELECT status FROM submissions WHERE user_id = ? AND problem_id = ? ORDER BY id DESC')
        .all(req.user.id, id) as { status: string }[];
      mine = {
        submitCount: rows.length,
        lastStatus: rows[0]?.status ?? null,
        solved: rows.some((r) => r.status === 'AC'),
      };
    }

    res.json({
      // checker 代码是评测逻辑，不能下发给学生（能据此构造答案），只给一个标记
      problem: { ...problem, checker_code: undefined, checker_language: undefined, specialJudge: !!problem.checker_code },
      samples,
      stats: {
        submitCount: agg.submit_count ?? 0,
        acCount: agg.ac_count ?? 0,
        solvedUsers: agg.solved_users ?? 0,
        acRate: agg.submit_count ? Math.round(((agg.ac_count ?? 0) / agg.submit_count) * 1000) / 10 : null,
      },
      mine,
      tags: tags.map((t) => t.name),
      favorited,
    });
  })
);

problemsRouter.post(
  '/:id/favorite',
  requireAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('题目不存在');
    const exists = db.prepare('SELECT id FROM problems WHERE id = ?').get(id);
    if (!exists) throw notFound('题目不存在');

    db.prepare('INSERT OR IGNORE INTO favorites (user_id, problem_id) VALUES (?, ?)').run(req.user!.id, id);
    res.json({ favorited: true });
  })
);

problemsRouter.delete(
  '/:id/favorite',
  requireAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('题目不存在');

    db.prepare('DELETE FROM favorites WHERE user_id = ? AND problem_id = ?').run(req.user!.id, id);
    res.json({ favorited: false });
  })
);
