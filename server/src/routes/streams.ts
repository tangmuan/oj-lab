import { Router } from 'express';
import { judgeEvents } from '../judge';
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
  const push = () =>
    sse.send({
      type: 'progress',
      batchId: batch.id,
      done: batch.done,
      total: batch.total,
      finished: batch.finished,
    });
  push();

  if (batch.finished) {
    sse.finish();
    return;
  }

  const listener = (payload: unknown) => {
    sse.send(payload);
    if ((payload as { finished?: boolean }).finished) sse.finish();
  };
  judgeEvents.on(`batch:${batchId}`, listener);
  sse.onClose(() => judgeEvents.off(`batch:${batchId}`, listener));
});
