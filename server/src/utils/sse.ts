import { Response } from 'express';

export interface SseChannel {
  send: (payload: unknown) => void;
  finish: () => void;
  /** 连接关闭（含正常结束）时回调，调用方在这里解绑监听，回调必须幂等 */
  onClose: (fn: () => void) => void;
}

const HEARTBEAT_MS = 15_000;

/**
 * 统一的 SSE 外壳：写头、心跳、done 后主动断流都在这里，
 * 避免每个流各写一遍（阶段 1 的提交流就是手写的，容易漏清理）。
 */
export function openSse(res: Response): SseChannel {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  let heartbeat: NodeJS.Timeout | null = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  const teardown = (): void => {
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  res.on('close', teardown);

  return {
    send: (payload) => {
      if (closed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    },
    finish: () => {
      if (closed) return;
      teardown();
      if (!res.writableEnded) res.end();
    },
    onClose: (fn) => {
      res.on('close', fn);
    },
  };
}
