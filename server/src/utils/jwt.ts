import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser } from '../types';

export function signToken(user: AuthUser): string {
  return jwt.sign({ uid: user.id, username: user.username, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { uid: number; username: string; role: 'user' | 'admin' };
    return { id: payload.uid, username: payload.username, role: payload.role };
  } catch {
    return null;
  }
}
