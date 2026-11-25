import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { JudgeStatus, UserProfile } from '../api/types';
import { SubmissionHeatmap } from '../components/SubmissionHeatmap';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, formatMemory, HIDDEN_HINT, STATUS_META } from '../lib/format';

const BAR_COLOR: Record<JudgeStatus, string> = {
  PENDING: 'bg-slate-300 dark:bg-slate-600',
  JUDGING: 'bg-brand-400',
  AC: 'bg-emerald-500',
  WA: 'bg-rose-500',
  TLE: 'bg-amber-500',
  MLE: 'bg-purple-500',
  RE: 'bg-red-500',
  CE: 'bg-slate-400 dark:bg-slate-500',
  OLE: 'bg-orange-400',
  SE: 'bg-slate-300 dark:bg-slate-600',
  HIDDEN: 'bg-indigo-400',
};

export function UserProfilePage() {
  const { id } = useParams();
  const [data, setData] = useState<UserProfile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const uid = Number(id);
    if (!Number.isInteger(uid) || uid <= 0) {
      setError('用户不存在');
      return;
    }
    setError('');
    api<UserProfile>(`/stats/users/${uid}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'));
  }, [id]);

  if (error) {
    return (
      <div className="card mx-auto mt-16 max-w-md p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{error}</h2>
        <Link to="/" className="btn-ghost mt-5 inline-flex">
          返回题目列表
        </Link>
      </div>
    );
  }
  if (!data) return <div className="py-24 text-center text-sm text-slate-400 dark:text-slate-500">加载中…</div>;

  const total = data.distribution.reduce((sum, d) => sum + d.c, 0);
  const cards = [
    { label: '已解决', value: data.stats.solved, hint: '去重后的 AC 题目数' },
    { label: '总提交', value: data.stats.submitCount, hint: '含未通过' },
    { label: '通过次数', value: data.stats.acCount, hint: 'AC 提交数' },
    { label: '通过率', value: data.stats.acRate === null ? '—' : `${data.stats.acRate}%`, hint: 'AC / 总提交' },
  ];

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center gap-4 p-5">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-xl font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          {data.user.username.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {data.user.username}
            {data.user.role === 'admin' && (
              <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">管理员</span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">加入于 {formatDateTime(data.user.created_at)}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card px-4 py-3.5">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{c.value}</p>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">提交活跃度</h2>
          <span className="text-xs text-slate-400 dark:text-slate-500">按 UTC 日期统计</span>
        </div>
        <SubmissionHeatmap calendar={data.calendar} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">状态分布</h2>
        {total === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">还没有提交记录</p>
        ) : (
          <>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              {data.distribution.map((d) => (
                <span
                  key={d.status}
                  title={`${STATUS_META[d.status]?.label ?? d.status} ${d.c} 次`}
                  className={BAR_COLOR[d.status] ?? BAR_COLOR.SE}
                  style={{ width: `${(d.c / total) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
              {data.distribution.map((d) => (
                <span key={d.status} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${BAR_COLOR[d.status] ?? BAR_COLOR.SE}`} />
                  {STATUS_META[d.status]?.label ?? d.status}
                  <b className="font-mono font-medium text-slate-700 dark:text-slate-300">{d.c}</b>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">最近提交</h2>
        </div>
        {data.recent.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">还没有提交记录</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-24">结果</th>
                <th>题目</th>
                <th className="w-24">语言</th>
                <th className="w-24">耗时</th>
                <th className="w-28">内存</th>
                <th className="w-44">时间</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((s) => (
                <tr key={s.id}>
                  <td>
                    <StatusBadge status={s.status} />
                    {s.status === 'HIDDEN' && <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">{HIDDEN_HINT}</span>}
                  </td>
                  <td>
                    <Link
                      to={`/submissions/${s.id}`}
                      className="font-medium text-slate-800 hover:text-brand-600 dark:text-slate-200 dark:hover:text-brand-400"
                    >
                      {s.problem_title}
                    </Link>
                  </td>
                  <td className="text-xs text-slate-500 dark:text-slate-400">{s.language}</td>
                  <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{s.time_ms} ms</td>
                  <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{formatMemory(s.memory_kb)}</td>
                  <td className="text-xs text-slate-500 dark:text-slate-400">{formatDateTime(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
