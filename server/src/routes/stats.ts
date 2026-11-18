import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { ah, notFound } from '../utils/errors';

export const statsRouter = Router();

statsRouter.get(
  '/overview',
  ah(async (_req, res) => {
    const one = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...(params as never[])) as { c: number }).c;

    res.json({
      users: one('SELECT COUNT(*) AS c FROM users'),
      problems: one('SELECT COUNT(*) AS c FROM problems WHERE is_public = 1'),
      submissions: one('SELECT COUNT(*) AS c FROM submissions'),
      accepted: one("SELECT COUNT(*) AS c FROM submissions WHERE status = 'AC'"),
      todaySubmissions: one("SELECT COUNT(*) AS c FROM submissions WHERE date(created_at) = date('now')"),
      todayAccepted: one("SELECT COUNT(*) AS c FROM submissions WHERE status = 'AC' AND date(created_at) = date('now')"),
    });
  })
);

statsRouter.get(
  '/leaderboard',
  ah(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit ?? 20);

    const items = db
      .prepare(
        `SELECT u.id, u.username, u.role,
                COUNT(DISTINCT CASE WHEN s.status = 'AC' THEN s.problem_id END) AS solved,
                COUNT(s.id) AS submit_count,
                SUM(CASE WHEN s.status = 'AC' THEN 1 ELSE 0 END) AS ac_count,
                MAX(s.created_at) AS last_submit_at
         FROM users u
         LEFT JOIN submissions s ON s.user_id = u.id
         GROUP BY u.id
         ORDER BY solved DESC, submit_count ASC, u.id ASC
         LIMIT ?`
      )
      .all(limit) as Array<{
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
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = db
      .prepare('SELECT status, COUNT(*) AS c FROM submissions WHERE problem_id = ? GROUP BY status')
      .all(id) as { status: string; c: number }[];

    const recent = db
      .prepare(
        `SELECT s.id, s.status, s.language, s.time_ms, s.memory_kb, s.created_at, u.username
         FROM submissions s JOIN users u ON u.id = s.user_id
         WHERE s.problem_id = ? ORDER BY s.id DESC LIMIT 10`
      )
      .all(id);

    res.json({ distribution: rows, recent });
  })
);

/**
 * 个人主页统计：热力图按 UTC 日期（和 created_at 的存储口径一致）聚合最近 26 周，
 * 前端只需要把返回的「有提交的日期」铺到网格上，缺口补 0。
 */
statsRouter.get(
  '/users/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('用户不存在');

    const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id) as
      | { id: number; username: string; role: string; created_at: string }
      | undefined;
    if (!user) throw notFound('用户不存在');

    const agg = db
      .prepare(
        `SELECT COUNT(*) AS submit_count,
                SUM(CASE WHEN status = 'AC' THEN 1 ELSE 0 END) AS ac_count,
                COUNT(DISTINCT CASE WHEN status = 'AC' THEN problem_id END) AS solved
         FROM submissions WHERE user_id = ?`
      )
      .get(id) as { submit_count: number; ac_count: number | null; solved: number | null };

    const distribution = db
      .prepare('SELECT status, COUNT(*) AS c FROM submissions WHERE user_id = ? GROUP BY status ORDER BY c DESC')
      .all(id) as { status: string; c: number }[];

    const calendar = db
      .prepare(
        `SELECT date(created_at) AS date, COUNT(*) AS count
         FROM submissions
         WHERE user_id = ? AND date(created_at) >= date('now', '-181 day')
         GROUP BY date(created_at)
         ORDER BY date ASC`
      )
      .all(id) as { date: string; count: number }[];

    const recent = db
      .prepare(
        `SELECT s.id, s.problem_id, p.title AS problem_title, s.language, s.status, s.time_ms, s.memory_kb, s.created_at
         FROM submissions s JOIN problems p ON p.id = s.problem_id
         WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 10`
      )
      .all(id);

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
