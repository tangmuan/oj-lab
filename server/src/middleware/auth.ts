import { NextFunction, Request, Response } from 'express';
import { db } from '../db';
import { UserRow } from '../types';
import { forbidden, unauthorized } from '../utils/errors';
import { verifyToken } from '../utils/jwt';

/** 从 Authorization 头或 ?token= 取 token（SSE/EventSource 无法自定义头） */
function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const q = req.query.token;
  if (typeof q === 'string' && q) return q;
  return null;
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const user = verifyToken(token);
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) return next(unauthorized());
  const payload = verifyToken(token);
  if (!payload) return next(unauthorized());

  // 角色以数据库为准，防止旧 token 越权
  const row = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(payload.id) as
    | Pick<UserRow, 'id' | 'username' | 'role'>
    | undefined;
  if (!row) return next(unauthorized('用户不存在'));
  req.user = { id: row.id, username: row.username, role: row.role };
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('需要管理员权限'));
  next();
}
