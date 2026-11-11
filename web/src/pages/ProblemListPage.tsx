import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Difficulty, Overview, Paginated, ProblemSummary } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { DIFFICULTY_META } from '../lib/format';

const DIFFICULTIES: Array<{ value: '' | Difficulty; label: string }> = [
  { value: '', label: '全部' },
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
];

export function ProblemListPage() {
  const { user } = useAuth();
  const [keyword, setKeyword] = useState('');
  const [difficulty, setDifficulty] = useState<'' | Difficulty>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ProblemSummary> | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Overview>('/stats/overview').then(setOverview).catch(() => undefined);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (keyword.trim()) qs.set('keyword', keyword.trim());
    if (difficulty) qs.set('difficulty', difficulty);

    api<Paginated<ProblemSummary>>(`/problems?${qs.toString()}`)
      .then((r) => {
        if (!alive) return;
        setData(r);
        setError('');
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [keyword, difficulty, page]);

  const solvedCount = data?.items.filter((i) => i.my_status.solved).length ?? 0;

  return (
    <div className="space-y-5">
      {/* 顶部信息条 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: '题目总数', value: overview?.problems ?? '—', hint: '公开题目' },
          { label: '提交总数', value: overview?.submissions ?? '—', hint: `今日 ${overview?.todaySubmissions ?? 0} 次` },
          {
            label: '通过率',
            value: overview && overview.submissions > 0 ? `${((overview.accepted / overview.submissions) * 100).toFixed(1)}%` : '—',
            hint: `${overview?.accepted ?? 0} 次通过`,
          },
          { label: '本页已解', value: user ? `${solvedCount}/${data?.items.length ?? 0}` : '—', hint: user ? '当前账号' : '登录后可见' },
        ].map((s) => (
          <div key={s.label} className="card px-4 py-3.5">
            <p className="text-xs font-medium text-slate-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{s.value}</p>
            <p className="mt-0.5 text-xs text-slate-400">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                onClick={() => {
                  setDifficulty(d.value);
                  setPage(1);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  difficulty === d.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="relative sm:ml-auto sm:w-64">
            <input
              className="input !pl-8"
              placeholder="搜索题目名称或题面关键词"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPage(1);
              }}
            />
            <svg
              className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </div>
        </div>

        {error && <p className="px-4 py-6 text-sm text-rose-600">{error}</p>}

        <table className="table-base">
          <thead>
            <tr>
              <th className="w-16">状态</th>
              <th className="w-16">编号</th>
              <th>题目</th>
              <th className="w-20">难度</th>
              <th className="w-24">通过率</th>
              <th className="w-24">提交</th>
              <th className="w-32">限制</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-slate-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-slate-400">
                  没有匹配的题目
                </td>
              </tr>
            )}
            {data?.items.map((p) => (
              <tr key={p.id} className="transition hover:bg-slate-50/70">
                <td>
                  {p.my_status.solved ? (
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                      ✓
                    </span>
                  ) : p.my_status.tried ? (
                    <span className="grid h-5 w-5 place-items-center rounded-full border border-amber-300 text-[10px] font-bold text-amber-500">
                      !
                    </span>
                  ) : (
                    <span className="grid h-5 w-5 place-items-center rounded-full border border-slate-200 text-[10px] text-slate-300">
                      ·
                    </span>
                  )}
                </td>
                <td className="font-mono text-xs text-slate-400">#{String(p.id).padStart(4, '0')}</td>
                <td>
                  <Link to={`/problems/${p.id}`} className="font-medium text-slate-800 hover:text-brand-600">
                    {p.title}
                  </Link>
                  {p.is_public === 0 && <span className="chip ml-2 bg-slate-100 text-slate-500">隐藏</span>}
                </td>
                <td>
                  <span className={`chip ${DIFFICULTY_META[p.difficulty].className}`}>{DIFFICULTY_META[p.difficulty].label}</span>
                </td>
                <td className="text-slate-600">{p.ac_rate === null ? '—' : `${p.ac_rate}%`}</td>
                <td className="text-slate-600">{p.submit_count}</td>
                <td className="font-mono text-xs text-slate-500">
                  {p.time_limit_ms}ms / {p.memory_limit_mb}MB
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
            <span>
              共 {data.total} 题 · 第 {data.page}/{data.totalPages} 页
            </span>
            <div className="flex gap-2">
              <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <button
                className="btn-ghost !px-2.5 !py-1 text-xs"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
