import { config } from '../config';
import { initDb } from '../db';
import { installWorkerSignals, startWorker } from './worker';

/**
 * 独立判题进程的 CLI 入口：npm run judge（开发）/ node dist/judge/worker.js（生产）。
 * 与 API 进程共用同一个 SQLite 队列表，零配置、无外部依赖。
 */
initDb();
console.log(
  `[judge] 独立 worker 启动：concurrency=${config.judgeWorkers}, workdir=${config.judgeWorkDir}, db=${config.dbPath}`
);
const handle = startWorker({ concurrency: config.judgeWorkers, label: 'worker' });
installWorkerSignals(handle);
