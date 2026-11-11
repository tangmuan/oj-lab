import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { truncate } from '../judge/comparator';
import { buildProgram, removeDir, runOnce } from '../judge/exec';
import { isLanguageId } from '../judge/languages';
import { requireAuth } from '../middleware/auth';
import { ProblemRow } from '../types';
import { ah, AppError, notFound } from '../utils/errors';

export const runRouter = Router();

const runSchema = z.object({
  // 草稿箱里的文件不属于任何题目，可以不传 problemId，此时使用默认限制
  problemId: z.coerce.number().int().positive('题目 ID 不合法').optional(),
  language: z.string().refine(isLanguageId, '不支持的语言'),
  code: z.string().min(1, '代码不能为空').max(65536, '代码不能超过 64KB'),
  input: z.string().max(65536, '自测输入不能超过 64KB').default(''),
});

/** 无题目上下文的运行限制 */
const DEFAULT_LIMITS = { timeLimitMs: 2000, memoryLimitMb: 256 };

/** 响应里回传的输出上限，避免一次自测把页面拖垮 */
const RESPONSE_STDOUT_LIMIT = 64 * 1024;

/** 自测运行的内存频控（不落库，进程重启即清空） */
const lastRunAt = new Map<number, number>();

runRouter.post(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const { problemId, language, code, input } = runSchema.parse(req.body);
    const user = req.user!;

    let limits = DEFAULT_LIMITS;
    if (problemId !== undefined) {
      const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId) as ProblemRow | undefined;
      if (!problem) throw notFound('题目不存在');
      if (problem.is_public !== 1 && user.role !== 'admin') throw notFound('题目不存在');
      limits = { timeLimitMs: problem.time_limit_ms, memoryLimitMb: problem.memory_limit_mb };
    }

    const now = Date.now();
    const prev = lastRunAt.get(user.id) ?? 0;
    if (now - prev < config.runCooldownMs) {
      const wait = Math.ceil((config.runCooldownMs - (now - prev)) / 1000);
      throw new AppError(`运行过快，请 ${wait} 秒后再试`, 429, 'TOO_MANY_REQUESTS');
    }
    lastRunAt.set(user.id, now);

    const built = await buildProgram({
      code,
      language,
      memoryLimitMb: limits.memoryLimitMb,
      prefix: `run-${user.id}`,
      warmup: true,
    });

    try {
      if (!built.ok) {
        res.json({
          status: 'CE',
          compileMsg: built.compileMsg,
          stdout: '',
          stderr: '',
          timeMs: 0,
          memoryKb: 0,
          exitCode: null,
          truncated: false,
        });
        return;
      }

      const result = await runOnce(built.dir, language, built.sourceFile, {
        input,
        timeLimitMs: limits.timeLimitMs,
        memoryLimitMb: limits.memoryLimitMb,
        outputLimitBytes: 1024 * 1024,
      });

      const stdoutFull = result.stdout;
      const truncated = stdoutFull.length > RESPONSE_STDOUT_LIMIT;
      const slice = truncated ? stdoutFull.slice(0, RESPONSE_STDOUT_LIMIT) : stdoutFull;

      res.json({
        status: result.status,
        compileMsg: null,
        // 统一成 \n，避免 Windows 程序的 \r\n 在页面上多出空行
        stdout: slice.replace(/\r\n?/g, '\n'),
        stderr: truncate(result.stderr, 4000).replace(/\r\n?/g, '\n'),
        timeMs: result.timeMs,
        memoryKb: result.memoryKb,
        exitCode: result.exitCode,
        truncated,
      });
    } finally {
      removeDir(built.dir);
    }
  })
);
