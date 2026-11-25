import { config } from '../config';
import { db, tx } from '../db';
import { SubmissionRow } from '../types';

/**
 * 跨进程判题队列：API 进程只负责往 judge_queue 表写行，
 * worker 进程轮询认领消费。SQLite 单语句写事务自带原子性，
 * 两个进程并发认领不会拿到同一条任务（busy_timeout 排队等锁）。
 */

/** 入队（幂等）：正在判题的提交跳过——本轮结果就是重判想要的新结果。 */
export function enqueueSubmission(id: number): boolean {
  const row = db.prepare('SELECT status FROM submissions WHERE id = ?').get(id) as
    | Pick<SubmissionRow, 'status'>
    | undefined;
  if (!row) return false;
  if (row.status === 'JUDGING') return false;
  db.prepare('INSERT OR IGNORE INTO judge_queue (submission_id) VALUES (?)').run(id);
  return true;
}

/**
 * 原子认领一条任务：UPDATE + RETURNING 在同一个写事务里，
 * 两个 worker 同时执行时 SQLite 锁保证只有一个能拿到。
 * 行不删除而是标记 claimed_by——判题中 API 再次入队（INSERT OR IGNORE）是 no-op，
 * 不会造成重复消费；判完由 worker 按自己的实例 id 删行。
 */
export function claimNext(workerId: string): number | null {
  const row = db
    .prepare(
      `UPDATE judge_queue
       SET claimed_by = ?, claimed_at = datetime('now')
       WHERE submission_id = (
         SELECT submission_id FROM judge_queue WHERE claimed_by IS NULL ORDER BY submission_id ASC LIMIT 1
       )
       RETURNING submission_id`
    )
    .get(workerId) as { submission_id: number } | undefined;
  return row ? row.submission_id : null;
}

/** 判完删行：只删自己认领的，API 在判题期间重新入队的新行不受影响 */
export function releaseClaim(submissionId: number, workerId: string): void {
  db.prepare('DELETE FROM judge_queue WHERE submission_id = ? AND claimed_by = ?').run(submissionId, workerId);
}

/**
 * worker 启动时的恢复：上一次的认领全部作废、残留 JUDGING 回 PENDING、
 * 把所有 PENDING 补进队列（覆盖老库迁移与异常丢行两种情况）。
 * 只允许 worker 进程调用——API 重启不能打断分离模式下正在判题的 worker。
 */
export function recoverQueue(): number {
  db.prepare('UPDATE judge_queue SET claimed_by = NULL, claimed_at = NULL WHERE claimed_by IS NOT NULL').run();
  db.prepare("UPDATE submissions SET status = 'PENDING' WHERE status = 'JUDGING'").run();
  const info = db
    .prepare("INSERT OR IGNORE INTO judge_queue (submission_id) SELECT id FROM submissions WHERE status = 'PENDING'")
    .run();
  return info.changes;
}

/** health 接口的队列视角：waiting = 待认领行数，running = 全库 JUDGING 数（含其他 worker 实例） */
export function queueStats(): { waiting: number; running: number; concurrency: number; mode: string } {
  const waiting = (db.prepare('SELECT COUNT(*) AS c FROM judge_queue WHERE claimed_by IS NULL').get() as { c: number }).c;
  const running = (db.prepare("SELECT COUNT(*) AS c FROM submissions WHERE status = 'JUDGING'").get() as { c: number }).c;
  return { waiting, running, concurrency: config.judgeWorkers, mode: config.judgeInline ? 'inline' : 'external' };
}

/** 批量重判结算：该提交出现在任何未过期批次的 item 里都算完成，批次进度由剩余数推导 */
export function settleBatchItems(submissionId: number): void {
  db.prepare('DELETE FROM rejudge_batch_items WHERE submission_id = ?').run(submissionId);
}

/** 兜底：优雅退出或崩溃恢复时保证不留永久 JUDGING */
export function resetJudgingToPending(): void {
  db.prepare("UPDATE submissions SET status = 'PENDING' WHERE status = 'JUDGING'").run();
}

/** 供 batch.ts 复用的事务包装（避免 judge 层到处直接摸 db.transaction） */
export function inTransaction<T>(fn: () => T): T {
  return tx(fn);
}
