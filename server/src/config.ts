import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const root = path.resolve(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';
const configuredMode = process.env.OJ_DEPLOYMENT_MODE;
const deploymentMode = configuredMode || (isProd ? 'unspecified' : 'development');
const configuredExecutor = process.env.JUDGE_EXECUTOR || 'local';
const jwtSecret = process.env.JWT_SECRET?.trim() || 'dev-only-secret-change-me';

if (!['development', 'internal', 'public', 'unspecified'].includes(deploymentMode)) {
  throw new Error('OJ_DEPLOYMENT_MODE must be development, internal, or public');
}
if (!['local', 'docker'].includes(configuredExecutor)) {
  throw new Error('JUDGE_EXECUTOR must be local or docker');
}
if (isProd) {
  if (deploymentMode === 'unspecified' || deploymentMode === 'development') {
    throw new Error('Production requires OJ_DEPLOYMENT_MODE=internal or public');
  }
  if (jwtSecret === 'dev-only-secret-change-me') {
    throw new Error('Production refuses the default JWT_SECRET; configure a random secret');
  }
}
if (deploymentMode === 'public' && configuredExecutor !== 'docker') {
  throw new Error('Public deployment requires JUDGE_EXECUTOR=docker');
}

const judgeWorkers = Number(process.env.JUDGE_WORKERS || process.env.JUDGE_CONCURRENCY || 2);
const maxQueueSize = Number(process.env.JUDGE_QUEUE_LIMIT || 2000);
if (!Number.isInteger(judgeWorkers) || judgeWorkers < 1 || judgeWorkers > 64) {
  throw new Error('JUDGE_WORKERS must be an integer between 1 and 64');
}
if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) {
  throw new Error('JUDGE_QUEUE_LIMIT must be a positive integer');
}

export const config = {
  port: Number(process.env.PORT || 3001),
  /** 0.0.0.0 = 允许局域网/公网访问；只想本机访问可设为 127.0.0.1 */
  host: process.env.HOST || '0.0.0.0',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'oj.db'),
  judgeWorkDir: process.env.JUDGE_WORK_DIR || path.join(root, 'data', 'judge'),
  /** 判题执行器：local = 宿主子进程（默认，无隔离）；docker = 每次判题跑独立容器（有隔离，见 DEPLOY.md） */
  judgeExecutor: configuredExecutor as 'local' | 'docker',
  /** Docker 执行器使用的镜像，需内置 5 种语言的工具链（构建方式见 DEPLOY.md） */
  judgeDockerImage: process.env.JUDGE_DOCKER_IMAGE || 'oj-judge:latest',
  /** 判题 worker 并发数；兼容旧的 JUDGE_CONCURRENCY 名字 */
  judgeWorkers,
  maxQueueSize,
  /** 1（默认）= API 进程内联跑一个 worker，零配置可用；0 = 分离模式，由 npm run judge 独立消费 */
  judgeInline: process.env.JUDGE_INLINE !== '0',
  submitCooldownSec: Number(process.env.SUBMIT_COOLDOWN_SEC || 5),
  runCooldownMs: Number(process.env.RUN_COOLDOWN_MS || 2000),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  /** 前端构建产物目录：存在则由后端一并托管，实现单端口部署 */
  webDist: process.env.WEB_DIST || path.resolve(root, '..', 'web', 'dist'),
  isProd: process.env.NODE_ENV === 'production',
  deploymentMode,
  trustProxy: process.env.TRUST_PROXY === '1',
};
