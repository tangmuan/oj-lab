import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { ContestListItem, ContestPhase } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../lib/format';

export const PHASE_META: Record<ContestPhase, { label: string; className: string }> = {
  upcoming: { label: '未开始', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  running: { label: '进行中', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  ended: { label: '已结束', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

export function ContestListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ContestListItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<number | null>(null);

  function load() {
    api<{ items: ContestListItem[] }>('/contests')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleRegister(c: ContestListItem) {
    if (!user) {
      navigate('/login', { state: { from: '/contests' } });
      return;
    }
    setPending(c.id);
    try {
      const r = await api<{ registered: boolean }>(`/contests/${c.id}/register`, {
        method: c.mine ? 'DELETE' : 'POST',
      });
      setItems((prev) => prev.map((it) => (it.id === c.id ? { ...it, mine: r.registered } : it)));
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '报名失败');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">比赛</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          比赛期间提交计入榜单，同一题按首次通过计时，每次失败罚 20 分钟
        </p>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
      ) : items.length === 0 ? (
        <div className="card px-4 py-16 text-center text-sm text-slate-400">暂时没有比赛</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((c) => {
            const meta = PHASE_META[c.phase];
            return (
              <div key={c.id} className="card flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      to={`/contests/${c.id}`}
                      className="text-base font-semibold text-slate-900 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-400"
                    >
                      {c.title}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {formatDateTime(c.start_at)} — {formatDateTime(c.end_at)}
                    </p>
                  </div>
                  <span className={`chip shrink-0 ${meta.className}`}>
                    {c.phase === 'running' && <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
                    {meta.label}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>{c.problem_count} 道题</span>
                  <span>{c.registered_count} 人报名</span>
                  {c.frozen_minutes > 0 && <span>最后 {c.frozen_minutes} 分钟封榜</span>}
                  {c.is_public === 0 && <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">隐藏</span>}
                </div>

                <div className="mt-auto flex items-center gap-2">
                  <Link to={`/contests/${c.id}`} className="btn-primary !py-1.5 text-xs">
                    进入比赛
                  </Link>
                  {c.phase !== 'ended' && (
                    <button
                      className={`btn-ghost !py-1.5 text-xs ${c.mine ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
                      onClick={() => toggleRegister(c)}
                      disabled={pending === c.id}
                    >
                      {c.mine ? '已报名（点击取消）' : '报名'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
