import crypto from 'crypto';
import { db } from '../db';
import { enqueueSubmission, inTransaction } from './queue';

export interface BatchRecord {
  id: string;
  total: number;
  done: number;
  finished: boolean;
  createdAt: number;
}

/** 一次最多重判 500 条：再多就不是「补判」而是压测，应该走独立任务系统 */
export const MAX_BATCH_SIZE = 500;
const BATCH_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * 批次持久化到 rejudge_batches / rejudge_batch_items 两张表：
 * 进度不靠增量计数，而是 total - 剩余 item 数推导——worker 判完一条提交就删它的 item 行，
 * 任何进程重启都不会丢进度，也不需要跨进程事件通知。
 */

/** 过期批次整批清掉（级联删 items），顺便把已完结的批次也一起回收 */
function sweep(): void {
  db.prepare('DELETE FROM rejudge_batches WHERE created_at < ?').run(Date.now() - BATCH_TTL_MS);
}

export function createRejudgeBatch(ids: number[]): BatchRecord {
  sweep();
  const id = crypto.randomUUID().slice(0, 8);

  inTransaction(() => {
    db.prepare('INSERT INTO rejudge_batches (id, total, created_at) VALUES (?,?,?)').run(id, ids.length, Date.now());
    const insertItem = db.prepare('INSERT OR IGNORE INTO rejudge_batch_items (batch_id, submission_id) VALUES (?,?)');
    for (const sid of ids) insertItem.run(id, sid);
    // 入队放事务外也一样原子，但放进来保证「批次可见时任务一定已在队列里」
    for (const sid of ids) enqueueSubmission(sid);
  });

  return { id, total: ids.length, done: 0, finished: ids.length === 0, createdAt: Date.now() };
}

/** 进度 = total - 剩余 item 数；批次不存在（过期或重启前从未存在）返回 undefined */
export function getBatch(id: string): BatchRecord | undefined {
  sweep();
  const row = db
    .prepare(
      `SELECT b.id, b.total, b.created_at,
              (SELECT COUNT(*) FROM rejudge_batch_items i WHERE i.batch_id = b.id) AS remaining
       FROM rejudge_batches b WHERE b.id = ?`
    )
    .get(id) as { id: string; total: number; created_at: number; remaining: number } | undefined;
  if (!row) return undefined;
  const done = row.total - row.remaining;
  return { id: row.id, total: row.total, done, finished: done >= row.total, createdAt: row.created_at };
}
