import { useMemo } from 'react';
import { diffLines, diffStats, foldContext, type DiffRow } from '../lib/diff';

interface Props {
  oldCode: string;
  newCode: string;
  oldLabel?: string;
  newLabel?: string;
  maxHeight?: string;
}

const ROW_CLASS: Record<DiffRow['type'], string> = {
  same: '',
  add: 'bg-emerald-50 dark:bg-emerald-500/10',
  del: 'bg-rose-50 dark:bg-rose-500/10',
};

const SIGN: Record<DiffRow['type'], string> = { same: ' ', add: '+', del: '−' };

/**
 * 手写的逐行 diff 视图：没有语法高亮，但零依赖、按行号对齐，
 * 学生关心的是「哪一行开始不同」，不是配色。
 */
export function CodeDiffView({ oldCode, newCode, oldLabel = '上一次', newLabel = '本次', maxHeight = '520px' }: Props) {
  const rows = useMemo(() => diffLines(oldCode, newCode), [oldCode, newCode]);
  const blocks = useMemo(() => foldContext(rows), [rows]);
  const { added, removed } = useMemo(() => diffStats(rows), [rows]);

  if (oldCode === newCode) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800/50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
        两次提交的代码完全一致
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700" data-testid="code-diff">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/60">
        <span className="text-slate-600 dark:text-slate-300">
          {oldLabel} → {newLabel}
        </span>
        <span className="flex items-center gap-3 font-mono">
          <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>
          <span className="text-rose-600 dark:text-rose-400">−{removed}</span>
        </span>
      </div>

      <div className="overflow-auto font-mono text-[12.5px] leading-5" style={{ maxHeight }}>
        {blocks.map((block, bi) => {
          if (!block.rows) {
            return (
              <div
                key={`fold-${bi}`}
                className="border-y border-dashed border-slate-200 bg-slate-50/60 px-3 py-1 text-center text-[11px] text-slate-400 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-500"
              >
                … 省略 {block.hiddenCount} 行未改动 …
              </div>
            );
          }
          return block.rows.map((row) => (
            <div key={`${row.oldLine ?? 'x'}-${row.newLine ?? 'x'}-${row.type}`} className={`flex ${ROW_CLASS[row.type]}`}>
              <span className="w-10 shrink-0 select-none pr-2 text-right text-slate-400 dark:text-slate-500">{row.oldLine ?? ''}</span>
              <span className="w-10 shrink-0 select-none pr-2 text-right text-slate-400 dark:text-slate-500">{row.newLine ?? ''}</span>
              <span
                className={`w-4 shrink-0 select-none text-center ${
                  row.type === 'add'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : row.type === 'del'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-transparent'
                }`}
              >
                {SIGN[row.type]}
              </span>
              <span className="whitespace-pre pr-4 text-slate-700 dark:text-slate-300 dark:text-slate-200">{row.text === '' ? '\u00a0' : row.text}</span>
            </div>
          ));
        })}
      </div>
    </div>
  );
}
