import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { enqueueSubmission } from '../judge';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { ProblemRow, TestcaseRow } from '../types';
import { ah, notFound } from '../utils/errors';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

const testcaseSchema = z.object({
  input: z.string().max(200000).default(''),
  expected_output: z.string().max(200000).default(''),
  is_sample: z.coerce.number().int().min(0).max(1).default(0),
  ord: z.coerce.number().int().min(0).default(0),
});

const problemSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(120, '标题过长'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
  description: z.string().max(50000).default(''),
  input_format: z.string().max(5000).default(''),
  output_format: z.string().max(5000).default(''),
  hint: z.string().max(5000).default(''),
  time_limit_ms: z.coerce.number().int().min(100, '时间限制至少 100ms').max(20000).default(1000),
  memory_limit_mb: z.coerce.number().int().min(16, '内存限制至少 16MB').max(1024).default(256),
  is_public: z.coerce.number().int().min(0).max(1).default(1),
});

function loadProblem(id: number): ProblemRow {
  const p = db.prepare('SELECT * FROM problems WHERE id = ?').get(id) as ProblemRow | undefined;
  if (!p) throw notFound('题目不存在');
  return p;
}

/* ---------------- 提交管理（必须放在 /:id 之前） ---------------- */

adminRouter.get(
  '/submissions',
  ah(async (req, res) => {
    const q = z
      .object({
        problemId: z.coerce.number().int().positive().optional(),
        userId: z.coerce.number().int().positive().optional(),
        status: z.string().max(10).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);

    const where: string[] = [];
    const params: unknown[] = [];
    if (q.problemId) {
      where.push('s.problem_id = ?');
      params.push(q.problemId);
    }
    if (q.userId) {
      where.push('s.user_id = ?');
      params.push(q.userId);
    }
    if (q.status) {
      where.push('s.status = ?');
      params.push(q.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (db.prepare(`SELECT COUNT(*) AS c FROM submissions s ${whereSql}`).get(...(params as never[])) as { c: number }).c;
    const items = db
      .prepare(
        `SELECT s.id, s.status, s.language, s.time_ms, s.memory_kb, s.pass_count, s.total_count, s.created_at,
                u.username, p.title AS problem_title, s.problem_id, s.user_id
         FROM submissions s JOIN users u ON u.id = s.user_id JOIN problems p ON p.id = s.problem_id
         ${whereSql} ORDER BY s.id DESC LIMIT ? OFFSET ?`
      )
      .all(...(params as never[]), q.pageSize, (q.page - 1) * q.pageSize);

    res.json({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
  })
);

adminRouter.post(
  '/submissions/:id/rejudge',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const sub = db.prepare('SELECT id FROM submissions WHERE id = ?').get(id);
    if (!sub) throw notFound('提交记录不存在');

    db.transaction(() => {
      db.prepare('DELETE FROM submission_cases WHERE submission_id = ?').run(id);
      db.prepare(
        "UPDATE submissions SET status = 'PENDING', time_ms = 0, memory_kb = 0, pass_count = 0, total_count = 0, compile_msg = NULL, detail = NULL, judged_at = NULL WHERE id = ?"
      ).run(id);
    })();

    enqueueSubmission(id);
    res.json({ ok: true, id, status: 'PENDING' });
  })
);

/* ---------------- 测试点 ---------------- */

adminRouter.put(
  '/testcases/:tid',
  ah(async (req, res) => {
    const tid = Number(req.params.tid);
    const tc = db.prepare('SELECT * FROM testcases WHERE id = ?').get(tid) as TestcaseRow | undefined;
    if (!tc) throw notFound('测试点不存在');

    const data = testcaseSchema.partial().parse(req.body);
    const keys = Object.keys(data) as (keyof typeof data)[];
    if (keys.length > 0) {
      const setSql = keys.map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE testcases SET ${setSql} WHERE id = ?`).run(...keys.map((k) => data[k] as never), tid);
    }
    res.json({ testcase: db.prepare('SELECT * FROM testcases WHERE id = ?').get(tid) });
  })
);

adminRouter.delete(
  '/testcases/:tid',
  ah(async (req, res) => {
    const tid = Number(req.params.tid);
    db.prepare('DELETE FROM testcases WHERE id = ?').run(tid);
    res.json({ ok: true });
  })
);

/* ---------------- 用户 ---------------- */

adminRouter.get(
  '/users',
  ah(async (_req, res) => {
    const items = db
      .prepare(
        `SELECT u.id, u.username, u.role, u.created_at,
                (SELECT COUNT(*) FROM submissions s WHERE s.user_id = u.id) AS submit_count,
                (SELECT COUNT(DISTINCT problem_id) FROM submissions s WHERE s.user_id = u.id AND s.status = 'AC') AS solved
         FROM users u ORDER BY u.id ASC`
      )
      .all();
    res.json({ items });
  })
);

adminRouter.patch(
  '/users/:id/role',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const { role } = z.object({ role: z.enum(['user', 'admin']) }).parse(req.body);
    if (req.user!.id === id) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '不能修改自己的角色' } });
      return;
    }
    const info = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    if (info.changes === 0) throw notFound('用户不存在');
    res.json({ ok: true });
  })
);

/* ---------------- 题目 ---------------- */

adminRouter.get(
  '/problems',
  ah(async (_req, res) => {
    const items = db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM testcases t WHERE t.problem_id = p.id) AS case_count,
                (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id) AS submit_count
         FROM problems p ORDER BY p.id DESC`
      )
      .all();
    res.json({ items });
  })
);

adminRouter.get(
  '/problems/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const problem = loadProblem(id);
    const testcases = db
      .prepare('SELECT * FROM testcases WHERE problem_id = ? ORDER BY is_sample DESC, ord ASC, id ASC')
      .all(id);
    res.json({ problem, testcases });
  })
);

adminRouter.post(
  '/problems',
  ah(async (req, res) => {
    const { testcases, ...data } = problemSchema.extend({ testcases: z.array(testcaseSchema).max(60).optional() }).parse(req.body);

    const info = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO problems (title, difficulty, description, input_format, output_format, hint, time_limit_ms, memory_limit_mb, is_public)
           VALUES (@title, @difficulty, @description, @input_format, @output_format, @hint, @time_limit_ms, @memory_limit_mb, @is_public)`
        )
        .run(data);
      const pid = Number(r.lastInsertRowid);
      if (testcases?.length) {
        const stmt = db.prepare(
          'INSERT INTO testcases (problem_id, input, expected_output, is_sample, ord) VALUES (?,?,?,?,?)'
        );
        testcases.forEach((tc, idx) => stmt.run(pid, tc.input, tc.expected_output, tc.is_sample, tc.ord || idx + 1));
      }
      return pid;
    })();

    res.status(201).json({ id: info });
  })
);

adminRouter.put(
  '/problems/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    loadProblem(id);
    const data = problemSchema.partial().parse(req.body);
    const keys = Object.keys(data) as (keyof typeof data)[];
    if (keys.length === 0) throw notFound('没有需要更新的字段');

    const setSql = keys.map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE problems SET ${setSql}, updated_at = datetime('now') WHERE id = ?`).run(
      ...keys.map((k) => data[k] as never),
      id
    );
    res.json({ ok: true, problem: loadProblem(id) });
  })
);

adminRouter.delete(
  '/problems/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    loadProblem(id);
    db.prepare('DELETE FROM problems WHERE id = ?').run(id);
    res.json({ ok: true });
  })
);

adminRouter.get(
  '/problems/:id/testcases',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const testcases = db.prepare('SELECT * FROM testcases WHERE problem_id = ? ORDER BY ord ASC, id ASC').all(id);
    res.json({ testcases });
  })
);

adminRouter.post(
  '/problems/:id/testcases',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    loadProblem(id);
    const data = testcaseSchema.parse(req.body);
    const nextOrd =
      data.ord ||
      ((db.prepare('SELECT COALESCE(MAX(ord), 0) AS m FROM testcases WHERE problem_id = ?').get(id) as { m: number }).m + 1);

    const info = db
      .prepare('INSERT INTO testcases (problem_id, input, expected_output, is_sample, ord) VALUES (?,?,?,?,?)')
      .run(id, data.input, data.expected_output, data.is_sample, nextOrd);

    res.status(201).json({ testcase: db.prepare('SELECT * FROM testcases WHERE id = ?').get(Number(info.lastInsertRowid)) });
  })
);
