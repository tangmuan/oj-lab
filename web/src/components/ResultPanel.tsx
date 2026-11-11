import type { JudgeStatus } from '../api/types';
import { formatMemory, STATUS_META } from '../lib/format';

export interface LiveCase {
  case_index: number;
  status: JudgeStatus;
  time_ms: number;
  memory_kb: number;
  is_sample: number;
  message: string | null;
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

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`${BADGE_SIZE} ${meta.className}`}>
          {isRunning && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-current align-middle" />}
          {meta.label}
        </span>
        <div className="flex gap-4 text-xs text-slate-500">
          <span>
            耗时 <b className="font-mono font-medium text-slate-700">{timeMs} ms</b>
          </span>
          <span title={memoryKb > 0 ? undefined : '程序运行过快，采样间隔内已退出，未采到内存峰值'}>
            内存 <b className="font-mono font-medium text-slate-700">{formatMemory(memoryKb)}</b>
          </span>
          <span>
            通过{' '}
            <b className="font-mono font-medium text-slate-700">
              {passCount}/{shownTotal}
            </b>
          </span>
        </div>
      </div>

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
                  <span className="text-xs font-medium text-slate-600">
                    测试点 {c.case_index}
                    {c.is_sample === 1 && <span className="ml-1 text-[10px] text-slate-400">样例</span>}
                  </span>
                  <span className={`text-[11px] font-semibold ${c.status === 'AC' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {c.status}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>{cm.label}</span>
                  <span className="font-mono">{c.time_ms}ms</span>
                </div>
              </div>
            );
          })}
          {isRunning && shownTotal > cases.length && (
            <div className="grid place-items-center rounded-lg border border-dashed border-slate-200 px-2.5 py-2 text-[11px] text-slate-400">
              等待结果…
            </div>
          )}
        </div>
      )}

      {cases.some((c) => c.message) && !compileMsg && (
        <ul className="mt-3 space-y-1 text-xs text-slate-500">
          {cases
            .filter((c) => c.message)
            .slice(0, 3)
            .map((c) => (
              <li key={c.case_index}>
                <span className="font-medium text-slate-600">测试点 {c.case_index}：</span>
                {c.message}
              </li>
            ))}
        </ul>
      )}

      {compileMsg && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-slate-500">{status === 'CE' ? '编译输出' : '判题信息'}</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 font-mono text-[12px] leading-5 text-slate-100">
            {compileMsg}
          </pre>
        </div>
      )}

      {isRunning && cases.length === 0 && !compileMsg && (
        <p className="mt-4 text-xs text-slate-400">正在编译并运行测试点，结果会实时出现在这里…</p>
      )}
    </div>
  );
}
