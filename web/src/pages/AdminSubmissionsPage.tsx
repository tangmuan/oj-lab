import { useCallback, useEffect, useRef, useState } from 'react';
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

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({ problemId: '', from: '', to: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [batch, setBatch] = useState<{ id: string; total: number; done: number; finished: boolean } | null>(null);
  const [batchError, setBatchError] = useState('');
  const [starting, setStarting] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

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

  async function startBatch() {
    if (!confirmed || starting) return;
    setStarting(true);
    setBatchError('');
    try {
      const body: Record<string, unknown> = { confirm: true, limit: 500 };
      if (batchForm.problemId.trim()) body.problemId = Number(batchForm.problemId);
      if (status) body.status = status;
      if (batchForm.from) body.from = new Date(batchForm.from).toISOString();
      if (batchForm.to) body.to = new Date(batchForm.to).toISOString();

      const r = await api<{ batchId: string | null; total: number }>('/admin/submissions/rejudge-batch', {
        method: 'POST',
        body,
      });
      if (!r.batchId) {
        setBatchError('没有符合条件的提交');
        return;
      }
      setBatch({ id: r.batchId, total: r.total, done: 0, finished: r.total === 0 });

      const t = await api<{ ticket: string }>(`/admin/submissions/rejudge-batch/${r.batchId}/ticket`, { method: 'POST' });
      const es = new EventSource(`/api/streams/batch/${r.batchId}?ticket=${encodeURIComponent(t.ticket)}`);
      esRef.current = es;

      es.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as { type: string; done: number; total: number; finished: boolean };
        if (msg.type !== 'progress') return;
        setBatch({ id: r.batchId as string, total: msg.total, done: msg.done, finished: msg.finished });
        if (msg.finished) {
          es.close();
          esRef.current = null;
          void load();
        }
      };
      // 进度流断了就退回轮询状态接口，别让管理端以为卡死
      es.onerror = () => {
        es.close();
        esRef.current = null;
      };
    } catch (e) {
      setBatchError(e instanceof ApiError ? e.message : '批量重判失败');
    } finally {
      setStarting(false);
    }
  }

  const batchPct = batch && batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">管理端 · 提交记录</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">共 {meta.total} 条 · 可对任意提交触发重判</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost !py-1.5 text-xs" onClick={() => setBatchOpen((v) => !v)}>
            批量重判
          </button>
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

      {batchOpen && (
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">批量重判</h2>
            <span className="text-xs text-slate-400 dark:text-slate-500">一次最多 500 条，按提交 ID 升序入队</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">题目 ID（留空表示全部）</label>
              <input
                className="input"
                value={batchForm.problemId}
                onChange={(e) => setBatchForm({ ...batchForm, problemId: e.target.value })}
                placeholder="例如 5"
              />
            </div>
            <div>
              <label className="label">起始时间（可选）</label>
              <input
                type="datetime-local"
                className="input"
                value={batchForm.from}
                onChange={(e) => setBatchForm({ ...batchForm, from: e.target.value })}
              />
            </div>
            <div>
              <label className="label">结束时间（可选）</label>
              <input
                type="datetime-local"
                className="input"
                value={batchForm.to}
                onChange={(e) => setBatchForm({ ...batchForm, to: e.target.value })}
              />
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            状态筛选沿用右上角下拉（当前：{status || '全部'}）。重判会清掉旧的逐点结果并重新入队，不影响题库与测试点。
          </p>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={starting || (batch !== null && !batch.finished)}
            />
            我确认要重新判题，这会覆盖现有判题结果
          </label>

          {batchError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{batchError}</p>
          )}

          {batch && (
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full bg-brand-500 transition-all" style={{ width: `${batchPct}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                批次 #{batch.id} · 已完成 {batch.done} / {batch.total}
                {batch.finished ? ' · 全部完成' : ' · 判题进行中'}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              className="btn-primary !py-1.5 text-xs"
              onClick={startBatch}
              disabled={!confirmed || starting || (batch !== null && !batch.finished)}
            >
              {starting ? '提交中…' : '开始重判'}
            </button>
            <button className="btn-ghost !py-1.5 text-xs" onClick={() => setBatchOpen(false)}>
              收起
            </button>
          </div>
        </div>
      )}

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
                <td colSpan={9} className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  暂无提交
                </td>
              </tr>
            )}
            {items.map((s) => (
              <tr key={s.id} className="transition hover:bg-slate-50/70">
                <td className="font-mono text-xs text-slate-400 dark:text-slate-500">
                  <Link to={`/submissions/${s.id}`} className="hover:text-brand-600">
                    #{s.id}
                  </Link>
                </td>
                <td>
                  <Link to={`/problems/${s.problem_id}`} className="font-medium text-slate-800 dark:text-slate-200 hover:text-brand-600">
                    {s.problem_title}
                  </Link>
                </td>
                <td className="text-xs text-slate-600 dark:text-slate-300">{s.username}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{s.language}</td>
                <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{s.time_ms}ms</td>
                <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{formatMemory(s.memory_kb)}</td>
                <td className="text-xs text-slate-400 dark:text-slate-500">{formatDateTime(s.created_at)}</td>
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
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
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
