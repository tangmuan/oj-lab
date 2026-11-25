import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../config';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.judgeWorkDir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// API 与 judge worker 是两个进程并发写同一个库：写锁冲突时排队等 5 秒，
// 否则默认 0ms 直接抛 SQLITE_BUSY，判题中途报错比排队慢更伤
db.pragma('busy_timeout = 5000');

/**
 * 老库补列：CREATE TABLE IF NOT EXISTS 只对新建库生效，
 * 已存在的表必须显式 ALTER，否则升级后查新列直接报错。
 * 表名/列名/DDL 全部来自代码里的常量，不接受任何外部输入。
 */
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export function initDb(): void {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  ensureColumn('problems', 'checker_language', 'checker_language TEXT');
  ensureColumn('problems', 'checker_code', 'checker_code TEXT');
  // SSE 改为跨进程轮询 submission_cases 增量后，逐点差异必须在落库时就写进行里
  ensureColumn('submission_cases', 'first_diff', 'first_diff TEXT');
  ensureColumn('judge_queue', 'claim_token', 'claim_token TEXT');
}

/** 事务包装，判题写库时保证原子性 */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}
