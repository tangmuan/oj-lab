import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { optionalAuth } from '../middleware/auth';
import { ah, notFound } from '../utils/errors';
import { canViewProblem, isSubmissionFrozen, loadFrozenWindows, nowSqlUtc, visibleSubmissionCondition } from '../utils/contest';

export const statsRouter = Router();

statsRouter.get(
  '/overview',
  optionalAuth,
  ah(async (req, res) => {
    const one = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...(params as never[])) as { c: number }).c;
    const visible = visibleSubmissionCondition('s', req.user?.id, req.user?.role);
    const publicProblems = (db.prepare(
      `SELECT COUNT(*) AS c FROM problems p
       LEFT JOIN (SELECT cp.problem_id, MIN(c.start_at) AS earliest_start
                 FROM contest_problems cp JOIN contests c ON c.id = cp.contest_id GROUP BY cp.problem_id) cst
         ON cst.problem_id = p.id
       WHERE p.is_public = 1 AND (cst.earliest_start IS NULL OR cst.earliest_start <= ?)`
    ).get(nowSqlUtc()) as { c: number }).c;

    res.json({
      users: one('SELECT COUNT(*) AS c FROM users'),
      problems: publicProblems,
      submissions: one(`SELECT COUNT(*) AS c FROM submissions s WHERE ${visible.sql}`, ...visible.params),
      accepted: one(`SELECT COUNT(*) AS c FROM submissions s WHERE s.status = 'AC' AND ${visible.sql}`, ...visible.params),
      todaySubmissions: one(`SELECT COUNT(*) AS c FROM submissions s WHERE date(s.created_at) = date('now') AND ${visible.sql}`, ...visible.params),
      todayAccepted: one(`SELECT COUNT(*) AS c FROM submissions s WHERE s.status = 'AC' AND date(s.created_at) = date('now') AND ${visible.sql}`, ...visible.params),
    });
  })
);

statsRouter.get(
  '/leaderboard',
  optionalAuth,
  ah(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit ?? 20);
    const visible = visibleSubmissionCondition('s', req.user?.id, req.user?.role);

    const items = db
      .prepare(
        `SELECT u.id, u.username, u.role,
                COUNT(DISTINCT CASE WHEN s.status = 'AC' THEN s.problem_id END) AS solved,
                COUNT(s.id) AS submit_count,
                SUM(CASE WHEN s.status = 'AC' THEN 1 ELSE 0 END) AS ac_count,
                MAX(s.created_at) AS last_submit_at
         FROM users u
         LEFT JOIN submissions s ON s.user_id = u.id AND ${visible.sql}
         GROUP BY u.id
         ORDER BY solved DESC, submit_count ASC, u.id ASC
         LIMIT ?`
      )
      .all(...(visible.params as never[]), limit) as Array<{
      id: number;
      username: string;
      role: string;
      solved: number;
      submit_count: number;
      ac_count: number | null;
      last_submit_at: string | null;
    }>;

    const totalProblems = (db.prepare('SELECT COUNT(*) AS c FROM problems WHERE is_public = 1').get() as { c: number }).c;

    res.json({
      totalProblems,
      items: items.map((it, idx) => ({
        rank: idx + 1,
        ...it,
        ac_count: it.ac_count ?? 0,
        ac_rate: it.submit_count > 0 ? Math.round(((it.ac_count ?? 0) / it.submit_count) * 1000) / 10 : null,
      })),
    });
  })
);

