import { createHash, randomUUID } from 'crypto';
import { db, tx } from '../db';

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Sliding-window limiter shared by all API processes through SQLite. */
export function consumeRateLimit(key: string, windowMs: number, maximum: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const keyHash = hashKey(key);
  return tx(() => {
    db.prepare('DELETE FROM rate_limit_events WHERE created_at_ms <= ?').run(cutoff);
    const count = (db.prepare('SELECT COUNT(*) AS c FROM rate_limit_events WHERE key_hash = ? AND created_at_ms > ?')
      .get(keyHash, cutoff) as { c: number }).c;
    if (count >= maximum) {
      const oldest = (db.prepare('SELECT MIN(created_at_ms) AS t FROM rate_limit_events WHERE key_hash = ? AND created_at_ms > ?')
        .get(keyHash, cutoff) as { t: number | null }).t;
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(((oldest ?? now) + windowMs - now) / 1000)) };
    }
    db.prepare('INSERT INTO rate_limit_events (key_hash, created_at_ms) VALUES (?, ?)').run(keyHash, now);
    return { allowed: true, retryAfterSec: 0 };
  });
}

export function acquireExecutionLease(userId: number, maximum: number, leaseMs = 120_000): string | null {
  const now = Date.now();
  const id = randomUUID();
  return tx(() => {
    db.prepare('DELETE FROM execution_leases WHERE expires_at_ms <= ?').run(now);
    const active = (db.prepare('SELECT COUNT(*) AS c FROM execution_leases').get() as { c: number }).c;
    if (active >= maximum) return null;
    db.prepare('INSERT INTO execution_leases (id, user_id, expires_at_ms) VALUES (?, ?, ?)').run(id, userId, now + leaseMs);
    return id;
  });
}

export function renewExecutionLease(id: string, leaseMs = 120_000): void {
  db.prepare('UPDATE execution_leases SET expires_at_ms = ? WHERE id = ?').run(Date.now() + leaseMs, id);
}

export function releaseExecutionLease(id: string): void {
  db.prepare('DELETE FROM execution_leases WHERE id = ?').run(id);
}
