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
  judgeConcurrency: Number(process.env.JUDGE_CONCURRENCY || 2),
  submitCooldownSec: Number(process.env.SUBMIT_COOLDOWN_SEC || 5),
  runCooldownMs: Number(process.env.RUN_COOLDOWN_MS || 2000),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  /** 前端构建产物目录：存在则由后端一并托管，实现单端口部署 */
  webDist: process.env.WEB_DIST || path.resolve(root, '..', 'web', 'dist'),
  isProd: process.env.NODE_ENV === 'production',
};
