import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { truncate } from '../judge/comparator';
import { getExecutor } from '../judge/executor-factory';
import { isLanguageId } from '../judge/languages';
import { requireAuth } from '../middleware/auth';
import { ProblemRow } from '../types';
import { ah, AppError, notFound } from '../utils/errors';
import { canSubmitToProblem } from '../utils/contest';
import { acquireExecutionLease, consumeRateLimit, releaseExecutionLease, renewExecutionLease } from '../utils/requestLimits';

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
      if (!canSubmitToProblem(problemId, user.role)) throw notFound('题目不存在');
      limits = { timeLimitMs: problem.time_limit_ms, memoryLimitMb: problem.memory_limit_mb };
    }

    const cooldown = consumeRateLimit(`run-user:${user.id}`, config.runCooldownMs, 1);
    if (!cooldown.allowed) throw new AppError(`运行过快，请 ${cooldown.retryAfterSec} 秒后再试`, 429, 'TOO_MANY_REQUESTS');
    const lease = acquireExecutionLease(user.id, config.judgeWorkers);
    if (!lease) throw new AppError('当前自测任务较多，请稍后重试', 429, 'TOO_MANY_REQUESTS');
    const leaseHeartbeat = setInterval(() => renewExecutionLease(lease), 30_000);

    // 自测运行与提交判题走同一个执行器，保证「自测通过、提交也通过」的行为一致
    const exec = getExecutor();
    let built: Awaited<ReturnType<typeof exec.build>> | null = null;
    try {
      built = await exec.build({
        code,
        language,
        memoryLimitMb: limits.memoryLimitMb,
        prefix: `run-${user.id}`,
        warmup: true,
      });
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

      const result = await exec.run(built.dir, language, built.sourceFile, {
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
      if (built) exec.cleanup(built.dir);
      clearInterval(leaseHeartbeat);
      releaseExecutionLease(lease);
    }
  })
);
