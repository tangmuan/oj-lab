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

const CHECKER_STDERR_LIMIT = 400;

export interface CheckerOutcome {
  ok: boolean;
  /** 截断后的 checker stderr，用于告诉学生「为什么判错」 */
  message: string | null;
}

/**
 * 跑特殊评测器：把输入/选手输出/标准输出落成三个文件，由 checker 自己读，
 * 避免把可能很大的输出塞进 argv 或 stdin。
 * 判定口径：stdout 首行是 AC/WA 时以它为准，否则看退出码（0 通过）。
 */
export async function runChecker(params: {
  dir: string;
  language: LanguageId;
  sourceFile: string;
  input: string;
  output: string;
  answer: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}): Promise<CheckerOutcome> {
  fs.writeFileSync(path.join(params.dir, 'input.txt'), params.input, 'utf8');
  fs.writeFileSync(path.join(params.dir, 'output.txt'), params.output, 'utf8');
  fs.writeFileSync(path.join(params.dir, 'answer.txt'), params.answer, 'utf8');

  const spec = LANGUAGES[params.language].run(params.dir, params.sourceFile, params.memoryLimitMb);
  const result = await runProcess(spec.cmd, [...spec.args, 'input.txt', 'output.txt', 'answer.txt'], {
    cwd: params.dir,
    timeLimitMs: params.timeLimitMs,
    memoryLimitMb: params.memoryLimitMb,
    outputLimitBytes: 64 * 1024,
  });

  const firstLine = result.stdout.trim().split('\n')[0]?.trim().toUpperCase() ?? '';
  const verdict = firstLine === 'AC' ? true : firstLine === 'WA' ? false : result.status === 'OK' && result.exitCode === 0;

  // checker 用非 0 退出码表示「不通过」是常态，不能被当成评测器崩溃；
  // 只有超时/超内存/超输出才是评测器本身出问题
  const abnormal = result.status === 'TLE' || result.status === 'MLE' || result.status === 'OLE';
  const stderr = result.stderr.trim();
  const raw = [abnormal ? `评测器异常（${result.status}）` : '', stderr].filter(Boolean).join(' ');
  const message = raw ? (raw.length > CHECKER_STDERR_LIMIT ? `${raw.slice(0, CHECKER_STDERR_LIMIT)}…（已截断）` : raw) : null;

  return { ok: verdict, message };
}

function truncateCompileMessage(raw: string): string {
  const text = raw.trim();
  if (!text) return '编译失败';
  return text.length > 4000 ? `${text.slice(0, 4000)}…（输出已截断）` : text;
}
