import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { ContestRow } from '../types';
import { ah, badRequest, notFound } from '../utils/errors';
import { buildStandings, freezeMoment, isFrozenForViewer, nowSqlUtc, phaseOf } from '../utils/contest';

export const contestsRouter = Router();

interface ContestListRow extends ContestRow {
  problem_count: number;
  registered_count: number;
  mine: number;
}

function loadContest(id: number): ContestRow {
  const row = db.prepare('SELECT * FROM contests WHERE id = ?').get(id) as ContestRow | undefined;
  if (!row) throw notFound('比赛不存在');
  return row;
}

function loadContestProblems(contestId: number, includeHidden: boolean): Array<{
  problemId: number;
  label: string;
  ord: number;
  title: string;
  difficulty: string;
}> {
  const rows = db
    .prepare(
      `SELECT cp.problem_id AS problemId, cp.label, cp.ord, p.title, p.difficulty, p.is_public
       FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
       WHERE cp.contest_id = ?
       ORDER BY cp.ord ASC, cp.label ASC`
    )
    .all(contestId) as Array<{ problemId: number; label: string; ord: number; title: string; difficulty: string; is_public: number }>;

  return rows
    .filter((r) => includeHidden || r.is_public === 1)
    .map(({ is_public: _isPublic, ...rest }) => rest);
}

contestsRouter.get(
  '/',
  optionalAuth,
  ah(async (req, res) => {
    const isAdmin = req.user?.role === 'admin';
    const now = nowSqlUtc();
    const rows = db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM contest_problems cp WHERE cp.contest_id = c.id) AS problem_count,
                (SELECT COUNT(*) FROM contest_registrations r WHERE r.contest_id = c.id) AS registered_count,
                EXISTS(SELECT 1 FROM contest_registrations r2 WHERE r2.contest_id = c.id AND r2.user_id = ?) AS mine
         FROM contests c
         ${isAdmin ? '' : 'WHERE c.is_public = 1'}
         ORDER BY c.start_at DESC`
      )
      .all(req.user?.id ?? -1) as ContestListRow[];

    res.json({
      items: rows.map((r) => ({
        ...r,
        phase: phaseOf(r, now),
        frozen: isFrozenForViewer(r, req.user?.role, now),
        mine: r.mine === 1,
      })),
    });
  })
);

contestsRouter.get(
  '/:id',
  optionalAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('比赛不存在');

    const contest = loadContest(id);
    const isAdmin = req.user?.role === 'admin';
    if (contest.is_public !== 1 && !isAdmin) throw notFound('比赛不存在');

    const phase = phaseOf(contest);
    // 未开始前不给题目，否则提前看题等于泄题；管理员例外。
    // 题目本身的可见性（列表/详情）由 routes/problems.ts 的比赛窗口规则兜底，两层语义一致
    const problems = phase === 'upcoming' && !isAdmin ? [] : loadContestProblems(id, isAdmin);

    const mine = req.user
      ? !!db.prepare('SELECT 1 AS hit FROM contest_registrations WHERE contest_id = ? AND user_id = ?').get(id, req.user.id)
      : false;

    res.json({
      contest: {
        ...contest,
        phase,
        frozen: isFrozenForViewer(contest, req.user?.role),
        freezeAt: contest.frozen_minutes > 0 ? freezeMoment(contest) : null,
      },
      problems,
      mine,
      serverTime: nowSqlUtc(),
    });
  })
);

contestsRouter.post(
  '/:id/register',
  requireAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('比赛不存在');

    const contest = loadContest(id);
    if (contest.is_public !== 1 && req.user!.role !== 'admin') throw notFound('比赛不存在');
    if (phaseOf(contest) === 'ended') throw badRequest('比赛已结束，无法报名');

    db.prepare('INSERT OR IGNORE INTO contest_registrations (contest_id, user_id) VALUES (?, ?)').run(id, req.user!.id);
    res.json({ registered: true });
  })
);

contestsRouter.delete(
  '/:id/register',
  requireAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('比赛不存在');
    db.prepare('DELETE FROM contest_registrations WHERE contest_id = ? AND user_id = ?').run(id, req.user!.id);
    res.json({ registered: false });
  })
);

contestsRouter.get(
  '/:id/standings',
  optionalAuth,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('比赛不存在');

    const contest = loadContest(id);
    const isAdmin = req.user?.role === 'admin';
    if (contest.is_public !== 1 && !isAdmin) throw notFound('比赛不存在');

    const frozen = isFrozenForViewer(contest, req.user?.role);
    const problems = loadContestProblems(id, isAdmin);
    const rows = buildStandings(
      contest,
      problems.map((p) => ({ problemId: p.problemId, label: p.label })),
      { frozen }
    );

    res.json({
      frozen,
      freezeAt: contest.frozen_minutes > 0 ? freezeMoment(contest) : null,
      serverTime: nowSqlUtc(),
      rows,
    });
  })
);
