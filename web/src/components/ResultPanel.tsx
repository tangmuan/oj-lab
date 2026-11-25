import type { FirstDiff, JudgeStatus } from '../api/types';
import { formatMemory, STATUS_META } from '../lib/format';

export interface LiveCase {
  case_index: number;
  status: JudgeStatus;
  time_ms: number;
  memory_kb: number;
  is_sample: number;
  message: string | null;
  /** 旧提交没有该字段 */
  first_diff?: FirstDiff | null;
}

interface Props {
  status: JudgeStatus;
  cases: LiveCase[];
  timeMs?: number;
  memoryKb?: number;
  passCount?: number;
  totalCount?: number;
  compileMsg?: string | null;
  expectedCases?: number;
}

const BADGE_SIZE = 'rounded-lg px-3 py-1.5 text-sm font-semibold';

export function ResultPanel({ status, cases, timeMs = 0, memoryKb = 0, passCount = 0, totalCount = 0, compileMsg, expectedCases }: Props) {
  const meta = STATUS_META[status] ?? STATUS_META.SE;
  const isRunning = status === 'PENDING' || status === 'JUDGING';
  const shownTotal = totalCount || expectedCases || cases.length;
  // 只展示带定位信息的 WA 测试点；旧数据 first_diff 缺失时整块不渲染
  const waDiffs = cases.filter((c) => c.status === 'WA' && c.first_diff).slice(0, 3);

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`${BADGE_SIZE} ${meta.className}`}>
          {isRunning && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-current align-middle" />}
          {meta.label}
        </span>
        <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>
            耗时 <b className="font-mono font-medium text-slate-700 dark:text-slate-300">{timeMs} ms</b>
          </span>
          <span title={memoryKb > 0 ? undefined : '程序运行过快，采样间隔内已退出，未采到内存峰值'}>
            内存 <b className="font-mono font-medium text-slate-700 dark:text-slate-300">{formatMemory(memoryKb)}</b>
          </span>
          <span>
            通过{' '}
            <b className="font-mono font-medium text-slate-700 dark:text-slate-300">
              {passCount}/{shownTotal}
            </b>
          </span>
        </div>
      </div>

      {status === 'HIDDEN' && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">封榜中，结果赛后公布。耗时 / 内存 / 通过点已临时隐藏。</p>
      )}

      {cases.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {cases.map((c) => {
            const cm = STATUS_META[c.status] ?? STATUS_META.SE;
            return (
              <div
                key={c.case_index}
                className={`rounded-lg border px-2.5 py-2 ${
                  c.status === 'AC' ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50'
                }`}
                title={c.message || undefined}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    测试点 {c.case_index}
                    {c.is_sample === 1 && <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">样例</span>}
                  </span>
                  <span className={`text-[11px] font-semibold ${c.status === 'AC' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {c.status}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
                  <span>{cm.label}</span>
                  <span className="font-mono">{c.time_ms}ms</span>
                </div>
              </div>
            );
          })}
          {isRunning && shownTotal > cases.length && (
            <div className="grid place-items-center rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-2.5 py-2 text-[11px] text-slate-400 dark:text-slate-500">
              等待结果…
            </div>
          )}
        </div>
      )}

      {waDiffs.length > 0 && (
        <div className="mt-3 space-y-2">
          {waDiffs.map((c) => {
            const diff = c.first_diff as FirstDiff;
            const hasContent = diff.actualLine !== null || diff.expectedLine !== null;
            return (
              <div
                key={`diff-${c.case_index}`}
                className="rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 dark:border-rose-500/30 dark:bg-rose-500/10"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-rose-700 dark:text-rose-300">测试点 {c.case_index}</span>
                  <span className="text-rose-600 dark:text-rose-300/90">
                    第 {diff.line} 行 · 第 {diff.column} 列起不同
                  </span>
                  {!hasContent && <span className="text-[11px] text-rose-500/80 dark:text-rose-300/70">（隐藏测试点只给位置）</span>}
                </div>
                {hasContent && (
                  <div className="mt-1.5 space-y-0.5 font-mono text-[11.5px] leading-5">
                    <div className="flex gap-2">
                      <span className="w-3 shrink-0 text-rose-500 dark:text-rose-400">−</span>
                      <span className="truncate text-rose-800 dark:text-rose-200">{diff.expectedLine ?? '（没有这一行）'}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-3 shrink-0 text-emerald-600 dark:text-emerald-400">+</span>
                      <span className="truncate text-emerald-800 dark:text-emerald-200">{diff.actualLine ?? '（没有这一行）'}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {cases.some((c) => c.message) && !compileMsg && (
        <ul className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
          {cases
            // 已经有差异卡片的 WA 不再重复一遍同样的位置信息
            .filter((c) => c.message && !(c.status === 'WA' && c.first_diff))
            .slice(0, 3)
            .map((c) => (
              <li key={c.case_index}>
                <span className="font-medium text-slate-600 dark:text-slate-300">测试点 {c.case_index}：</span>
                {c.message}
              </li>
            ))}
        </ul>
      )}

      {compileMsg && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{status === 'CE' ? '编译输出' : '判题信息'}</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 dark:bg-slate-950 p-3 font-mono text-[12px] leading-5 text-slate-100">
            {compileMsg}
          </pre>
        </div>
      )}

      {isRunning && cases.length === 0 && !compileMsg && (
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">正在编译并运行测试点，结果会实时出现在这里…</p>
      )}
    </div>
  );
}
