import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { UserRow } from '../types';
import { ah, AppError, badRequest } from '../utils/errors';
import { signToken } from '../utils/jwt';
import { consumeRateLimit } from '../utils/requestLimits';

export const authRouter = Router();

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, '用户名至少 3 个字符')
    .max(20, '用户名最多 20 个字符')
    .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, '只能包含字母、数字、下划线或中文'),
  password: z.string().min(6, '密码至少 6 位').max(64, '密码最多 64 位'),
});

const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});

authRouter.post(
  '/register',
  ah(async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const limit = consumeRateLimit(`register:${ip}`, 60 * 60_000, 10);
    if (!limit.allowed) throw new AppError(`注册请求过多，请 ${limit.retryAfterSec} 秒后再试`, 429, 'TOO_MANY_REQUESTS');
    const { username, password } = registerSchema.parse(req.body);
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) throw new AppError('该用户名已被注册', 409, 'USERNAME_TAKEN');

    // 首个注册用户自动成为管理员，方便本地开箱使用
    const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
    const role = count === 0 && config.deploymentMode === 'development' ? 'admin' : 'user';
    const hash = await bcrypt.hash(password, 10);

    const info = db
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username, hash, role);

    const user = { id: Number(info.lastInsertRowid), username, role: role as 'user' | 'admin' };
    res.status(201).json({ token: signToken(user), user });
  })
);

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const identity = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase().slice(0, 80) : '';
    const ipLimit = consumeRateLimit(`login-ip:${ip}`, 10 * 60_000, 30);
    if (!ipLimit.allowed) throw new AppError(`登录尝试过多，请 ${ipLimit.retryAfterSec} 秒后再试`, 429, 'TOO_MANY_REQUESTS');
    const userLimit = consumeRateLimit(`login-user:${ip}:${identity}`, 10 * 60_000, 8);
    if (!userLimit.allowed) throw new AppError(`登录尝试过多，请 ${userLimit.retryAfterSec} 秒后再试`, 429, 'TOO_MANY_REQUESTS');
    const { username, password } = loginSchema.parse(req.body);
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    // 统一错误文案，避免暴露用户名是否存在
    if (!row) throw badRequest('用户名或密码错误');
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) throw badRequest('用户名或密码错误');

    const user = { id: row.id, username: row.username, role: row.role };
    res.json({ token: signToken(user), user });
  })
);

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
