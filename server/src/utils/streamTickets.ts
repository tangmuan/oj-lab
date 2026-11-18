import crypto from 'crypto';

/** ticket 只活 60 秒，够前端拿到后立刻建连，又不会变成可长期复用的凭证 */
const TICKET_TTL_MS = 60_000;

interface TicketRecord {
  userId: number;
  /** 访问范围，例如 `sub:12`（某次提交的判题流）或 `batch:xxx`（批量重判进度） */
  scope: string;
  expiresAt: number;
}

const tickets = new Map<string, TicketRecord>();

/** 票据是一次性的，没人领的过期票只能在签发时顺带扫掉，避免长期运行后 Map 无限增长 */
function sweep(now: number): void {
  for (const [key, record] of tickets) {
    if (record.expiresAt <= now) tickets.delete(key);
  }
}

export function issueStreamTicket(userId: number, scope: string): string {
  const now = Date.now();
  sweep(now);
  const ticket = crypto.randomUUID();
  tickets.set(ticket, { userId, scope, expiresAt: now + TICKET_TTL_MS });
  return ticket;
}

/** 消费即作废：无论后续校验是否通过，同一张票都不能用第二次 */
export function consumeStreamTicket(ticket: string): { userId: number; scope: string } | null {
  const record = tickets.get(ticket);
  if (!record) return null;
  tickets.delete(ticket);
  if (record.expiresAt <= Date.now()) return null;
  return { userId: record.userId, scope: record.scope };
}
