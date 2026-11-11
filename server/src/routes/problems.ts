import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { optionalAuth } from '../middleware/auth';
import { ProblemRow, TestcaseRow } from '../types';
import { ah, notFound } from '../utils/errors';

export const problemsRouter = Router();

const listQuery = z.object({
  keyword: z.string().trim().max(50).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

problemsRouter.get(
  '/',
  optionalAuth,
  ah(async (req, res) => {
    const { keyword, difficulty, page, pageSize } = listQuery.parse(req.query);
    const isAdmin = req.user?.role === 'admin';

    const where: string[] = [];
    const params: unknown[] = [];
    if (!isAdmin) where.push('p.is_public = 1');
    if (keyword) {
      where.push('(p.title LIKE ? OR p.description LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (difficulty) {
      where.push('p.difficulty = ?');
      params.push(difficulty);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (db.prepare(`SELECT COUNT(*) AS c FROM problems p ${whereSql}`).get(...(params as never[])) as { c: number }).c;

    const items = db
      .prepare(
        `SELECT p.id, p.title, p.difficulty, p.time_limit_ms, p.memory_limit_mb, p.is_public, p.created_at,
                (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id) AS submit_count,
                (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id AND s.status = 'AC') AS ac_count,
                (SELECT COUNT(*) FROM testcases t WHERE t.problem_id = p.id) AS case_count
         FROM problems p ${whereSql}
         ORDER BY p.id ASC
         LIMIT ? OFFSET ?`
      )
      .all(...(params as never[]), pageSize, (page - 1) * pageSize) as Array<
      Pick<ProblemRow, 'id' | 'title' | 'difficulty' | 'time_limit_ms' | 'memory_limit_mb' | 'is_public'> & {
        submit_count: number;
        ac_count: number;
        case_count: number;
      }
    >;

    // 当前用户在列表中的解题状态
    const statusMap: Record<number, { tried: boolean; solved: boolean }> = {};
    if (req.user && items.length > 0) {
      const ids = items.map((i) => i.id);
      const placeholders = ids.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT problem_id, status FROM submissions WHERE user_id = ? AND problem_id IN (${placeholders})`)
        .all(req.user.id, ...(ids as never[])) as { problem_id: number; status: string }[];
      for (const r of rows) {
        const cur = statusMap[r.problem_id] ?? { tried: false, solved: false };
        cur.tried = true;
        if (r.status === 'AC') cur.solved = true;
        statusMap[r.problem_id] = cur;
      }
    }

    res.json({
      items: items.map((i) => ({
        ...i,
        ac_rate: i.submit_count > 0 ? Math.round((i.ac_count / i.submit_count) * 1000) / 10 : null,
        my_status: statusMap[i.id] ?? { tried: false, solved: false },
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
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
      problem,
      samples,
      stats: {
        submitCount: agg.submit_count ?? 0,
        acCount: agg.ac_count ?? 0,
        solvedUsers: agg.solved_users ?? 0,
        acRate: agg.submit_count ? Math.round(((agg.ac_count ?? 0) / agg.submit_count) * 1000) / 10 : null,
      },
      mine,
    });
  })
);
