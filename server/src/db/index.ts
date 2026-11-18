import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../config';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.judgeWorkDir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
}

/** 事务包装，判题写库时保证原子性 */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}
