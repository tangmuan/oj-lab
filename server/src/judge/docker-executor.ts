import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { LanguageId } from '../types';
import { AppError } from '../utils/errors';
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

/** Docker daemon/container startup is infrastructure overhead, not contestant runtime. */
const DOCKER_STARTUP_GRACE_MS = 10_000;

/**
 * Docker 执行器：每次编译/运行/checker 都在一个一次性容器里完成，
 * 用 --network none --read-only --pids-limit --memory --cpus --user 做真实隔离。
 *
 * 关键设计：
 * - 超时/输出上限/内存采样仍复用 runner.ts 的 runProcess——它现在限制的是 `docker run`
 *   这个 CLI 进程，超时由它的定时器杀掉 docker 客户端；容器本身再用 docker rm -f 兜底清理。
 * - 内存隔离不靠宿主采样（容器进程在 VM 里，tasklist/proc 看不到），靠 --memory 让内核
 *   cgroup OOM 杀掉超限进程，退出码 137 映射回 MLE。
 */
export const dockerExecutor: JudgeExecutor = {
  name: 'docker',

  async build(params: BuildParams): Promise<BuiltProgram> {
    const lang = LANGUAGES[params.language];
    if (!lang.containerRun) {
      throw new AppError(`语言 ${lang.label} 暂不支持 Docker 执行器`, 503, 'JUDGE_EXECUTOR_UNAVAILABLE');
    }

    const dir = prepareWorkDir(params.prefix);
    try {
    // 容器内以 nobody(uid 65534) 运行，宿主目录必须对任意 uid 可写，否则编译产物写不进去
    openPermissions(dir);

    const sourceFile = lang.sourceFile(params.code);
    fs.writeFileSync(path.join(dir, sourceFile), params.code, 'utf8');

    // 编译也必须在容器里跑：宿主上没有工具链、或者工具链版本与镜像不一致都会造成误判
    const compileSpec = lang.containerCompile?.(sourceFile, params.memoryLimitMb);
    if (compileSpec) {
      try {
        const cr = await runInContainer(dir, [compileSpec.cmd, ...compileSpec.args], {
          timeLimitMs: COMPILE_TIMEOUT_MS,
          memoryLimitMb: COMPILE_MEMORY_MB,
          outputLimitBytes: 256 * 1024,
        });
        if (cr.status !== 'OK') {
          // 先区分「环境坏了」和「用户代码错了」：daemon 没起、镜像缺失不能算 CE
          if (cr.status === 'SE') throw dockerUnavailable(cr.stderr || 'Docker 容器未能完成启动');
          const envErr = dockerEnvError(cr.stderr);
          if (envErr) throw dockerUnavailable(envErr);
          return {
            ok: false,
            dir,
            language: lang,
            sourceFile,
            compileMsg: truncateCompileMessage(`${cr.stdout}\n${cr.stderr}`),
          };
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
        return {
          ok: false,
          dir,
          language: lang,
          sourceFile,
          compileMsg: `编译环境不可用：${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    if (params.warmup !== false && lang.warmup !== false) {
      const spec = lang.containerRun(sourceFile, params.memoryLimitMb);
      await runInContainer(dir, [spec.cmd, ...spec.args], {
        timeLimitMs: WARMUP_TIMEOUT_MS,
        memoryLimitMb: params.memoryLimitMb,
        outputLimitBytes: 64 * 1024,
        stdin: '',
      }).catch(() => undefined);
    }

    return { ok: true, dir, language: lang, sourceFile, compileMsg: null };
    } catch (err) {
      removeDir(dir);
      throw err;
    }
  },

  async run(dir: string, language: LanguageId, sourceFile: string, opts: RunParams): Promise<RunResult> {
    const lang = LANGUAGES[language];
    if (!lang.containerRun) {
      throw new AppError(`语言 ${lang.label} 暂不支持 Docker 执行器`, 503, 'JUDGE_EXECUTOR_UNAVAILABLE');
    }
    const spec = lang.containerRun(sourceFile, opts.memoryLimitMb);
    return runInContainer(dir, [spec.cmd, ...spec.args], {
      timeLimitMs: opts.timeLimitMs,
      memoryLimitMb: opts.memoryLimitMb,
      outputLimitBytes: opts.outputLimitBytes,
      stdin: opts.input,
    });
  },

  async runChecker(params: CheckerParams): Promise<CheckerOutcome> {
    const lang = LANGUAGES[params.language];
    if (!lang.containerRun) {
      throw new AppError(`语言 ${lang.label} 暂不支持 Docker 执行器`, 503, 'JUDGE_EXECUTOR_UNAVAILABLE');
    }
    writeCheckerFiles(params);

    // checker 与选手代码跑在各自的容器里（只共享隔离配置），互不影响
    const spec = lang.containerRun(params.sourceFile, params.memoryLimitMb);
    const result = await runInContainer(
      params.dir,
      [spec.cmd, ...spec.args, 'input.txt', 'output.txt', 'answer.txt'],
      {
        timeLimitMs: params.timeLimitMs,
        memoryLimitMb: params.memoryLimitMb,
        outputLimitBytes: 64 * 1024,
      }
    );

    return interpretCheckerResult(result);
  },

  cleanup: removeDir,
};

interface ContainerRunOptions {
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitBytes?: number;
  stdin?: string;
}

/** 用题目要求的隔离参数跑一次容器命令；超时/输出上限由 runProcess 统一施加 */
async function runInContainer(
  dir: string,
  argv: string[],
  opts: ContainerRunOptions
): Promise<RunResult> {
  // 名字带上时间与随机数：并发 worker 同时跑也不会撞名
  const name = `oj-judge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // --memory-swap 与 --memory 相同 = 禁用 swap，内存超限必然触发 OOM 而不是换页慢慢熬
  const memMb = Math.max(16, opts.memoryLimitMb);
  const args = [
    'run',
    '--rm',
    '--name',
    name,
    '--network',
    'none',
    '--read-only',
    '--pids-limit',
    '64',
    '--memory',
    `${memMb}m`,
    '--memory-swap',
    `${memMb}m`,
    '--cpus',
    '1',
    '--user',
    '65534',
    // 只读 rootfs 下 JVM 等运行时仍需要 /tmp，给一块小 tmpfs，不挂宿主任何数据目录
    '--tmpfs',
    '/tmp:rw,size=64m',
    '-v',
    `${dir}:/box`,
    '-w',
    '/box',
    config.judgeDockerImage,
    // argv 只能由下面的 launcher 传一次：这里再拼一次会让容器的命令变成
    // `g++ -O2 ... -o main main.cpp sh -c ... 20s g++ ...`，g++ 收到多个源文件直接报错
  ];

  const runtimeFile = path.join(dir, '.oj-runtime');
  const startedFile = path.join(dir, '.oj-started');
  try {
    fs.rmSync(runtimeFile, { force: true });
    fs.rmSync(startedFile, { force: true });
  } catch {
    /* the container will report an executor error if the work directory is unavailable */
  }

  const timeout = `${Math.max(1, opts.timeLimitMs) / 1000}s`;
  const launcher = [
    'sh',
    '-c',
    'limit=$1; shift; : > /box/.oj-started; start=$(date +%s%N); timeout --verbose -k 0.25s "$limit" "$@"; rc=$?; end=$(date +%s%N); printf "%s" "$(( (end-start)/1000000 ))" > /box/.oj-runtime; exit "$rc"',
    'oj-launcher',
    timeout,
    ...argv,
  ];

  let result: RunResult;
  try {
    result = await runProcess('docker', [...args, ...launcher], {
      cwd: dir,
      timeLimitMs: opts.timeLimitMs + DOCKER_STARTUP_GRACE_MS,
      memoryLimitMb: memMb,
      monitorMemory: false,
      outputLimitBytes: opts.outputLimitBytes,
      stdin: opts.stdin,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // spawn 阶段就失败：docker 命令不存在（未安装或不在 PATH）
    throw dockerUnavailable(`未找到 docker 命令（${err instanceof Error ? err.message : String(err)}）`);
  }

  let programTime = 0;
  let hasRuntimeMarker = false;
  let hasStartedMarker = false;
  try {
    const raw = fs.readFileSync(runtimeFile, 'utf8');
    if (/^\d+$/.test(raw)) {
      programTime = Number(raw);
      hasRuntimeMarker = true;
    }
  } catch {
    // A missing marker means the container did not reach or finish its launcher.
  } finally {
    try {
      fs.rmSync(runtimeFile, { force: true });
    } catch {
      /* cleanup below still removes the complete work directory */
    }
    try {
      hasStartedMarker = fs.existsSync(startedFile);
      fs.rmSync(startedFile, { force: true });
    } catch {
      /* the complete work directory is removed by the executor */
    }
  }

  const timeoutDiagnostic = /timeout: sending signal (?:TERM|KILL) to command/i.test(result.stderr);
  if (result.exitCode === 124 || timeoutDiagnostic) result = { ...result, status: 'TLE' };
  else if (result.status === 'RE' && result.exitCode === 137 && hasStartedMarker) result = { ...result, status: 'MLE' };
  if (!hasStartedMarker && (result.status === 'TLE' || result.status === 'RE')) {
    // No in-container timing marker means daemon/container startup failed to complete.
    result = { ...result, status: 'SE', stderr: result.stderr || 'Docker 容器未能完成启动' };
  } else if (!hasRuntimeMarker && !['OLE', 'MLE', 'SE'].includes(result.status)) {
    result = { ...result, status: 'SE', stderr: result.stderr || 'Docker 容器未能记录程序运行结果' };
  } else if (hasRuntimeMarker) {
    result = { ...result, timeMs: programTime };
  }

  // 超时/超内存时 runProcess 杀掉的是 docker 客户端，容器本体要显式清理，否则留孤儿容器
  if (result.status === 'TLE' || result.status === 'MLE' || result.status === 'OLE' || result.status === 'SE') {
    await bestEffortRemoveContainer(name);
  }

  // cgroup OOM 杀进程的退出码是 137；宿主侧采样不到容器内存，MLE 只能靠它判定
  if (result.status === 'RE' && result.exitCode === 137) {
    await bestEffortRemoveContainer(name);
    return { ...result, status: 'MLE' };
  }

  if (result.status === 'RE' && !hasRuntimeMarker) {
    await bestEffortRemoveContainer(name);
    return { ...result, status: 'SE', memoryKb: 0 };
  }

  return { ...result, memoryKb: 0 };
}

function bestEffortRemoveContainer(name: string): Promise<void> {
  return new Promise((resolve) => {
    execFile('docker', ['rm', '-f', name], { windowsHide: true, timeout: 5000 }, () => resolve());
  });
}

/** 宿主目录对容器内 nobody(uid 65534) 可写 */
function openPermissions(dir: string): void {
  try {
    fs.chmodSync(dir, 0o777);
  } catch {
    /* Windows 的权限模型不同（Docker Desktop 挂载默认全放行），失败可忽略 */
  }
}

/** 这些 stderr 特征说明是 docker 环境本身不可用，而不是用户代码编译失败 */
const DOCKER_ENV_HINTS = [
  /cannot connect to the docker daemon/i,
  /error during connect/i,
  /is the docker daemon running/i,
  /no such image/i,
  /unable to find image/i,
  /pull access denied/i,
];

function dockerEnvError(stderr: string): string | null {
  if (!stderr) return null;
  const hit = DOCKER_ENV_HINTS.some((re) => re.test(stderr));
  if (!hit) return null;
  return stderr.trim().split('\n')[0]?.trim() || 'docker daemon 未响应';
}

function dockerUnavailable(detail: string): AppError {
  return new AppError(`Docker 执行器不可用：${detail}`, 503, 'JUDGE_EXECUTOR_UNAVAILABLE');
}
