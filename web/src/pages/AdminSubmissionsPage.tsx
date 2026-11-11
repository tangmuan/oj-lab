import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { JudgeStatus, LanguageId, Paginated } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, formatMemory, STATUS_ORDER } from '../lib/format';

interface AdminSubmission {
  id: number;
  status: JudgeStatus;
  language: LanguageId;
  time_ms: number;
  memory_kb: number;
  pass_count: number;
  total_count: number;
  created_at: string;
  username: string;
  problem_title: string;
  problem_id: number;
  user_id: number;
}

export function AdminSubmissionsPage() {
  const [items, setItems] = useState<AdminSubmission[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rejudging, setRejudging] = useState<number | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) qs.set('status', status);
    try {
      const r = await api<Paginated<AdminSubmission>>(`/admin/submissions?${qs.toString()}`);
      setItems(r.items);
      setMeta({ page: r.page, totalPages: r.totalPages, total: r.total });
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function rejudge(id: number) {
    setRejudging(id);
    try {
      await api(`/admin/submissions/${id}/rejudge`, { method: 'POST' });
      // 判题是异步的，稍等再刷新一次
      setTimeout(() => void load(), 1200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '重判失败');
    } finally {
      setRejudging(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">管理端 · 提交记录</h1>
          <p className="mt-1 text-sm text-slate-500">共 {meta.total} 条 · 可对任意提交触发重判</p>
        </div>
        <div className="flex gap-2">
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
          <Link to="/admin" className="btn-ghost !py-1.5 text-xs">
            返回题目管理
          </Link>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}

      <div className="card overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-20">ID</th>
              <th>题目</th>
              <th className="w-24">用户</th>
              <th className="w-24">结果</th>
              <th className="w-20">语言</th>
              <th className="w-20">耗时</th>
              <th className="w-24">内存</th>
              <th className="w-36">时间</th>
              <th className="w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-slate-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-slate-400">
                  暂无提交
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
                <td className="text-xs text-slate-600">{s.username}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td className="font-mono text-xs text-slate-500">{s.language}</td>
                <td className="font-mono text-xs text-slate-500">{s.time_ms}ms</td>
                <td className="font-mono text-xs text-slate-500">{formatMemory(s.memory_kb)}</td>
                <td className="text-xs text-slate-400">{formatDateTime(s.created_at)}</td>
                <td>
                  <button
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:text-slate-300"
                    disabled={rejudging === s.id || s.status === 'PENDING' || s.status === 'JUDGING'}
                    onClick={() => rejudge(s.id)}
                  >
                    {rejudging === s.id ? '提交中…' : '重判'}
                  </button>
                </td>
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
