interface Props {
  /** 只有有提交的日期，缺口按 0 处理 */
  calendar: Array<{ date: string; count: number }>;
  weeks?: number;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/** 颜色分档：0 用空槽，其余按提交量分四档，深浅差异比连续渐变更容易辨认 */
function levelClass(count: number): string {
  if (count === 0) return 'bg-slate-100 dark:bg-slate-800';
  // 深色下用更亮的档位：brand-800 贴着卡片底色，几乎看不出有提交
  if (count <= 2) return 'bg-brand-200 dark:bg-brand-700';
  if (count <= 5) return 'bg-brand-400 dark:bg-brand-600';
  if (count <= 9) return 'bg-brand-500 dark:bg-brand-500';
  return 'bg-brand-700 dark:bg-brand-400';
}

function utcKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 类 GitHub 的提交热力图：纯 CSS grid，一行代码都不用图表库。
 * 列 = 周，行 = 周一到周日；起始周强制对齐周一，否则格子会错位。
 */
export function SubmissionHeatmap({ calendar, weeks = 26 }: Props) {
  const countMap = new Map(calendar.map((c) => [c.date, c.count]));

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (weeks * 7 - 1));
  // getUTCDay(): 周日=0，这里换算成「周一=0」再回退，保证第一列从周一开始
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));

  const columns: Array<Array<{ date: string; count: number | null }>> = [];
  for (let w = 0; w < weeks; w += 1) {
    const col: Array<{ date: string; count: number | null }> = [];
    for (let d = 0; d < 7; d += 1) {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + w * 7 + d);
      const key = utcKey(day);
      col.push({ date: key, count: day > today ? null : (countMap.get(key) ?? 0) });
    }
    columns.push(col);
  }

  const total = calendar.reduce((sum, c) => sum + c.count, 0);

  return (
    <div>
      <div className="flex items-start gap-2 overflow-x-auto pb-1">
        <div className="flex shrink-0 flex-col gap-1 pt-[1px] text-[10px] leading-3 text-slate-400 dark:text-slate-500">
          {WEEKDAYS.map((w, i) => (
            <span key={w} className="h-3 leading-3">
              {i % 2 === 0 ? w : ''}
            </span>
          ))}
        </div>

        <div className="flex gap-1">
          {columns.map((col, wi) => (
            <div key={`w-${wi}`} className="flex flex-col gap-1">
              {col.map((cell) =>
                cell.count === null ? (
                  <span key={cell.date} className="h-3 w-3 rounded-sm" aria-hidden />
                ) : (
                  <span
                    key={cell.date}
                    title={`${cell.date} · ${cell.count} 次提交`}
                    className={`h-3 w-3 rounded-sm ${levelClass(cell.count)}`}
                  />
                )
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 dark:text-slate-500">
        <span>最近 {weeks} 周共 {total} 次提交</span>
        <span className="flex items-center gap-1">
          少
          <span className="h-3 w-3 rounded-sm bg-slate-100 dark:bg-slate-800" />
          <span className="h-3 w-3 rounded-sm bg-brand-200 dark:bg-brand-700" />
          <span className="h-3 w-3 rounded-sm bg-brand-400 dark:bg-brand-600" />
          <span className="h-3 w-3 rounded-sm bg-brand-500 dark:bg-brand-500" />
          <span className="h-3 w-3 rounded-sm bg-brand-700 dark:bg-brand-400" />
          多
        </span>
      </div>
    </div>
  );
}
