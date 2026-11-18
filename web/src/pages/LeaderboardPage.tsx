import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { LeaderboardItem } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../lib/format';

const MEDALS = ['🥇', '🥈', '🥉'];

export function LeaderboardPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<LeaderboardItem[]>([]);
  const [totalProblems, setTotalProblems] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ items: LeaderboardItem[]; totalProblems: number }>('/stats/leaderboard?limit=50')
      .then((r) => {
        setItems(r.items);
        setTotalProblems(r.totalProblems);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">排行榜</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          按通过题目数排名（同分看提交次数，越少越靠前）· 共 {totalProblems} 道公开题
        </p>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}

      <div className="card overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-16">排名</th>
              <th>用户</th>
              <th className="w-28">通过题数</th>
              <th className="w-28">提交次数</th>
              <th className="w-24">通过率</th>
              <th className="w-44">最近提交</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  加载中…
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className={it.id === user?.id ? 'bg-brand-50/40' : 'transition hover:bg-slate-50/70'}>
                <td className="text-center font-mono text-sm text-slate-500 dark:text-slate-400">
                  {it.rank <= 3 && it.solved > 0 ? MEDALS[it.rank - 1] : it.rank}
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {it.username.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{it.username}</span>
                    {it.role === 'admin' && <span className="chip bg-amber-50 text-amber-700">管理员</span>}
                    {it.id === user?.id && <span className="chip bg-brand-50 text-brand-700">我</span>}
                  </div>
                </td>
                <td>
                  <span className="font-mono text-sm font-semibold text-emerald-600">{it.solved}</span>
                  <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">/ {totalProblems}</span>
                </td>
                <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{it.submit_count}</td>
                <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{it.ac_rate === null ? '—' : `${it.ac_rate}%`}</td>
                <td className="text-xs text-slate-400 dark:text-slate-500">{formatDateTime(it.last_submit_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
