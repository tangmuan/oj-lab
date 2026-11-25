import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const root = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT || 3001),
  /** 0.0.0.0 = 允许局域网/公网访问；只想本机访问可设为 127.0.0.1 */
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'oj.db'),
  judgeWorkDir: process.env.JUDGE_WORK_DIR || path.join(root, 'data', 'judge'),
  /** 判题执行器：local = 宿主子进程（默认，无隔离）；docker = 每次判题跑独立容器（有隔离，见 DEPLOY.md） */
  judgeExecutor: process.env.JUDGE_EXECUTOR === 'docker' ? 'docker' : 'local',
  /** Docker 执行器使用的镜像，需内置 5 种语言的工具链（构建方式见 DEPLOY.md） */
  judgeDockerImage: process.env.JUDGE_DOCKER_IMAGE || 'oj-judge:latest',
  /** 判题 worker 并发数；兼容旧的 JUDGE_CONCURRENCY 名字 */
  judgeWorkers: Number(process.env.JUDGE_WORKERS || process.env.JUDGE_CONCURRENCY || 2),
  /** 1（默认）= API 进程内联跑一个 worker，零配置可用；0 = 分离模式，由 npm run judge 独立消费 */
  judgeInline: process.env.JUDGE_INLINE !== '0',
  submitCooldownSec: Number(process.env.SUBMIT_COOLDOWN_SEC || 5),
  runCooldownMs: Number(process.env.RUN_COOLDOWN_MS || 2000),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  /** 前端构建产物目录：存在则由后端一并托管，实现单端口部署 */
  webDist: process.env.WEB_DIST || path.resolve(root, '..', 'web', 'dist'),
  isProd: process.env.NODE_ENV === 'production',
};
