import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { ContestDetail, StandingCell, Standings } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { DIFFICULTY_META, formatCountdown, formatDateTime, parseUtc } from '../lib/format';
import { PHASE_META } from './ContestListPage';

const MEDALS = ['🥇', '🥈', '🥉'];

function StandingCellView({ cell }: { cell: StandingCell }) {
  if (cell.status === 'AC') {
    return (
      <div className="text-center">
        <div className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          +{Math.floor((cell.acTimeMs ?? 0) / 60000)}
        </div>
        {cell.tries > 0 && <div className="text-[10px] leading-3 text-rose-500">−{cell.tries}</div>}
      </div>
    );
  }
  if (cell.status === 'WA') return <div className="text-center font-mono text-xs text-rose-500">−{cell.tries}</div>;
  if (cell.status === 'FROZEN') {
    return (
      <div className="text-center font-mono text-xs text-slate-400 dark:text-slate-500" title="封榜中，结果暂不公布">
        ?
      </div>
    );
  }
  return <div className="text-center text-xs text-slate-300 dark:text-slate-600">·</div>;
}

export function ContestDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ContestDetail | null>(null);
  const [standings, setStandings] = useState<Standings | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  /** 服务器时钟 − 本地时钟的偏移（毫秒）：本机时间不准时倒计时仍以服务端为准 */
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const cid = Number(id);
    if (!Number.isInteger(cid)) return;
    api<ContestDetail>(`/contests/${cid}`)
      .then((r) => {
        setDetail(r);
        const serverMs = parseUtc(r.serverTime)?.getTime();
        if (serverMs !== undefined) setOffset(serverMs - Date.now());
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'));
  }, [id]);

  // 榜单 10 秒轮询：比赛期间需要「实时」，用 SSE 做会长连接太重
  useEffect(() => {
    const cid = Number(id);
    if (!Number.isInteger(cid)) return;
    let alive = true;
    const load = () => {
      api<Standings>(`/contests/${cid}/standings`)
        .then((r) => {
          if (!alive) return;
          setStandings(r);
          // 每次轮询都重算偏移：请求往返通常 <1s，用发出时刻近似即可，长时间挂页也漂不到哪去
          const serverMs = parseUtc(r.serverTime)?.getTime();
          if (serverMs !== undefined) setOffset(serverMs - Date.now());
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [id]);

  if (error) {
    return (
      <div className="card mx-auto mt-16 max-w-md p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{error}</h2>
        <Link to="/contests" className="btn-ghost mt-5 inline-flex">
          返回比赛列表
        </Link>
      </div>
    );
  }
  if (!detail) return <div className="py-24 text-center text-sm text-slate-400">加载中…</div>;

  const c = detail.contest;
  const startMs = parseUtc(c.start_at)?.getTime() ?? 0;
  const endMs = parseUtc(c.end_at)?.getTime() ?? 0;
  const meta = PHASE_META[c.phase];
  // 倒计时用校正后的时钟：本机时间被调快/调慢也不影响与服务端一致
  const correctedNow = now + offset;

  const countdown =
    c.phase === 'upcoming'
      ? { label: '距开始', text: formatCountdown(startMs - correctedNow) }
      : c.phase === 'running'
        ? { label: '距结束', text: formatCountdown(endMs - correctedNow) }
        : null;

  async function toggleRegister() {
    if (!user) {
      navigate('/login', { state: { from: `/contests/${c.id}` } });
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ registered: boolean }>(`/contests/${c.id}/register`, { method: detail!.mine ? 'DELETE' : 'POST' });
      setDetail((prev) => (prev ? { ...prev, mine: r.registered } : prev));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '报名失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <Link to="/contests" className="hover:text-slate-600 dark:hover:text-slate-300">
          比赛
        </Link>
        <span>/</span>
        <span className="text-slate-500 dark:text-slate-400">{c.title}</span>
      </div>

      <div className="card flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{c.title}</h1>
            <span className={`chip ${meta.className}`}>
              {c.phase === 'running' && <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
              {meta.label}
            </span>
            {c.is_public === 0 && (
              <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">隐藏</span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            {formatDateTime(c.start_at)} — {formatDateTime(c.end_at)}
            {c.frozen_minutes > 0 && ` · 最后 ${c.frozen_minutes} 分钟封榜`}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {countdown && (
            <div className="text-right">
              <p className="text-xs text-slate-400 dark:text-slate-500">{countdown.label}</p>
              <p className="font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{countdown.text}</p>
            </div>
          )}
          {c.phase !== 'ended' && (
            <button
              className={detail.mine ? 'btn-ghost !py-1.5 text-xs' : 'btn-primary !py-1.5 text-xs'}
              onClick={toggleRegister}
              disabled={busy}
            >
              {busy ? '处理中…' : detail.mine ? '已报名（取消）' : '报名参赛'}
            </button>
          )}
        </div>
      </div>

      {standings?.frozen && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          已进入封榜阶段：{formatDateTime(standings.freezeAt)} 之后的提交只显示为「?」，比赛结束后自动解封
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">题目</h2>
        </div>
        {detail.problems.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            {c.phase === 'upcoming' ? '比赛开始后公布题目' : '这场比赛的题目还在准备中'}
          </p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-16">编号</th>
                <th>题目</th>
                <th className="w-24">难度</th>
              </tr>
            </thead>
            <tbody>
              {detail.problems.map((p) => (
                <tr key={p.problemId}>
                  <td className="font-mono text-sm font-semibold text-brand-600 dark:text-brand-400">{p.label}</td>
                  <td>
                    <Link
                      to={`/problems/${p.problemId}`}
                      className="font-medium text-slate-800 hover:text-brand-600 dark:text-slate-200 dark:hover:text-brand-400"
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td>
                    <span className={`chip ${DIFFICULTY_META[p.difficulty]?.className ?? ''}`}>
                      {DIFFICULTY_META[p.difficulty]?.label ?? p.difficulty}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">榜单</h2>
          <span className="text-xs text-slate-400 dark:text-slate-500">每 10 秒自动刷新 · 罚时 = 通过用时 + 20 分钟 × 失败次数</span>
        </div>

        {!standings || standings.rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">还没有参赛记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-16">排名</th>
                  <th>用户</th>
                  <th className="w-20">通过</th>
                  <th className="w-20">罚时</th>
                  {detail.problems.map((p) => (
                    <th key={p.problemId} className="w-20 text-center">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {standings.rows.map((r) => (
                  <tr key={r.userId} className={r.userId === user?.id ? 'bg-brand-50/40 dark:bg-brand-500/10' : ''}>
                    <td className="text-center font-mono text-sm text-slate-500 dark:text-slate-400">
                      {r.rank <= 3 && r.solved > 0 ? MEDALS[r.rank - 1] : r.rank}
                    </td>
                    <td>
                      <Link
                        to={`/u/${r.userId}`}
                        className="font-medium text-slate-800 hover:text-brand-600 dark:text-slate-200 dark:hover:text-brand-400"
                      >
                        {r.username}
                      </Link>
                      {r.userId === user?.id && <span className="chip ml-2 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">我</span>}
                    </td>
                    <td className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">{r.solved}</td>
                    <td className="font-mono text-xs text-slate-600 dark:text-slate-300">{r.penalty}</td>
                    {r.cells.map((cell) => (
                      <td key={cell.problemId}>
                        <StandingCellView cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
