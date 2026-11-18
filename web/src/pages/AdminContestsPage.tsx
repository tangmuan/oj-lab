import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { AdminContest, AdminContestDetail, AdminProblem } from '../api/types';
import { formatDateTime, parseUtc } from '../lib/format';

interface FormState {
  title: string;
  /** datetime-local 的本地时间字符串 */
  startLocal: string;
  endLocal: string;
  frozenMinutes: string;
  isPublic: 0 | 1;
}

/** UTC 的 SQL 时间 → datetime-local 需要的本地 'YYYY-MM-DDTHH:MM' */
function toLocalInput(sqlUtc: string): string {
  const d = parseUtc(sqlUtc);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_FORM: FormState = { title: '', startLocal: '', endLocal: '', frozenMinutes: '0', isPublic: 1 };

export function AdminContestsPage() {
  const [items, setItems] = useState<AdminContest[]>([]);
  const [problems, setProblems] = useState<AdminProblem[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  function loadList() {
    api<{ items: AdminContest[] }>('/admin/contests')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadList();
    api<{ items: AdminProblem[] }>('/admin/problems')
      .then((r) => setProblems(r.items))
      .catch(() => undefined);
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSelected([]);
    setError('');
  }

  async function edit(contest: AdminContest) {
    setOkMsg('');
    try {
      const r = await api<AdminContestDetail>(`/admin/contests/${contest.id}`);
      setEditingId(contest.id);
      setForm({
        title: r.contest.title,
        startLocal: toLocalInput(r.contest.start_at),
        endLocal: toLocalInput(r.contest.end_at),
        frozenMinutes: String(r.contest.frozen_minutes),
        isPublic: r.contest.is_public as 0 | 1,
      });
      setSelected(r.problems.map((p) => p.problemId));
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载比赛失败');
    }
  }

  async function save() {
    setError('');
    setOkMsg('');
    if (!form.title.trim()) {
      setError('标题不能为空');
      return;
    }
    if (!form.startLocal || !form.endLocal) {
      setError('请填写开始与结束时间');
      return;
    }
    const start = new Date(form.startLocal);
    const end = new Date(form.endLocal);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setError('时间格式不正确');
      return;
    }
    if (end <= start) {
      setError('结束时间必须晚于开始时间');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        frozen_minutes: Number(form.frozenMinutes) || 0,
        is_public: form.isPublic,
      };

      let contestId = editingId;
      if (contestId === null) {
        const created = await api<{ id: number }>('/admin/contests', { method: 'POST', body: payload });
        contestId = created.id;
      } else {
        await api(`/admin/contests/${contestId}`, { method: 'PUT', body: payload });
      }

      await api(`/admin/contests/${contestId}/problems`, {
        method: 'PUT',
        body: { problems: selected.map((problemId, idx) => ({ problemId, ord: idx + 1 })) },
      });

      setEditingId(contestId);
      setOkMsg('已保存');
      loadList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function unfreeze(contest: AdminContest) {
    try {
      await api(`/admin/contests/${contest.id}/unfreeze`, { method: 'POST' });
      loadList();
      setOkMsg(`「${contest.title}」已手动解封`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '解封失败');
    }
  }

  async function remove(contest: AdminContest) {
    try {
      await api(`/admin/contests/${contest.id}`, { method: 'DELETE' });
      if (editingId === contest.id) resetForm();
      loadList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '删除失败');
    }
  }

  const orderedProblems = [...problems].sort((a, b) => a.id - b.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <Link to="/admin" className="hover:text-slate-600 dark:hover:text-slate-300">
          管理端
        </Link>
        <span>/</span>
        <span className="text-slate-500 dark:text-slate-400">比赛管理</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">比赛管理</h1>
        <button className="btn-ghost !py-1.5 text-xs" onClick={resetForm}>
          + 新建比赛
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
      {okMsg && (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{okMsg}</p>
      )}

      <div className="card overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>标题</th>
              <th className="w-56">时间</th>
              <th className="w-20">题数</th>
              <th className="w-20">报名</th>
              <th className="w-24">封榜</th>
              <th className="w-56">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-slate-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-slate-400">
                  还没有比赛，点右上角新建
                </td>
              </tr>
            )}
            {items.map((c) => (
              <tr key={c.id} className={editingId === c.id ? 'bg-brand-50/40 dark:bg-brand-500/10' : ''}>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{c.title}</span>
                    {c.is_public === 0 && (
                      <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">隐藏</span>
                    )}
                    {c.unfrozen_at && (
                      <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">已手动解封</span>
                    )}
                  </div>
                </td>
                <td className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(c.start_at)}
                  <br />
                  {formatDateTime(c.end_at)}
                </td>
                <td className="font-mono text-xs text-slate-600 dark:text-slate-300">{c.problem_count}</td>
                <td className="font-mono text-xs text-slate-600 dark:text-slate-300">{c.registered_count}</td>
                <td className="font-mono text-xs text-slate-600 dark:text-slate-300">{c.frozen_minutes} 分</td>
                <td>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button className="text-brand-600 hover:text-brand-700 dark:text-brand-400" onClick={() => edit(c)}>
                      编辑 / 挂题
                    </button>
                    <button className="text-amber-600 hover:text-amber-700 dark:text-amber-400" onClick={() => unfreeze(c)}>
                      解封
                    </button>
                    <button className="text-rose-500 hover:text-rose-600 dark:text-rose-400" onClick={() => remove(c)}>
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          {editingId === null ? '新建比赛' : `编辑比赛 #${editingId}`}
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">标题</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：2026 秋季赛第一场" />
          </div>
          <div>
            <label className="label">开始时间</label>
            <input
              type="datetime-local"
              className="input"
              value={form.startLocal}
              onChange={(e) => setForm({ ...form, startLocal: e.target.value })}
            />
          </div>
          <div>
            <label className="label">结束时间</label>
            <input
              type="datetime-local"
              className="input"
              value={form.endLocal}
              onChange={(e) => setForm({ ...form, endLocal: e.target.value })}
            />
          </div>
          <div>
            <label className="label">封榜时长（分钟，0 表示不封榜）</label>
            <input
              type="number"
              min={0}
              max={600}
              className="input"
              value={form.frozenMinutes}
              onChange={(e) => setForm({ ...form, frozenMinutes: e.target.value })}
            />
          </div>
          <div>
            <label className="label">可见性</label>
            <select
              className="input"
              value={form.isPublic}
              onChange={(e) => setForm({ ...form, isPublic: Number(e.target.value) as 0 | 1 })}
            >
              <option value={1}>公开</option>
              <option value={0}>隐藏（仅管理员）</option>
            </select>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="label !mb-0">比赛题目（勾选顺序即 A/B/C 编号）</label>
            <span className="text-xs text-slate-400">已选 {selected.length} 道</span>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            {orderedProblems.map((p) => {
              const idx = selected.indexOf(p.id);
              return (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                    checked={idx >= 0}
                    onChange={(e) => {
                      setSelected((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)));
                    }}
                  />
                  {idx >= 0 && (
                    <span className="w-5 shrink-0 font-mono text-xs font-semibold text-brand-600 dark:text-brand-400">
                      {String.fromCharCode(65 + idx)}
                    </span>
                  )}
                  <span className="text-slate-700 dark:text-slate-300">
                    #{p.id} {p.title}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost !py-1.5 text-xs" onClick={resetForm}>
            重置
          </button>
          <button className="btn-primary !py-1.5 text-xs" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
