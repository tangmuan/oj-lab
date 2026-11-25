import os from 'os';
import fs from 'fs';
import path from 'path';
import { createApp } from './app';
import { config } from './config';
import { initDb } from './db';
import { startWorker, WorkerHandle } from './judge/worker';

initDb();
const app = createApp();

// 判题 worker：默认内联在 API 进程里（零配置可用）；
// 设 JUDGE_INLINE=0 后由 npm run judge 独立消费，API 只负责入队。
// 恢复逻辑在 worker 启动里做，API 启动不碰 JUDGING，避免打断分离 worker 正在判的提交。
let worker: WorkerHandle | null = null;
if (config.judgeInline) {
  worker = startWorker({ concurrency: config.judgeWorkers, label: 'inline' });
}
const judgeMode = config.judgeInline
  ? `内联 worker（并发 ${config.judgeWorkers}）；分离部署请设 JUDGE_INLINE=0 并运行 npm run judge`
  : '分离模式（本进程不判题，请运行 npm run judge 启动 worker，JUDGE_WORKERS 控制并发）';

function lanAddresses(): string[] {
  const out: string[] = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

const server = app.listen(config.port, config.host, () => {
  const hasWeb = fs.existsSync(path.join(config.webDist, 'index.html'));
  console.log(`[oj-server] listening on ${config.host}:${config.port}`);
  console.log(`[oj-server] 本机访问: http://localhost:${config.port}`);
  if (config.host === '0.0.0.0') {
    for (const ip of lanAddresses()) {
      console.log(`[oj-server] 局域网访问: http://${ip}:${config.port}`);
    }
  }
  console.log(`[oj-server] 前端静态资源: ${hasWeb ? `已托管 ${config.webDist}` : '未找到 web/dist（开发模式请用 vite dev server）'}`);
  console.log(`[oj-server] db: ${config.dbPath}`);
  console.log(`[oj-server] 判题模式: ${judgeMode}`);
});

const shutdown = () => {
  console.log('[oj-server] shutting down');
  // 先停 worker（等当前提交判完，不留 JUDGING），再关 HTTP
  const stopped = worker ? worker.stop() : Promise.resolve();
  stopped.then(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
