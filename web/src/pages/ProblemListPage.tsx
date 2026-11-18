import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Difficulty, Overview, Paginated, ProblemSummary, TagCount } from '../api/types';
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
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [difficulty, setDifficulty] = useState<'' | Difficulty>('');
  const [tag, setTag] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ProblemSummary> | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [favPending, setFavPending] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Overview>('/stats/overview').then(setOverview).catch(() => undefined);
    api<{ items: TagCount[] }>('/problems/tags')
      .then((r) => setTags(r.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (keyword.trim()) qs.set('keyword', keyword.trim());
    if (difficulty) qs.set('difficulty', difficulty);
    if (tag) qs.set('tag', tag);
    if (favoriteOnly) qs.set('favorite', '1');

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
  }, [keyword, difficulty, tag, favoriteOnly, page]);

  async function toggleFavorite(p: ProblemSummary): Promise<void> {
    if (!user) {
      navigate('/login');
      return;
    }
    setFavPending(p.id);
    try {
      const r = await api<{ favorited: boolean }>(`/problems/${p.id}/favorite`, {
        method: p.favorited ? 'DELETE' : 'POST',
      });
      setData((prev) => {
        if (!prev) return prev;
        // 在「只看收藏」里取消收藏，就该立刻从列表消失
        if (!r.favorited && favoriteOnly) {
          return { ...prev, items: prev.items.filter((i) => i.id !== p.id), total: Math.max(0, prev.total - 1) };
        }
        return { ...prev, items: prev.items.map((i) => (i.id === p.id ? { ...i, favorited: r.favorited } : i)) };
      });
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '收藏操作失败');
    } finally {
      setFavPending(null);
    }
  }

  const solvedCount = data?.items.filter((i) => i.my_status.solved).length ?? 0;
  const colCount = 8;

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
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{s.value}</p>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center dark:border-slate-700">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                onClick={() => {
                  setDifficulty(d.value);
                  setPage(1);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  difficulty === d.value
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              // 未登录直接去登录，比让请求返回 401 再显示红字更顺
              if (!user) {
                navigate('/login');
                return;
              }
              setFavoriteOnly((v) => !v);
              setPage(1);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              favoriteOnly
                ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <span aria-hidden>★</span>
            只看收藏
          </button>

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
              className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500"
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

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
            <span className="mr-1 text-xs text-slate-400 dark:text-slate-500">标签</span>
            <button
              onClick={() => {
                setTag('');
                setPage(1);
              }}
              className={`chip transition ${
                tag === ''
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
              }`}
            >
              全部
            </button>
            {tags.map((t) => (
              <button
                key={t.name}
                onClick={() => {
                  setTag(tag === t.name ? '' : t.name);
                  setPage(1);
                }}
                className={`chip transition ${
                  tag === t.name
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                }`}
              >
                {t.name}
                <span className="ml-1 text-[10px] opacity-60">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {error && <p className="px-4 py-6 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

        <table className="table-base">
          <thead>
            <tr>
              <th className="w-16">状态</th>
              <th className="w-16">编号</th>
              <th>题目</th>
              <th className="w-40">标签</th>
              <th className="w-20">难度</th>
              <th className="w-24">通过率</th>
              <th className="w-20">提交</th>
              <th className="w-28">限制</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={colCount} className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={colCount} className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  {favoriteOnly ? '还没有收藏的题目' : '没有匹配的题目'}
                </td>
              </tr>
            )}
            {data?.items.map((p) => (
              <tr key={p.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
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
                    <span className="grid h-5 w-5 place-items-center rounded-full border border-slate-200 text-[10px] text-slate-300 dark:border-slate-700 dark:text-slate-600">
                      ·
                    </span>
                  )}
                </td>
                <td className="font-mono text-xs text-slate-400 dark:text-slate-500">#{String(p.id).padStart(4, '0')}</td>
                <td>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => toggleFavorite(p)}
                      disabled={favPending === p.id}
                      title={p.favorited ? '取消收藏' : '收藏这道题'}
                      aria-label={p.favorited ? '取消收藏' : '收藏'}
                      className={`text-sm leading-none transition ${
                        p.favorited
                          ? 'text-amber-500 hover:text-amber-600'
                          : 'text-slate-300 hover:text-amber-400 dark:text-slate-600 dark:hover:text-amber-400'
                      }`}
                    >
                      {p.favorited ? '★' : '☆'}
                    </button>
                    <Link to={`/problems/${p.id}`} className="font-medium text-slate-800 hover:text-brand-600 dark:text-slate-200 dark:hover:text-brand-400">
                      {p.title}
                    </Link>
                    {p.is_public === 0 && (
                      <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">隐藏</span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {p.tags.slice(0, 3).map((t) => (
                      <span key={t} className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {t}
                      </span>
                    ))}
                    {p.tags.length > 3 && (
                      <span className="chip bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">+{p.tags.length - 3}</span>
                    )}
                  </div>
                </td>
                <td>
                  <span className={`chip ${DIFFICULTY_META[p.difficulty].className}`}>{DIFFICULTY_META[p.difficulty].label}</span>
                </td>
                <td className="text-slate-600 dark:text-slate-300">{p.ac_rate === null ? '—' : `${p.ac_rate}%`}</td>
                <td className="text-slate-600 dark:text-slate-300">{p.submit_count}</td>
                <td className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {p.time_limit_ms}ms / {p.memory_limit_mb}MB
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
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
