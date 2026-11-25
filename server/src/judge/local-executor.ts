import fs from 'fs';
import path from 'path';
import { LanguageId } from '../types';
import {
  BuildParams,
  BuiltProgram,
  CheckerOutcome,
  CheckerParams,
  COMPILE_MEMORY_MB,
  COMPILE_TIMEOUT_MS,
  JudgeExecutor,
  RunParams,
  WARMUP_TIMEOUT_MS,
  interpretCheckerResult,
  prepareWorkDir,
  removeDir,
  truncateCompileMessage,
  writeCheckerFiles,
} from './executor';
import { LANGUAGES } from './languages';
import { runProcess, RunResult } from './runner';

/**
 * 宿主子进程执行器（默认）。只施加时间/内存/输出三重限制，没有文件系统与网络隔离——
 * 需要「读不到宿主文件、连不上网」的真实隔离时，切换 JUDGE_EXECUTOR=docker。
 */
export const localExecutor: JudgeExecutor = {
  name: 'local',

  /**
   * 在临时目录落盘源码并编译（解释型语言做语法检查）。
   * 编译成功后可选做一次预热执行，规避 Windows 对新 exe 的首次扫描。
   */
  async build(params: BuildParams): Promise<BuiltProgram> {
    const lang = LANGUAGES[params.language];
    const dir = prepareWorkDir(params.prefix);

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
  },

  /** 用给定的标准输入跑一次程序 */
  run(dir: string, language: LanguageId, sourceFile: string, opts: RunParams): Promise<RunResult> {
    const spec = LANGUAGES[language].run(dir, sourceFile, opts.memoryLimitMb);
    return runProcess(spec.cmd, spec.args, {
      cwd: dir,
      timeLimitMs: opts.timeLimitMs,
      memoryLimitMb: opts.memoryLimitMb,
      stdin: opts.input,
      outputLimitBytes: opts.outputLimitBytes,
    });
  },

  /**
   * 跑特殊评测器：把输入/选手输出/标准答案落成三个文件，由 checker 自己读，
   * 避免把可能很大的输出塞进 argv 或 stdin。
   */
  async runChecker(params: CheckerParams): Promise<CheckerOutcome> {
    writeCheckerFiles(params);

    const spec = LANGUAGES[params.language].run(params.dir, params.sourceFile, params.memoryLimitMb);
    const result = await runProcess(spec.cmd, [...spec.args, 'input.txt', 'output.txt', 'answer.txt'], {
      cwd: params.dir,
      timeLimitMs: params.timeLimitMs,
      memoryLimitMb: params.memoryLimitMb,
      outputLimitBytes: 64 * 1024,
    });

    return interpretCheckerResult(result);
  },

  cleanup: removeDir,
};
