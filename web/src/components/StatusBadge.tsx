import type { JudgeStatus } from '../api/types';
import { STATUS_META } from '../lib/format';

export function StatusBadge({ status, showDot = true }: { status: JudgeStatus; showDot?: boolean }) {
  const meta = STATUS_META[status] ?? STATUS_META.SE;
  return (
    <span className={`chip ${meta.className}`}>
      {showDot && <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
      {meta.label}
    </span>
  );
}
