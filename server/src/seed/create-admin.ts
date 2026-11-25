import bcrypt from 'bcryptjs';
import { db, initDb } from '../db';

async function main(): Promise<void> {
  const username = process.env.OJ_ADMIN_USERNAME?.trim() ?? '';
  const password = process.env.OJ_ADMIN_PASSWORD ?? '';
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{3,20}$/.test(username)) {
    throw new Error('Set OJ_ADMIN_USERNAME to 3-20 letters, digits, underscores, or Chinese characters.');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('Set OJ_ADMIN_PASSWORD to a unique password of at least 12 characters.');
  }

  initDb();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new Error(`User ${username} already exists; choose a new username for initialization.`);
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hash);
  console.log(`[admin:create] Administrator ${username} created.`);
}

main().catch((error: unknown) => {
  console.error(`[admin:create] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
