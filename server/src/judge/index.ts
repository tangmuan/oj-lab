import { EventEmitter } from 'events';
import { config } from '../config';
import { db } from '../db';
import { JudgeStatus, ProblemRow, SubmissionRow, TestcaseRow } from '../types';
import { FirstDiff, firstDiff, isSameOutput, truncate } from './comparator';
import { buildProgram, BuiltProgram, removeDir, runChecker, runOnce } from './exec';
import { isLanguageId, LANGUAGES } from './languages';
import { RunResult } from './runner';

export const judgeEvents = new EventEmitter();
judgeEvents.setMaxListeners(0);

export interface CaseResult {
  caseIndex: number;
  status: JudgeStatus;
  timeMs: number;
  memoryKb: number;
  isSample: boolean;
  message: string | null;
  /** 仅 WA 有值；旧数据没有该字段，前端需要按「可能缺失」处理 */
  firstDiff: FirstDiff | null;
}

const queue: number[] = [];
let running = 0;
/** 正在判题的提交 id：queue.includes 只防「排队重复」，防不住「判到一半又被批量重判」的重复入队 */
const runningIds = new Set<number>();

/**
 * 返回是否真正入队。同一 id 正在判题时返回 false（跳过），
 * 调用方（批量重判）需要据此把该 id 从批次里结算掉，否则批次永远到不了 100%。
 */
export function enqueueSubmission(id: number): boolean {
  if (runningIds.has(id)) return false;
  if (!queue.includes(id)) queue.push(id);
  pump();
  return true;
}

function pump(): void {
  while (running < config.judgeConcurrency && queue.length > 0) {
    const id = queue.shift()!;
    running += 1;
    runningIds.add(id);
    judgeOne(id)
      .catch((err) => {
        console.error(`[judge] submission ${id} crashed`, err);
      })
      .finally(() => {
        runningIds.delete(id);
        running -= 1;
        pump();
      });
  }
}

export function queueStats() {
  return { running, waiting: queue.length, concurrency: config.judgeConcurrency };
}

/** 服务重启后把中断的提交重新排队 */
export function recoverPending(): number {
  db.prepare("UPDATE submissions SET status = 'PENDING' WHERE status = 'JUDGING'").run();
  const rows = db.prepare("SELECT id FROM submissions WHERE status = 'PENDING' ORDER BY id ASC").all() as { id: number }[];
  rows.forEach((r) => enqueueSubmission(r.id));
  return rows.length;
}

function emit(id: number, payload: unknown): void {
  judgeEvents.emit(`sub:${id}`, payload);
  // 批量重判靠这个全局信号统计进度，避免为每条提交单独挂监听
  if ((payload as { type?: string }).type === 'done') {
    judgeEvents.emit('any-done', payload);
  }
}

