import { execFile, spawn } from 'child_process';
import fs from 'fs';

export type RunStatus = 'OK' | 'TLE' | 'MLE' | 'RE' | 'OLE' | 'SE';

export interface RunOptions {
  cwd: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitBytes?: number;
  /** Docker applies the contestant memory limit inside the container, not to the Docker CLI. */
  monitorMemory?: boolean;
  stdin?: string;
  env?: Record<string, string>;
}

export interface RunResult {
  status: RunStatus;
  timeMs: number;
  memoryKb: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** 计时后多给的宽限，避免调度抖动误判 TLE */
const KILL_GRACE_MS = 250;
const MEM_POLL_MS = 120;
const STDERR_LIMIT = 16 * 1024;
const DEFAULT_OUTPUT_LIMIT = 4 * 1024 * 1024;

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // Windows 用 taskkill 连带子进程一起杀，否则 javac/java 会留孤儿进程
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
}

function readMemoryKb(pid: number): Promise<number> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve(0);
        const m = stdout.match(/"([\d.,]+)\s*K"/);
        resolve(m ? Number(m[1].replace(/[.,]/g, '')) : 0);
      });
      return;
    }
    try {
      const text = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const m = text.match(/VmHWM:\s+(\d+)\s*kB/);
      resolve(m ? Number(m[1]) : 0);
    } catch {
      resolve(0);
    }
  });
}

/**
 * 在指定目录执行一个子进程，施加时间/内存/输出三重限制。
 * 超限时强杀进程树，并把原因记录在返回的 status 中。
 */
export function runProcess(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const outputLimit = opts.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT;

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let outBytes = 0;
    let errBytes = 0;
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let peakKb = 0;
    let killedReason: RunStatus | null = null;
    let settled = false;

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...opts.env },
    });

    const cleanup = () => {
      if (memTimer) clearInterval(memTimer);
      if (timeTimer) clearTimeout(timeTimer);
      if (fastSample) clearTimeout(fastSample);
    };

    const stop = (reason: RunStatus) => {
      if (killedReason) return;
      killedReason = reason;
      if (child.pid) killTree(child.pid);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes <= outputLimit) outChunks.push(chunk);
      else stop('OLE');
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      errBytes += chunk.length;
      const remaining = Math.max(0, STDERR_LIMIT - (errBytes - chunk.length));
      if (remaining > 0) errChunks.push(chunk.subarray(0, remaining));
      if (outBytes + errBytes > outputLimit) stop('OLE');
    });

    if (opts.stdin !== undefined) {
      child.stdin?.on('error', () => undefined);
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }

    let timeTimer: NodeJS.Timeout | null = setTimeout(() => stop('TLE'), opts.timeLimitMs + KILL_GRACE_MS);
    let memTimer: NodeJS.Timeout | null = null;
    let fastSample: NodeJS.Timeout | null = null;
    let polling = false;

    if (child.pid && opts.monitorMemory !== false) {
      const sample = async () => {
        if (polling || !child.pid || child.exitCode !== null) return;
        polling = true;
        try {
          const kb = await readMemoryKb(child.pid);
          if (kb > peakKb) peakKb = kb;
          if (kb > opts.memoryLimitMb * 1024) stop('MLE');
        } finally {
          polling = false;
        }
      };
      // 快程序几十毫秒就跑完了，先补一次早采样，避免内存一直显示为 0
      fastSample = setTimeout(() => void sample(), 60);
      memTimer = setInterval(() => void sample(), MEM_POLL_MS);
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const timeMs = Date.now() - startedAt;

      let status: RunStatus = 'OK';
      if (killedReason) status = killedReason;
      else if (code !== 0) status = 'RE';
      else if (timeMs > opts.timeLimitMs) status = 'TLE';

      resolve({
        status,
        timeMs,
        memoryKb: peakKb,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        exitCode: code,
      });
    });
  });
}
