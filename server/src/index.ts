import os from 'os';
import fs from 'fs';
import path from 'path';
import { createApp } from './app';
import { config } from './config';
import { initDb } from './db';
import { recoverPending } from './judge';

initDb();
const app = createApp();

const requeued = recoverPending();
if (requeued > 0) console.log(`[oj-server] requeued ${requeued} interrupted submission(s)`);

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
  console.log(`[oj-server] judge: concurrency=${config.judgeConcurrency}, workdir=${config.judgeWorkDir}`);
});

const shutdown = () => {
  console.log('[oj-server] shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
