import { config } from '../config';
import { db, initDb } from '../db';
import { judgeOne } from './index';
import { claimNext, recoverQueue, resetJudgingToPending } from './queue';

export interface WorkerHandle {
  /** 优雅停止：不再认领新任务，等当前在判的提交跑完（不设超时，判题最长时限由题目决定） */
  stop: () => Promise<void>;
}

/**
 * 判题 worker：轮询 judge_queue 表认领任务并消费。
 * 既作为独立进程入口（npm run judge），也支持在 API 进程内联启动（零配置模式）。
 */
export function startWorker(opts: { concurrency: number; label: string }): WorkerHandle {
  const workerId = `${opts.label}-${process.pid}`;
  // 恢复放这里而不是 API 启动：分离模式下 API 重启不能把活着的 worker 正在判的提交打回 PENDING
  const requeued = recoverQueue();
  if (requeued > 0) console.log(`[judge:${workerId}] 恢复了 ${requeued} 条待判任务`);

  let stopped = false;
  let running = 0;
  const inflight = new Set<Promise<void>>();

  // 120ms 轮询一次：单次是带索引的本地查询，成本可忽略；判题本身是秒级操作，实时性足够
  const poll = (): void => {
    if (stopped) return;
    while (running < opts.concurrency) {
      const id = claimNext(workerId);
      if (id === null) break;
      running += 1;
      // judgeOne 开头（第一个 await 之前）同步把状态置为 JUDGING，
      // 因此 claim 与置位之间不存在被 API 再次入队的窗口
      const p = judgeOne(id, workerId)
        .catch((err) => {
          console.error(`[judge:${workerId}] submission ${id} crashed`, err);
          resetJudgingToPending();
        })
        .finally(() => {
          running -= 1;
          inflight.delete(p);
        });
      inflight.add(p);
    }
  };

  const timer = setInterval(poll, 120);
  // 先立刻跑一轮，别让第一条提交白等 120ms
  poll();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      // 等当前提交判完：判完会自己写终态并释放认领，不残留 JUDGING
      while (inflight.size > 0) {
        await Promise.allSettled([...inflight]);
      }
      // 兜底：理论上走不到（inflight 清空后不会有 JUDGING），防御未来并发改动漏清
      resetJudgingToPending();
      db.prepare('UPDATE judge_queue SET claimed_by = NULL WHERE claimed_by IS NOT NULL').run();
    },
  };
}

/** 独立进程的退出处理：等当前判完，二次信号强制走人 */
export function installWorkerSignals(handle: WorkerHandle): void {
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) {
      // 二次 Ctrl+C：不等判题了，直接走人（JUDGING 会被下次启动的 worker 恢复）
      console.log('[judge] 强制退出，未完成提交将在下次启动时恢复');
      process.exit(0);
    }
    stopping = true;
    console.log('[judge] 收到退出信号，等当前提交判完…（再按一次 Ctrl+C 强制退出）');
    void handle.stop().then(() => {
      console.log('[judge] 已停止');
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

