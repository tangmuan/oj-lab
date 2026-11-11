import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { AdminProblem, Role } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { DIFFICULTY_META } from '../lib/format';

interface AdminUser {
  id: number;
  username: string;
  role: Role;
  created_at: string;
  submit_count: number;
  solved: number;
}

export function AdminProblemsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [problems, setProblems] = useState<AdminProblem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function reload() {
    try {
      const [p, u] = await Promise.all([
        api<{ items: AdminProblem[] }>('/admin/problems'),
        api<{ items: AdminUser[] }>('/admin/users'),
      ]);
      setProblems(p.items);
      setUsers(u.items);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function remove(p: AdminProblem) {
    if (!confirm(`确定删除题目「${p.title}」？其测试点与提交记录会一并删除，且不可恢复。`)) return;
    try {
      await api(`/admin/problems/${p.id}`, { method: 'DELETE' });
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '删除失败');
    }
  }

  async function toggleRole(u: AdminUser) {
    const next: Role = u.role === 'admin' ? 'user' : 'admin';
    if (!confirm(`把「${u.username}」的角色改为 ${next === 'admin' ? '管理员' : '普通用户'}？`)) return;
    try {
      await api(`/admin/users/${u.id}/role`, { method: 'PATCH', body: { role: next } });
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '修改失败');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">管理端 · 题目</h1>
          <p className="mt-1 text-sm text-slate-500">维护题面、测试点与可见性；测试点决定判题结果</p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/submissions" className="btn-ghost !py-1.5 text-xs">
            提交记录
          </Link>
          <button className="btn-primary !py-1.5 text-xs" onClick={() => navigate('/admin/problems/new')}>
            + 新建题目
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}

      <div className="card overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-16">ID</th>
              <th>标题</th>
              <th className="w-20">难度</th>
              <th className="w-20">状态</th>
              <th className="w-20">测试点</th>
              <th className="w-20">提交数</th>
              <th className="w-24">限制</th>
              <th className="w-32">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && problems.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                  还没有题目，点击右上角新建
                </td>
              </tr>
            )}
            {problems.map((p) => (
              <tr key={p.id} className="transition hover:bg-slate-50/70">
                <td className="font-mono text-xs text-slate-400">#{p.id}</td>
                <td className="font-medium text-slate-800">{p.title}</td>
                <td>
                  <span className={`chip ${DIFFICULTY_META[p.difficulty].className}`}>{DIFFICULTY_META[p.difficulty].label}</span>
                </td>
                <td>
                  {p.is_public ? (
                    <span className="chip bg-emerald-50 text-emerald-700">公开</span>
                  ) : (
                    <span className="chip bg-slate-100 text-slate-500">隐藏</span>
                  )}
                </td>
                <td className="font-mono text-xs text-slate-500">{p.case_count}</td>
                <td className="font-mono text-xs text-slate-500">{p.submit_count}</td>
                <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                  {p.time_limit_ms}ms / {p.memory_limit_mb}MB
                </td>
                <td>
                  <div className="flex gap-2">
                    <Link to={`/admin/problems/${p.id}/edit`} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                      编辑
                    </Link>
                    <button className="text-xs font-medium text-rose-500 hover:text-rose-600" onClick={() => remove(p)}>
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">用户</h2>
        </div>
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-16">ID</th>
              <th>用户名</th>
              <th className="w-24">角色</th>
              <th className="w-24">通过题数</th>
              <th className="w-24">提交次数</th>
              <th className="w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="font-mono text-xs text-slate-400">#{u.id}</td>
                <td className="font-medium text-slate-800">{u.username}</td>
                <td>
                  {u.role === 'admin' ? (
                    <span className="chip bg-amber-50 text-amber-700">管理员</span>
                  ) : (
                    <span className="chip bg-slate-100 text-slate-500">普通用户</span>
                  )}
                </td>
                <td className="font-mono text-xs text-slate-500">{u.solved}</td>
                <td className="font-mono text-xs text-slate-500">{u.submit_count}</td>
                <td>
                  <button
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:text-slate-300"
                    disabled={u.id === user?.id}
                    onClick={() => toggleRole(u)}
                  >
                    {u.id === user?.id ? '当前账号' : u.role === 'admin' ? '设为普通用户' : '设为管理员'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
