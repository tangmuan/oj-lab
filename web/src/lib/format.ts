import type { Difficulty, JudgeStatus, RunStatus } from '../api/types';

export const STATUS_META: Record<JudgeStatus, { label: string; className: string; dot: string }> = {
  PENDING: { label: '等待中', className: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  JUDGING: { label: '判题中', className: 'bg-brand-50 text-brand-700', dot: 'bg-brand-500 animate-pulse' },
  AC: { label: '通过', className: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  WA: { label: '答案错误', className: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500' },
  TLE: { label: '运行超时', className: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  MLE: { label: '超出内存', className: 'bg-purple-50 text-purple-700', dot: 'bg-purple-500' },
  RE: { label: '运行错误', className: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  CE: { label: '编译错误', className: 'bg-slate-100 text-slate-600', dot: 'bg-slate-500' },
  OLE: { label: '输出超限', className: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  SE: { label: '系统错误', className: 'bg-slate-100 text-slate-600', dot: 'bg-slate-500' },
};

export const DIFFICULTY_META: Record<Difficulty, { label: string; className: string }> = {
  easy: { label: '简单', className: 'bg-emerald-50 text-emerald-700' },
  medium: { label: '中等', className: 'bg-amber-50 text-amber-700' },
  hard: { label: '困难', className: 'bg-rose-50 text-rose-700' },
};

export const STATUS_ORDER: JudgeStatus[] = ['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'SE', 'JUDGING', 'PENDING'];

/** 自测运行的返回状态（OK 表示正常跑完，不做答案比对） */
export const RUN_STATUS_META: Record<RunStatus, { label: string; className: string }> = {
  OK: { label: '运行完成', className: 'bg-emerald-50 text-emerald-700' },
  TLE: { label: '运行超时', className: 'bg-amber-50 text-amber-700' },
  MLE: { label: '超出内存', className: 'bg-purple-50 text-purple-700' },
  RE: { label: '运行错误', className: 'bg-red-50 text-red-700' },
  OLE: { label: '输出超限', className: 'bg-amber-50 text-amber-700' },
  CE: { label: '编译错误', className: 'bg-slate-100 text-slate-600' },
};

export function formatDateTime(utc: string | null | undefined): string {
  if (!utc) return '—';
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return utc;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function formatMemory(kb: number): string {
  if (!kb || kb <= 0) return '—';
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatTimeLimit(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}
