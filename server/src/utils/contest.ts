import { db } from '../db';
import { ContestRow } from '../types';

/** 每次失败的罚时，ICPC 惯例 20 分钟 */
export const PENALTY_MINUTES = 20;

export type ContestPhase = 'upcoming' | 'running' | 'ended';

/** 比赛时间统一用 UTC 'YYYY-MM-DD HH:MM:SS'：字典序等于时间序，SQL 里能直接比 */
export function toSqlUtc(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function nowSqlUtc(): string {
  return toSqlUtc(new Date());
}

/** Public problem access shared by detail, submit, self-test, and statistics endpoints. */
export function canViewProblem(problemId: number, role: string | undefined, now = nowSqlUtc()): boolean {
  const row = db
    .prepare(
      `SELECT p.is_public, MIN(c.start_at) AS earliest_start
       FROM problems p
       LEFT JOIN contest_problems cp ON cp.problem_id = p.id
       LEFT JOIN contests c ON c.id = cp.contest_id
       WHERE p.id = ? GROUP BY p.id`
    )
    .get(problemId) as { is_public: number; earliest_start: string | null } | undefined;
  if (!row) return false;
  if (role === 'admin') return true;
  return row.is_public === 1 && (row.earliest_start === null || row.earliest_start <= now);
}

export function canSubmitToProblem(problemId: number, role: string | undefined, now = nowSqlUtc()): boolean {
  return canViewProblem(problemId, role, now);
}

/** SQL condition for aggregates that must omit currently frozen results for this viewer. */
export function visibleSubmissionCondition(
  alias: string,
  viewerId: number | undefined,
  role: string | undefined,
  now = nowSqlUtc()
): { sql: string; params: unknown[] } {
  if (role === 'admin') return { sql: '1 = 1', params: [] };
  const ownClause = viewerId === undefined ? '0 = 1' : `${alias}.user_id = ?`;
  const params: unknown[] = viewerId === undefined ? [] : [viewerId];
  params.push(now, now);
  return {
    sql: `(${ownClause} OR NOT EXISTS (
      SELECT 1 FROM contest_problems cp JOIN contests c ON c.id = cp.contest_id
      WHERE cp.problem_id = ${alias}.problem_id
        AND c.unfrozen_at IS NULL AND c.end_at > ? AND c.frozen_minutes > 0
        AND ? >= datetime(c.end_at, printf('-%d minutes', c.frozen_minutes))
        AND ${alias}.created_at > datetime(c.end_at, printf('-%d minutes', c.frozen_minutes))
    ))`,
    params,
  };
}

export function phaseOf(contest: Pick<ContestRow, 'start_at' | 'end_at'>, now = nowSqlUtc()): ContestPhase {
  if (now < contest.start_at) return 'upcoming';
  if (now >= contest.end_at) return 'ended';
  return 'running';
}

export function freezeMoment(contest: Pick<ContestRow, 'end_at' | 'frozen_minutes'>): string {
  const end = new Date(`${contest.end_at.replace(' ', 'T')}Z`);
  return toSqlUtc(new Date(end.getTime() - contest.frozen_minutes * 60_000));
}

/**
 * 是否对该访问者封榜：管理员始终看全量；结束或手动解封后自动解封。
 */
export function isFrozenForViewer(
  contest: Pick<ContestRow, 'end_at' | 'frozen_minutes' | 'unfrozen_at'>,
  role: string | undefined,
  now = nowSqlUtc()
): boolean {
  if (role === 'admin') return false;
  if (contest.unfrozen_at) return false;
  if (now >= contest.end_at) return false;
  if (contest.frozen_minutes <= 0) return false;
  return now >= freezeMoment(contest);
}

/**
 * 该比赛当前对该访问者处于封榜期时，返回封榜时刻；否则返回 null。
 * 边界逻辑全部委托 isFrozenForViewer，避免出现第二套「管理员/解封/结束」判断。
 */
export function frozenSinceForViewer(
  contest: Pick<ContestRow, 'end_at' | 'frozen_minutes' | 'unfrozen_at'>,
  role: string | undefined,
  now = nowSqlUtc()
): string | null {
  return isFrozenForViewer(contest, role, now) ? freezeMoment(contest) : null;
}

/**
 * 判断「某道题在某条提交时间点上是否处于封榜期」：
 * 同一题可能同时挂在多场比赛里，只要有一场当前处于封榜期、且提交发生在该场的
 * 封榜时刻之后，结果就视为未公布（取最严格）。管理员永远 false。
 * 判定口径与榜单一致：严格大于封榜时刻才算封榜提交（buildStandings 的 atMs > frozenMs）。
 * 单发场景用；列表接口请用 loadFrozenWindows + isSubmissionFrozen，避免逐条回表的 N+1。
 */
export function isFrozenAt(problemId: number, createdAt: string, viewerRole: string | undefined, now = nowSqlUtc()): boolean {
  const contests = db
    .prepare(
      `SELECT c.end_at, c.frozen_minutes, c.unfrozen_at
       FROM contests c JOIN contest_problems cp ON cp.contest_id = c.id
       WHERE cp.problem_id = ?`
    )
    .all(problemId) as Array<Pick<ContestRow, 'end_at' | 'frozen_minutes' | 'unfrozen_at'>>;
  return contests.some((c) => {
    const since = frozenSinceForViewer(c, viewerRole, now);
    return since !== null && createdAt > since;
  });
}

/**
 * 一次性查出「当前所有封榜中的 (problem_id → 封榜时刻)」，供列表接口在 Node 侧用 Map 过滤。
 * 同一题被多场封榜中的比赛覆盖时，取更早的封榜时刻（更严格：更多提交会被隐藏）。
 * 管理员直接返回空 Map，调用方无需再判角色。
 */
export function loadFrozenWindows(viewerRole: string | undefined, now = nowSqlUtc()): Map<number, string> {
  const map = new Map<number, string>();
  if (viewerRole === 'admin') return map;
  const rows = db
    .prepare(
      `SELECT cp.problem_id, c.end_at, c.frozen_minutes, c.unfrozen_at
       FROM contests c JOIN contest_problems cp ON cp.contest_id = c.id
       WHERE c.unfrozen_at IS NULL AND c.end_at > ? AND c.frozen_minutes > 0`
    )
    .all(now) as Array<{ problem_id: number } & Pick<ContestRow, 'end_at' | 'frozen_minutes' | 'unfrozen_at'>>;
  for (const r of rows) {
    const since = frozenSinceForViewer(r, viewerRole, now);
    if (since === null) continue;
    const prev = map.get(r.problem_id);
    if (prev === undefined || since < prev) map.set(r.problem_id, since);
  }
  return map;
}

/** 基于 loadFrozenWindows 的逐条判定：提交发生在封榜时刻之后即隐藏 */
export function isSubmissionFrozen(windows: Map<number, string>, problemId: number, createdAt: string): boolean {
  const since = windows.get(problemId);
  return since !== undefined && createdAt > since;
}

export interface StandingCell {
  problemId: number;
  status: 'AC' | 'WA' | 'FROZEN' | 'NONE';
  /** AC 之前的失败次数（封榜后的失败不计入，否则能从罚时反推结果） */
  tries: number;
  /** 相对开赛的毫秒数，未 AC 为 null */
  acTimeMs: number | null;
}

export interface StandingRow {
  rank: number;
  userId: number;
  username: string;
  solved: number;
  /** 罚时（分钟）= Σ AC 用时 + 20 × 失败次数 */
  penalty: number;
  cells: StandingCell[];
}

interface RawSubmission {
  user_id: number;
  problem_id: number;
  status: string;
  created_at: string;
}

/**
 * 榜单在 Node 侧算：罚时要「按人按题取首次 AC、再回填失败次数」，
 * 这种顺序依赖用 SQL 窗口函数反而更难读，提交量本身也有限。
 */
export function buildStandings(
  contest: ContestRow,
  problems: Array<{ problemId: number; label: string }>,
  opts: { frozen: boolean }
): StandingRow[] {
  if (problems.length === 0) return [];

  const frozenFrom = opts.frozen ? freezeMoment(contest) : null;
  const placeholders = problems.map(() => '?').join(',');
  const submissions = db
    .prepare(
      `SELECT s.user_id, s.problem_id, s.status, s.created_at
       FROM submissions s
       WHERE s.problem_id IN (${placeholders})
         AND s.created_at >= ?
         AND s.created_at <= ?
       ORDER BY s.created_at ASC, s.id ASC`
    )
    .all(...(problems.map((p) => p.problemId) as never[]), contest.start_at, contest.end_at) as RawSubmission[];

  // 榜单成员 = 报名者 ∪ 有提交的人：只看报名者会漏掉直接冲进来做题的人
  const members = new Map<number, string>();
  const registrations = db
    .prepare(
      `SELECT u.id, u.username FROM contest_registrations r JOIN users u ON u.id = r.user_id WHERE r.contest_id = ?`
    )
    .all(contest.id) as Array<{ id: number; username: string }>;
  for (const r of registrations) members.set(r.id, r.username);

  const unknownUsers = new Set<number>();
  for (const s of submissions) {
    if (!members.has(s.user_id)) unknownUsers.add(s.user_id);
  }
  if (unknownUsers.size > 0) {
    const ids = [...unknownUsers];
    const rows = db
      .prepare(`SELECT id, username FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...(ids as never[])) as Array<{ id: number; username: string }>;
    for (const r of rows) members.set(r.id, r.username);
  }

  const startMs = new Date(`${contest.start_at.replace(' ', 'T')}Z`).getTime();
  const frozenMs = frozenFrom ? new Date(`${frozenFrom.replace(' ', 'T')}Z`).getTime() : null;

  // key = `${userId}:${problemId}`
  const state = new Map<string, { acTimeMs: number | null; fails: number; frozen: boolean }>();
  const cellOf = (userId: number, problemId: number) => {
    const key = `${userId}:${problemId}`;
    let cur = state.get(key);
    if (!cur) {
      cur = { acTimeMs: null, fails: 0, frozen: false };
      state.set(key, cur);
    }
    return cur;
  };

  for (const s of submissions) {
    const cur = cellOf(s.user_id, s.problem_id);
    if (cur.acTimeMs !== null) continue; // 已 AC，之后的提交不影响罚时

    const atMs = new Date(`${s.created_at.replace(' ', 'T')}Z`).getTime();
    // 封榜后的提交只留「有提交」的痕迹，结果与罚时都不计入
    if (frozenMs !== null && atMs > frozenMs) {
      cur.frozen = true;
      continue;
    }
    if (s.status === 'AC') cur.acTimeMs = Math.max(0, atMs - startMs);
    else cur.fails += 1;
  }

  const rows: StandingRow[] = [...members.entries()].map(([userId, username]) => {
    let solved = 0;
    let penalty = 0;
    const cells = problems.map((p) => {
      const st = state.get(`${userId}:${p.problemId}`);
      if (!st) return { problemId: p.problemId, status: 'NONE', tries: 0, acTimeMs: null } as StandingCell;
      if (st.acTimeMs !== null) {
        solved += 1;
        penalty += Math.floor(st.acTimeMs / 60_000) + PENALTY_MINUTES * st.fails;
        return { problemId: p.problemId, status: 'AC', tries: st.fails, acTimeMs: st.acTimeMs } as StandingCell;
      }
      if (st.frozen) return { problemId: p.problemId, status: 'FROZEN', tries: 0, acTimeMs: null } as StandingCell;
      if (st.fails > 0) return { problemId: p.problemId, status: 'WA', tries: st.fails, acTimeMs: null } as StandingCell;
      return { problemId: p.problemId, status: 'NONE', tries: 0, acTimeMs: null } as StandingCell;
    });

    return { rank: 0, userId, username, solved, penalty, cells };
  });

  rows.sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || a.userId - b.userId);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}
