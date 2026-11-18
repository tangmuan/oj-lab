import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { ContestRow } from '../types';
import { ah, badRequest, notFound } from '../utils/errors';
import { nowSqlUtc, toSqlUtc } from '../utils/contest';

/** 挂在 adminRouter 下，鉴权由父路由的 requireAuth + requireAdmin 兜住 */
export const adminContestsRouter = Router();

const contestSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(120, '标题过长'),
  start_at: z.string().datetime({ offset: true, message: '开始时间格式不正确' }),
  end_at: z.string().datetime({ offset: true, message: '结束时间格式不正确' }),
  frozen_minutes: z.coerce.number().int().min(0, '封榜时长不能为负').max(600, '封榜不能超过 10 小时').default(0),
  is_public: z.coerce.number().int().min(0).max(1).default(1),
});

const problemsSchema = z.object({
  problems: z
    .array(
      z.object({
        problemId: z.coerce.number().int().positive(),
        label: z.string().trim().max(4).default(''),
        ord: z.coerce.number().int().min(0).default(0),
      })
    )
    .max(30, '一场比赛最多 30 道题'),
});

function loadContest(id: number): ContestRow {
  const row = db.prepare('SELECT * FROM contests WHERE id = ?').get(id) as ContestRow | undefined;
  if (!row) throw notFound('比赛不存在');
  return row;
}

/** 校验时间窗，顺手把 ISO 转成库里的 UTC 字符串格式 */
function normalizeWindow(input: { start_at: string; end_at: string; frozen_minutes: number }): {
  start_at: string;
  end_at: string;
} {
  const start = toSqlUtc(input.start_at);
  const end = toSqlUtc(input.end_at);
  if (end <= start) throw badRequest('结束时间必须晚于开始时间');
  const durationMin = (new Date(`${end.replace(' ', 'T')}Z`).getTime() - new Date(`${start.replace(' ', 'T')}Z`).getTime()) / 60_000;
  if (input.frozen_minutes > durationMin) throw badRequest('封榜时长不能超过比赛总时长');
  return { start_at: start, end_at: end };
}

adminContestsRouter.get(
  '/',
  ah(async (_req, res) => {
    const items = db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM contest_problems cp WHERE cp.contest_id = c.id) AS problem_count,
                (SELECT COUNT(*) FROM contest_registrations r WHERE r.contest_id = c.id) AS registered_count
         FROM contests c ORDER BY c.start_at DESC`
      )
      .all();
    res.json({ items });
  })
);

adminContestsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const contest = loadContest(id);
    const problems = db
      .prepare(
        `SELECT cp.problem_id, cp.label, cp.ord, p.title
         FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
         WHERE cp.contest_id = ? ORDER BY cp.ord ASC, cp.label ASC`
      )
      .all(id);
    res.json({ contest, problems });
  })
);

adminContestsRouter.post(
  '/',
  ah(async (req, res) => {
    const data = contestSchema.parse(req.body);
    const window = normalizeWindow(data);

    const info = db
      .prepare(
        `INSERT INTO contests (title, start_at, end_at, frozen_minutes, is_public)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(data.title, window.start_at, window.end_at, data.frozen_minutes, data.is_public);

    res.status(201).json({ id: Number(info.lastInsertRowid) });
  })
);

adminContestsRouter.put(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    loadContest(id);
    const data = contestSchema.partial().parse(req.body);

    // 部分更新时用现值补全，才能校验「结束 > 开始」这类跨字段规则
    const current = loadContest(id);
    const window = normalizeWindow({
      start_at: data.start_at ?? `${current.start_at.replace(' ', 'T')}Z`,
      end_at: data.end_at ?? `${current.end_at.replace(' ', 'T')}Z`,
      frozen_minutes: data.frozen_minutes ?? current.frozen_minutes,
    });

    db.prepare(
      `UPDATE contests SET title = ?, start_at = ?, end_at = ?, frozen_minutes = ?, is_public = ?
       WHERE id = ?`
    ).run(
      data.title ?? current.title,
      window.start_at,
      window.end_at,
      data.frozen_minutes ?? current.frozen_minutes,
      data.is_public ?? current.is_public,
      id
    );

    res.json({ ok: true, contest: loadContest(id) });
  })
);

adminContestsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    loadContest(id);
    db.prepare('DELETE FROM contests WHERE id = ?').run(id);
    res.json({ ok: true });
  })
);

adminContestsRouter.put(
  '/:id/problems',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    loadContest(id);
    const { problems } = problemsSchema.parse(req.body);

    const labels = new Set<string>();
    const rows = problems.map((p, idx) => {
      const label = p.label || String.fromCharCode(65 + idx);
      if (labels.has(label)) throw badRequest(`题目编号 ${label} 重复`);
      labels.add(label);
      const exists = db.prepare('SELECT id FROM problems WHERE id = ?').get(p.problemId);
      if (!exists) throw notFound(`题目 #${p.problemId} 不存在`);
      return { ...p, label, ord: p.ord || idx + 1 };
    });

    db.transaction(() => {
      db.prepare('DELETE FROM contest_problems WHERE contest_id = ?').run(id);
      const stmt = db.prepare('INSERT INTO contest_problems (contest_id, problem_id, label, ord) VALUES (?,?,?,?)');
      for (const r of rows) stmt.run(id, r.problemId, r.label, r.ord);
    })();

    res.json({ ok: true, count: rows.length });
  })
);

adminContestsRouter.post(
  '/:id/unfreeze',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    loadContest(id);
    db.prepare('UPDATE contests SET unfrozen_at = ? WHERE id = ?').run(nowSqlUtc(), id);
    res.json({ ok: true, contest: loadContest(id) });
  })
);
