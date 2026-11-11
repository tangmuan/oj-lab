import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { LanguageId } from '../types';
import { LANGUAGES, LanguageSpec } from './languages';
import { runProcess, RunResult } from './runner';

const COMPILE_TIMEOUT_MS = 20000;
const COMPILE_MEMORY_MB = 2048;
const WARMUP_TIMEOUT_MS = 2500;

export interface BuiltProgram {
  ok: boolean;
  dir: string;
  language: LanguageSpec;
  sourceFile: string;
  compileMsg: string | null;
}

/**
 * 在临时目录落盘源码并编译（解释型语言做语法检查）。
 * 编译成功后可选做一次预热执行，规避 Windows 对新 exe 的首次扫描。
 */
export async function buildProgram(params: {
  code: string;
  language: LanguageId;
  memoryLimitMb: number;
  prefix: string;
  warmup?: boolean;
}): Promise<BuiltProgram> {
  const lang = LANGUAGES[params.language];
  const dir = path.join(
    config.judgeWorkDir,
    `${params.prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  fs.mkdirSync(dir, { recursive: true });

  const sourceFile = lang.sourceFile(params.code);
  fs.writeFileSync(path.join(dir, sourceFile), params.code, 'utf8');

  const compileSpec = lang.compile?.(dir, sourceFile, params.memoryLimitMb);
  if (compileSpec) {
    try {
      const cr = await runProcess(compileSpec.cmd, compileSpec.args, {
        cwd: dir,
        timeLimitMs: COMPILE_TIMEOUT_MS,
        memoryLimitMb: COMPILE_MEMORY_MB,
        outputLimitBytes: 256 * 1024,
      });
      if (cr.status !== 'OK') {
        return {
          ok: false,
          dir,
          language: lang,
          sourceFile,
          compileMsg: truncateCompileMessage(`${cr.stdout}\n${cr.stderr}`),
        };
      }
    } catch (err) {
      // 编译器缺失（ENOENT）等环境问题
      return {
        ok: false,
        dir,
        language: lang,
        sourceFile,
        compileMsg: `编译器不可用：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (params.warmup !== false && lang.warmup !== false) {
    const spec = lang.run(dir, sourceFile, params.memoryLimitMb);
    await runProcess(spec.cmd, spec.args, {
      cwd: dir,
      timeLimitMs: WARMUP_TIMEOUT_MS,
      memoryLimitMb: params.memoryLimitMb,
      outputLimitBytes: 64 * 1024,
      stdin: '',
    }).catch(() => undefined);
  }

  return { ok: true, dir, language: lang, sourceFile, compileMsg: null };
}

/** 用给定的标准输入跑一次程序 */
export function runOnce(
  dir: string,
  language: LanguageId,
  sourceFile: string,
  opts: { input: string; timeLimitMs: number; memoryLimitMb: number; outputLimitBytes?: number }
): Promise<RunResult> {
  const spec = LANGUAGES[language].run(dir, sourceFile, opts.memoryLimitMb);
  return runProcess(spec.cmd, spec.args, {
    cwd: dir,
    timeLimitMs: opts.timeLimitMs,
    memoryLimitMb: opts.memoryLimitMb,
    stdin: opts.input,
    outputLimitBytes: opts.outputLimitBytes,
  });
}

export function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响判题结果 */
  }
}

function truncateCompileMessage(raw: string): string {
  const text = raw.trim();
  if (!text) return '编译失败';
  return text.length > 4000 ? `${text.slice(0, 4000)}…（输出已截断）` : text;
}
