import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg: string) => new AppError(msg, 400, 'BAD_REQUEST');
export const unauthorized = (msg = '未登录或登录已过期') => new AppError(msg, 401, 'UNAUTHORIZED');
export const forbidden = (msg = '没有权限执行该操作') => new AppError(msg, 403, 'FORBIDDEN');
export const notFound = (msg = '资源不存在') => new AppError(msg, 404, 'NOT_FOUND');

/** 包裹 async 路由，异常交给全局错误中间件 */
export function ah<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  // express.json() 解析失败会抛 SyntaxError
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: '请求体不是合法的 JSON' } });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `${first?.path.join('.') || '参数'}：${first?.message || '格式不正确'}`,
      },
    });
    return;
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
}
