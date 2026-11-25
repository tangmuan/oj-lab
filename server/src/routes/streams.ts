import { Router } from 'express';
import { getBatch } from '../judge/batch';
import { loadUserById } from '../middleware/auth';
import { forbidden, notFound, unauthorized } from '../utils/errors';
import { openSse } from '../utils/sse';
import { consumeStreamTicket } from '../utils/streamTickets';

/**
 * 管理端 SSE 走独立挂载点：adminRouter 上挂着 requireAuth，
 * 而 EventSource 带不了 Authorization 头，只能用一次性 ticket 换连接。
 */
export const streamsRouter = Router();

streamsRouter.get('/batch/:batchId', (req, res) => {
  const batchId = req.params.batchId;
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
  const record = ticket ? consumeStreamTicket(ticket) : null;
  if (!record || record.scope !== `batch:${batchId}`) throw unauthorized('连接凭证已失效，请重新发起');

  // 票据里只有 userId，角色必须回查：管理员被降权后旧票也不能继续看进度
  const user = loadUserById(record.userId);
  if (!user || user.role !== 'admin') throw forbidden('需要管理员权限');

  const batch = getBatch(batchId);
  if (!batch) throw notFound('批次不存在或已过期');

  const sse = openSse(res);
  const push = (b: NonNullable<ReturnType<typeof getBatch>>) =>
    sse.send({ type: 'progress', batchId: b.id, done: b.done, total: b.total, finished: b.finished });
  push(batch);

  if (batch.finished) {
    sse.finish();
    return;
  }

  // 批次进度存在 SQLite（worker 判完一条删一条 item），跨进程可见：
  // 这里轮询表推导 done，进度变化才下发，payload 与旧事件实现一致
  const timer = setInterval(() => {
    const latest = getBatch(batchId);
    if (!latest) {
      // 批次过期被清理（TTL 2 小时）：断流让前端走轮询兜底
      clearInterval(timer);
      sse.finish();
      return;
    }
    push(latest);
    if (latest.finished) {
      clearInterval(timer);
      sse.finish();
    }
  }, 500);

  sse.onClose(() => clearInterval(timer));
});
