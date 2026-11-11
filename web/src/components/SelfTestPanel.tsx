import { useState } from 'react';
import type { RunResult, Sample } from '../api/types';
import { formatMemory, RUN_STATUS_META } from '../lib/format';

interface Props {
  input: string;
  onInputChange: (value: string) => void;
  result: RunResult | null;
  running: boolean;
  error: string;
  samples: Sample[];
  onFillSample: (input: string) => void;
  showSampleShortcuts?: boolean;
}

export function SelfTestPanel({ input, onInputChange, result, running, error, samples, onFillSample, showSampleShortcuts = true }: Props) {
  const meta = result ? RUN_STATUS_META[result.status] : null;
  const [copied, setCopied] = useState(false);

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(result?.stdout ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默忽略 */
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-800">自测运行</h3>
        <span className="text-xs text-slate-400">用你自己的输入跑一遍，不会计入提交记录</span>

        {showSampleShortcuts && samples.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400">填充样例</span>
            {samples.slice(0, 3).map((s, i) => (
              <button
                key={s.id}
                className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 hover:border-brand-300 hover:text-brand-600"
                onClick={() => onFillSample(s.input)}
              >
                #{i + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] font-medium text-slate-400">标准输入</label>
            <button
              className="text-[11px] text-slate-400 hover:text-slate-600"
              onClick={() => onInputChange('')}
              type="button"
            >
              清空
            </button>
          </div>
          <textarea
            className="input h-32 resize-y font-mono text-xs leading-5"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder={'在此粘贴或输入测试数据\n例如：\n1 2'}
            spellCheck={false}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] font-medium text-slate-400">程序输出</label>
            <button
              className="text-[11px] text-slate-400 hover:text-slate-600 disabled:opacity-40"
              onClick={copyOutput}
              disabled={!result?.stdout}
              type="button"
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <pre
            data-testid="self-output"
            className="h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-xs leading-5 text-slate-100"
          >
            {running ? '运行中…' : result ? result.stdout || (result.status === 'OK' ? '（程序没有输出）' : '') : '点击「运行」后在这里查看输出'}
          </pre>
        </div>
      </div>

      {meta && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className={`chip ${meta.className}`}>{meta.label}</span>
          <span>
            耗时 <b className="font-mono text-slate-700">{result?.timeMs ?? 0} ms</b>
          </span>
          <span>
            内存 <b className="font-mono text-slate-700">{formatMemory(result?.memoryKb ?? 0)}</b>
          </span>
          {result?.exitCode !== null && result?.exitCode !== undefined && (
            <span>
              退出码 <b className="font-mono text-slate-700">{result.exitCode}</b>
            </span>
          )}
          {result?.truncated && <span className="text-amber-600">输出过长，已截断显示</span>}
          <span className="ml-auto text-slate-400">Ctrl + Enter 运行 · Ctrl + Shift + Enter 提交</span>
        </div>
      )}

      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

      {result?.compileMsg && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-slate-500">编译输出</p>
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 font-mono text-[12px] leading-5 text-slate-100">
            {result.compileMsg}
          </pre>
        </div>
      )}

      {result?.stderr && !result.compileMsg && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-rose-500">标准错误（stderr）</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-rose-200 bg-rose-50 p-3 font-mono text-[12px] leading-5 text-rose-700">
            {result.stderr}
          </pre>
        </div>
      )}
    </div>
  );
}