statsRouter.get(
  '/problems/:id',
  optionalAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0 || !canViewProblem(id, req.user?.role)) throw notFound('题目不存在');
    const visible = visibleSubmissionCondition('s', req.user?.id, req.user?.role);
    const rows = db
      .prepare(`SELECT status, COUNT(*) AS c FROM submissions s WHERE s.problem_id = ? AND ${visible.sql} GROUP BY status`)
      .all(id, ...(visible.params as never[])) as { status: string; c: number }[];
    const hiddenCount = visible.sql === '1 = 1'
      ? 0
      : (db.prepare(`SELECT COUNT(*) AS c FROM submissions s WHERE s.problem_id = ? AND NOT (${visible.sql})`)
          .get(id, ...(visible.params as never[])) as { c: number }).c;

    const recentRaw = db
      .prepare(
        `SELECT s.id, s.user_id, s.status, s.language, s.time_ms, s.memory_kb, s.created_at, u.username
         FROM submissions s JOIN users u ON u.id = s.user_id
         WHERE s.problem_id = ? ORDER BY s.id DESC LIMIT 10`
      )
      .all(id) as Array<{
      id: number;
      user_id: number;
      status: string;
      language: string;
      time_ms: number;
      memory_kb: number;
      created_at: string;
      username: string;
    }>;

    // 封榜期语义：他人（含匿名视角）看到的封榜后提交一律打码；本人与管理员不受影响
    const viewer = req.user;
    const windows = viewer?.role === 'admin' ? null : loadFrozenWindows(viewer?.role);
    const recent = windows
      ? recentRaw.map((r) => {
          if (viewer && r.user_id === viewer.id) return r;
          if (!isSubmissionFrozen(windows, id, r.created_at)) return r;
          return { ...r, status: 'HIDDEN', time_ms: 0, memory_kb: 0 };
        })
      : recentRaw;

    const distribution = hiddenCount > 0 ? [...rows, { status: 'HIDDEN', c: hiddenCount }] : rows;
    res.json({ distribution, recent });
  })
);

/**
 * 个人主页统计：热力图按 UTC 日期（和 created_at 的存储口径一致）聚合最近 26 周，
 * 前端只需要把返回的「有提交的日期」铺到网格上，缺口补 0。
 */
statsRouter.get(
  '/users/:id',
  optionalAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('用户不存在');

    const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id) as
      | { id: number; username: string; role: string; created_at: string }
      | undefined;
    if (!user) throw notFound('用户不存在');

    const viewer = req.user;
    const isSelf = viewer?.id === id;
    const visible = visibleSubmissionCondition('s', isSelf ? id : undefined, viewer?.role);

    const agg = db
      .prepare(
        `SELECT COUNT(*) AS submit_count,
                SUM(CASE WHEN s.status = 'AC' THEN 1 ELSE 0 END) AS ac_count,
                COUNT(DISTINCT CASE WHEN s.status = 'AC' THEN s.problem_id END) AS solved
         FROM submissions s WHERE s.user_id = ? AND ${visible.sql}`
      )
      .get(id, ...(visible.params as never[])) as { submit_count: number; ac_count: number | null; solved: number | null };

    const distribution = db
      .prepare(
        `SELECT CASE WHEN ${visible.sql} THEN s.status ELSE 'HIDDEN' END AS status, COUNT(*) AS c
         FROM submissions s WHERE s.user_id = ? GROUP BY status ORDER BY c DESC`
      )
      .all(...(visible.params as never[]), id) as { status: string; c: number }[];

    const calendar = db
      .prepare(
        `SELECT date(created_at) AS date, COUNT(*) AS count
         FROM submissions s
         WHERE s.user_id = ? AND date(s.created_at) >= date('now', '-181 day') AND ${visible.sql}
         GROUP BY date(s.created_at)
         ORDER BY date ASC`
      )
      .all(id, ...(visible.params as never[])) as { date: string; count: number }[];

    const recentRaw = db
      .prepare(
        `SELECT s.id, s.problem_id, p.title AS problem_title, s.language, s.status, s.time_ms, s.memory_kb, s.created_at
         FROM submissions s JOIN problems p ON p.id = s.problem_id
         WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 10`
      )
      .all(id) as Array<{
      id: number;
      problem_id: number;
      problem_title: string;
      language: string;
      status: string;
      time_ms: number;
      memory_kb: number;
      created_at: string;
    }>;

    // 封榜期语义：看别人的主页时，封榜后提交一律打码；本人与管理员不受影响
    const windows = viewer?.role === 'admin' ? null : loadFrozenWindows(viewer?.role);
    const recent = windows && !isSelf
      ? recentRaw.map((r) =>
          isSubmissionFrozen(windows, r.problem_id, r.created_at) ? { ...r, status: 'HIDDEN', time_ms: 0, memory_kb: 0 } : r
        )
      : recentRaw;

    const submitCount = agg.submit_count ?? 0;
    const acCount = agg.ac_count ?? 0;

    res.json({
      user,
      stats: {
        solved: agg.solved ?? 0,
        submitCount,
        acCount,
        acRate: submitCount > 0 ? Math.round((acCount / submitCount) * 1000) / 10 : null,
      },
      distribution,
      calendar,
      recent,
    });
  })
);