function updateSubmission(id: number, patch: Partial<SubmissionRow>): void {
  const entries = Object.entries(patch);
  if (entries.length === 0) return;
  const setSql = entries.map(([k]) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE submissions SET ${setSql} WHERE id = ?`).run(...entries.map(([, v]) => v as never), id);
}

function caseMessage(
  status: JudgeStatus,
  isSample: boolean,
  actual: string,
  expected: string,
  run: RunResult,
  diff: FirstDiff | null
): string | null {
  switch (status) {
    case 'AC':
      return null;
    case 'WA': {
      const where = diff ? `第 ${diff.line} 行第 ${diff.column} 列` : '';
      // 非样例不泄露期望输出，只给位置
      if (!isSample) return where ? `答案错误 · ${where}起不同` : '答案错误';
      return `答案错误 · ${where ? `${where}起不同：` : ''}期望「${truncate(expected, 120)}」，实际「${truncate(actual, 120)}」`;
    }
    case 'TLE':
      return '超出时间限制';
    case 'MLE':
      return '超出内存限制';
    case 'OLE':
      return '输出超出限制（> 4MB）';
    case 'RE':
      return `运行错误（退出码 ${run.exitCode ?? 'null'}）${run.stderr ? `：${truncate(run.stderr.trim().split('\n')[0], 120)}` : ''}`;
    default:
      return null;
  }
}

async function judgeOne(submissionId: number): Promise<void> {
  const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId) as SubmissionRow | undefined;
  if (!sub) return;

  const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(sub.problem_id) as ProblemRow | undefined;
  if (!problem) {
    updateSubmission(submissionId, { status: 'SE', judged_at: new Date().toISOString() });
    emit(submissionId, { type: 'done', submissionId, status: 'SE' });
    return;
  }

  updateSubmission(submissionId, { status: 'JUDGING' });
  emit(submissionId, { type: 'status', submissionId, status: 'JUDGING' });

  if (!LANGUAGES[sub.language]) {
    updateSubmission(submissionId, { status: 'SE', judged_at: new Date().toISOString() });
    emit(submissionId, { type: 'done', submissionId, status: 'SE', message: '不支持的语言' });
    return;
  }

  let finalStatus: JudgeStatus = 'AC';
  let compileMsg: string | null = null;
  let maxTime = 0;
  let maxMem = 0;
  const results: CaseResult[] = [];
  let built: BuiltProgram | null = null;
  let checker: BuiltProgram | null = null;
  const checkerCode = problem.checker_code?.trim() ?? '';
  const checkerLanguage = isLanguageId(problem.checker_language) ? problem.checker_language : 'cpp';

  try {
    built = await buildProgram({
      code: sub.code,
      language: sub.language,
      memoryLimitMb: problem.memory_limit_mb,
      prefix: `sub-${submissionId}`,
      warmup: true,
    });

    if (!built.ok) {
      finalStatus = 'CE';
      compileMsg = built.compileMsg;
    } else {
      // 特殊评测器是题目配置的一部分，编译失败属于系统错误而不是选手的问题
      if (checkerCode) {
        checker = await buildProgram({
          code: checkerCode,
          language: checkerLanguage,
          memoryLimitMb: 512,
          prefix: `chk-${submissionId}`,
          warmup: false,
        });
        if (!checker.ok) {
          finalStatus = 'SE';
          compileMsg = `评测器编译失败：${checker.compileMsg ?? '未知错误'}`;
        }
      }

      const cases = db
        .prepare('SELECT * FROM testcases WHERE problem_id = ? ORDER BY ord ASC, id ASC')
        .all(problem.id) as TestcaseRow[];

      if (cases.length === 0) {
        finalStatus = 'SE';
        compileMsg = '该题目尚未配置测试用例';
      }

      for (let i = 0; i < cases.length && finalStatus !== 'SE'; i += 1) {
        const tc = cases[i];
        const run = await runOnce(built.dir, sub.language, built.sourceFile, {
          input: tc.input,
          timeLimitMs: problem.time_limit_ms,
          memoryLimitMb: problem.memory_limit_mb,
        });

        let status: JudgeStatus;
        let checkerMessage: string | null = null;
        if (run.status !== 'OK') {
          status = run.status;
        } else if (checker) {
          const verdict = await runChecker({
            dir: checker.dir,
            language: checkerLanguage,
            sourceFile: checker.sourceFile,
            input: tc.input,
            output: run.stdout,
            answer: tc.expected_output,
            // checker 是评测逻辑，给固定宽限，不受题目时限影响
            timeLimitMs: 10_000,
            memoryLimitMb: 512,
          });
          status = verdict.ok ? 'AC' : 'WA';
          checkerMessage = verdict.ok ? null : verdict.message;
        } else {
          status = isSameOutput(run.stdout, tc.expected_output) ? 'AC' : 'WA';
        }

        const timeMs = Math.min(run.timeMs, 600000);
        maxTime = Math.max(maxTime, timeMs);
        maxMem = Math.max(maxMem, run.memoryKb);

        const isSample = tc.is_sample === 1;
        const rawDiff = status === 'WA' && !checker ? firstDiff(run.stdout, tc.expected_output) : null;
        // 非样例只回位置、不回数据：否则学生能靠差异提示反推隐藏测试点内容
        const diff = rawDiff && !isSample ? { ...rawDiff, actualLine: null, expectedLine: null } : rawDiff;
        // checker 的 stderr 可能包含期望值等判定依据，只在样例上展示（学生能自己复现）；
        // 隐藏测试点一律只回固定文案，避免 checker 把答案打进 stderr 造成泄题。
        // 在源头（构造 message 时）就按样例过滤，落库 / detail / SSE 三条路径自动同规则
        const message = checkerMessage
          ? isSample
            ? `评测器判为错误：${checkerMessage}`
            : '评测器判为错误'
          : caseMessage(status, isSample, run.stdout, tc.expected_output, run, diff);

        const cr: CaseResult = {
          caseIndex: i + 1,
          status,
          timeMs,
          memoryKb: run.memoryKb,
          isSample,
          message,
          firstDiff: diff,
        };
        results.push(cr);

        db.prepare(
          'INSERT INTO submission_cases (submission_id, case_index, status, time_ms, memory_kb, is_sample, message) VALUES (?,?,?,?,?,?,?)'
        ).run(submissionId, cr.caseIndex, status, timeMs, run.memoryKb, tc.is_sample, message);

        emit(submissionId, {
          type: 'case',
          submissionId,
          case: {
            case_index: cr.caseIndex,
            status: cr.status,
            time_ms: cr.timeMs,
            memory_kb: cr.memoryKb,
            is_sample: tc.is_sample,
            message: cr.message,
            first_diff: cr.firstDiff,
          },
        });

        if (status !== 'AC') {
          finalStatus = status;
          break; // 首个非 AC 即终止，后续测试点不再消耗资源
        }
      }
    }
  } catch (err) {
    console.error(`[judge] submission ${submissionId} error`, err);
    finalStatus = 'SE';
    compileMsg = err instanceof Error ? err.message : String(err);
  } finally {
    if (built) removeDir(built.dir);
    if (checker) removeDir(checker.dir);
  }

  const passCount = results.filter((r) => r.status === 'AC').length;
  const judgedAt = new Date().toISOString();

  updateSubmission(submissionId, {
    status: finalStatus,
    time_ms: maxTime,
    memory_kb: maxMem,
    pass_count: passCount,
    total_count: results.length,
    compile_msg: compileMsg,
    detail: JSON.stringify(results),
    judged_at: judgedAt,
  });

  emit(submissionId, {
    type: 'done',
    submissionId,
    status: finalStatus,
    timeMs: maxTime,
    memoryKb: maxMem,
    passCount,
    totalCount: results.length,
    compileMsg,
  });
}
