import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../config';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.judgeWorkDir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb(): void {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

/** 事务包装，判题写库时保证原子性 */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}
