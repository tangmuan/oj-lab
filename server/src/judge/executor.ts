import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { LanguageId } from '../types';
import { LanguageSpec } from './languages';
import { RunResult, RunStatus } from './runner';

export const COMPILE_TIMEOUT_MS = 20000;
export const COMPILE_MEMORY_MB = 2048;
export const WARMUP_TIMEOUT_MS = 2500;

export interface BuiltProgram {
  ok: boolean;
  /** 宿主机侧的工作目录；docker 执行器会把它挂载进容器的 /box */
  dir: string;
  language: LanguageSpec;
  sourceFile: string;
  compileMsg: string | null;
}

export interface BuildParams {
  code: string;
  language: LanguageId;
  memoryLimitMb: number;
  prefix: string;
  warmup?: boolean;
}

export interface RunParams {
  input: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitBytes?: number;
}

export interface CheckerParams {
  dir: string;
  language: LanguageId;
  sourceFile: string;
  input: string;
  output: string;
  answer: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface CheckerOutcome {
  ok: boolean;
  /** TLE/MLE/OLE or an executor failure belongs to the judging system, not the contestant. */
  systemError: boolean;
  systemErrorStatus?: RunStatus;
  /** 截断后的 checker stderr（含异常状态）；调用方只能把它展示在样例测试点上，隐藏测试点必须丢弃 */
  message: string | null;
}

/**
 * 判题执行器的统一契约：build（落盘 + 编译 + 预热）、run（跑一次）、runChecker、cleanup。
 * 工作目录的创建/清理、超时与输出上限的取值都在本文件（或调用方），
 * 各实现只负责「怎么把一条命令跑起来」，不重复公共逻辑。
 */
export interface JudgeExecutor {
  /** 用于日志与错误提示 */
  readonly name: 'local' | 'docker';
  build(params: BuildParams): Promise<BuiltProgram>;
  /** 跑一次已构建好的程序 */
  run(dir: string, language: LanguageId, sourceFile: string, opts: RunParams): Promise<RunResult>;
  runChecker(params: CheckerParams): Promise<CheckerOutcome>;
  /** 释放 build 产生的工作目录 */
  cleanup(dir: string): void;
}

/** 在判题工作目录下创建一次性目录；两种执行器共用同一套位置与命名 */
export function prepareWorkDir(prefix: string): string {
  const dir = path.join(
    config.judgeWorkDir,
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响判题结果 */
  }
}

export function truncateCompileMessage(raw: string): string {
  const text = raw.trim();
  if (!text) return '编译失败';
  return text.length > 4000 ? `${text.slice(0, 4000)}…（输出已截断）` : text;
}

/** checker 的三个输入文件落盘；容器执行时同样从挂载目录里读这些文件 */
export function writeCheckerFiles(params: CheckerParams): void {
  fs.writeFileSync(path.join(params.dir, 'input.txt'), params.input, 'utf8');
  fs.writeFileSync(path.join(params.dir, 'output.txt'), params.output, 'utf8');
  fs.writeFileSync(path.join(params.dir, 'answer.txt'), params.answer, 'utf8');
}

/**
 * checker 判定口径（两种执行器共用）：stdout 首行是 AC/WA 时以它为准，否则看退出码（0 通过）。
 * checker 用非 0 退出码表示「不通过」是常态，不能被当成评测器崩溃；
 * 只有超时/超内存/超输出才是评测器本身出问题。
 */
export function interpretCheckerResult(result: RunResult): CheckerOutcome {
  const CHECKER_STDERR_LIMIT = 400;
  const abnormal: RunStatus[] = ['TLE', 'MLE', 'OLE', 'SE'];
  if (abnormal.includes(result.status)) {
    const stderr = result.stderr.trim();
    const raw = `评测器异常（${result.status}）${stderr ? ` ${stderr}` : ''}`;
    return {
      ok: false,
      systemError: true,
      systemErrorStatus: result.status,
      message: raw.length > CHECKER_STDERR_LIMIT ? `${raw.slice(0, CHECKER_STDERR_LIMIT)}…（已截断）` : raw,
    };
  }

  const firstLine = result.stdout.trim().split('\n')[0]?.trim().toUpperCase() ?? '';
  const verdict =
    firstLine === 'AC' ? true : firstLine === 'WA' ? false : result.status === 'OK' && result.exitCode === 0;
  const stderr = result.stderr.trim();
  const raw = stderr;
  const message = raw
    ? raw.length > CHECKER_STDERR_LIMIT
      ? `${raw.slice(0, CHECKER_STDERR_LIMIT)}…（已截断）`
      : raw
    : null;

  return { ok: verdict, systemError: false, message };
}
