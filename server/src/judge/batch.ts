import crypto from 'crypto';
import { enqueueSubmission, judgeEvents } from './index';

export interface BatchRecord {
  id: string;
  total: number;
  done: number;
  finished: boolean;
  createdAt: number;
  remaining: Set<number>;
}

/** 一次最多重判 500 条：再多就不是「补判」而是压测，应该走独立任务系统 */
export const MAX_BATCH_SIZE = 500;
const BATCH_TTL_MS = 2 * 60 * 60 * 1000;

const batches = new Map<string, BatchRecord>();

function sweep(now: number): void {
  for (const [id, batch] of batches) {
    if (now - batch.createdAt > BATCH_TTL_MS) batches.delete(id);
  }
}

export function createRejudgeBatch(ids: number[]): BatchRecord {
  const now = Date.now();
  sweep(now);

  const record: BatchRecord = {
    id: crypto.randomUUID().slice(0, 8),
    total: ids.length,
    done: 0,
    finished: ids.length === 0,
    createdAt: now,
    remaining: new Set(ids),
  };
  // 先登记再入队：worker 可能立刻开始处理并回调 any-done
  batches.set(record.id, record);
  for (const id of ids) enqueueSubmission(id);
  return record;
}

export function getBatch(id: string): BatchRecord | undefined {
  return batches.get(id);
}

judgeEvents.on('any-done', (payload: { submissionId?: number }) => {
  if (typeof payload.submissionId !== 'number') return;
  for (const batch of batches.values()) {
    if (!batch.remaining.delete(payload.submissionId)) continue;
    batch.done += 1;
    if (batch.done >= batch.total) batch.finished = true;
    judgeEvents.emit(`batch:${batch.id}`, {
      type: 'progress',
      batchId: batch.id,
      done: batch.done,
      total: batch.total,
      finished: batch.finished,
    });
  }
});
