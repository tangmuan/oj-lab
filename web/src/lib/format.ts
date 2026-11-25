import type { Difficulty, JudgeStatus, RunStatus } from '../api/types';

export const STATUS_META: Record<JudgeStatus, { label: string; className: string; dot: string }> = {
  PENDING: {
    label: '等待中',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
  JUDGING: {
    label: '判题中',
    className: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
    dot: 'bg-brand-500 animate-pulse',
  },
  AC: {
    label: '通过',
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  WA: {
    label: '答案错误',
    className: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  TLE: {
    label: '运行超时',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  MLE: {
    label: '超出内存',
    className: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
    dot: 'bg-purple-500',
  },
  RE: {
    label: '运行错误',
    className: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    dot: 'bg-red-500',
  },
  CE: {
    label: '编译错误',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-500',
  },
  OLE: {
    label: '输出超限',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  SE: {
    label: '系统错误',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-500',
  },
  HIDDEN: {
    label: '封榜中',
    className: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    dot: 'bg-indigo-500',
  },
};

export const DIFFICULTY_META: Record<Difficulty, { label: string; className: string }> = {
  easy: { label: '简单', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  medium: { label: '中等', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  hard: { label: '困难', className: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
};

export const STATUS_ORDER: JudgeStatus[] = ['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'SE', 'JUDGING', 'PENDING'];

/** 封榜打码提交的补充说明：HIDDEN 不进 STATUS_ORDER（库里没有这个值，不能作为筛选条件） */
export const HIDDEN_HINT = '结果赛后公布';

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

/** SQLite 的 UTC 'YYYY-MM-DD HH:MM:SS' 转成本地 Date；非法值返回 null */
export function parseUtc(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 倒计时文案：超过一小时给「1 小时 23 分」，否则给 mm:ss */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours} 小时 ${pad(minutes)} 分` : `${pad(minutes)}:${pad(seconds)}`;
}
