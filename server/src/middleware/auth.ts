import { NextFunction, Request, Response } from 'express';
import { db } from '../db';
import { AuthUser, UserRow } from '../types';
import { forbidden, unauthorized } from '../utils/errors';
import { verifyToken } from '../utils/jwt';
import { consumeStreamTicket } from '../utils/streamTickets';

/** 只从 Authorization 头取 token：SSE 改用一次性 ticket，不再接受 URL 上的长期凭证 */
function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** 按 id 取库里的最新身份，token 只用来确认「是谁」，角色一律以数据库为准 */
export function loadUserById(id: number): AuthUser | null {
  const row = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id) as
    | Pick<UserRow, 'id' | 'username' | 'role'>
    | undefined;
  return row ? { id: row.id, username: row.username, role: row.role } : null;
}

/** 解析 token 并回查数据库；无 token 或 token 失效返回 null */
export function resolveUser(req: Request): AuthUser | null {
  const token = extractToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return loadUserById(payload.id);
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  // 未登录请求不查库，避免匿名流量被一次多余查询拖慢
  const user = resolveUser(req);
  if (user) req.user = user;
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) return next(unauthorized());
  const payload = verifyToken(token);
  if (!payload) return next(unauthorized());

  const user = loadUserById(payload.id);
  if (!user) return next(unauthorized('用户不存在'));
  req.user = user;
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('需要管理员权限'));
  next();
}

/**
 * SSE 握手鉴权：EventSource 无法自定义请求头，所以前端先用正常请求换一张
 * 60 秒一次性 ticket，再把 ticket 放 query。Authorization 头仍然可用，兼容直连调试。
 */
export function authenticateStream(req: Request, submissionId: number): AuthUser | null {
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
  if (ticket) {
    const record = consumeStreamTicket(ticket);
    // 票据绑定提交 id，防止拿自己提交的票去看别人的判题过程
    if (!record || record.submissionId !== submissionId) return null;
    return loadUserById(record.userId);
  }
  return resolveUser(req);
}
