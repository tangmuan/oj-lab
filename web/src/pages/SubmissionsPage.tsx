import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Paginated, SubmissionSummary } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, formatMemory, STATUS_ORDER } from '../lib/format';

export function SubmissionsPage() {
  const [items, setItems] = useState<SubmissionSummary[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ mine: '1', page: String(page), pageSize: '20' });
    if (status) qs.set('status', status);
    api<Paginated<SubmissionSummary>>(`/submissions?${qs.toString()}`)
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setMeta({ page: r.page, totalPages: r.totalPages, total: r.total });
        setError('');
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [page, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">我的提交</h1>
          <p className="mt-1 text-sm text-slate-500">共 {meta.total} 条记录，点击可查看代码与逐测试点结果</p>
        </div>
        <select
          className="input !w-auto !py-1.5 text-xs"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}

      <div className="card overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-24">编号</th>
              <th>题目</th>
              <th className="w-28">结果</th>
              <th className="w-24">语言</th>
              <th className="w-20">耗时</th>
              <th className="w-24">内存</th>
              <th className="w-24">通过点</th>
              <th className="w-40">提交时间</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                  还没有提交记录，去 <Link to="/" className="text-brand-600">做一题</Link> 吧
                </td>
              </tr>
            )}
            {items.map((s) => (
              <tr key={s.id} className="transition hover:bg-slate-50/70">
                <td className="font-mono text-xs text-slate-400">
                  <Link to={`/submissions/${s.id}`} className="hover:text-brand-600">
                    #{s.id}
                  </Link>
                </td>
                <td>
                  <Link to={`/problems/${s.problem_id}`} className="font-medium text-slate-800 hover:text-brand-600">
                    {s.problem_title}
                  </Link>
                </td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td className="font-mono text-xs text-slate-500">{s.language}</td>
                <td className="font-mono text-xs text-slate-500">{s.time_ms}ms</td>
                <td className="font-mono text-xs text-slate-500">{formatMemory(s.memory_kb)}</td>
                <td className="font-mono text-xs text-slate-500">
                  {s.pass_count}/{s.total_count}
                </td>
                <td className="text-xs text-slate-400">{formatDateTime(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
            <span>
              第 {meta.page}/{meta.totalPages} 页
            </span>
            <div className="flex gap-2">
              <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <button
                className="btn-ghost !px-2.5 !py-1 text-xs"
                disabled={page >= meta.totalPages}
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
