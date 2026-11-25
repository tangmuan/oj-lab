import { db } from '../db';
import { JudgeStatus, ProblemRow, SubmissionRow, TestcaseRow } from '../types';
import { FirstDiff, firstDiff, isSameOutput, truncate } from './comparator';
import { BuiltProgram, JudgeExecutor } from './executor';
import { getExecutor } from './executor-factory';
import { isLanguageId, LANGUAGES } from './languages';
import { ownsClaim, releaseClaim, settleBatchItems } from './queue';
import { RunResult } from './runner';

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

function updateSubmission(id: number, patch: Partial<SubmissionRow>): void {
  const entries = Object.entries(patch);
  if (entries.length === 0) return;
  const setSql = entries.map(([k]) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE submissions SET ${setSql} WHERE id = ?`).run(...entries.map(([, v]) => v as never), id);
}

function beginAttempt(submissionId: number, workerId: string, token: string): boolean {
  return db.transaction(() => {
    if (!ownsClaim(submissionId, workerId, token)) return false;
    db.prepare('DELETE FROM submission_cases WHERE submission_id = ?').run(submissionId);
    updateSubmission(submissionId, {
      status: 'JUDGING',
      time_ms: 0,
      memory_kb: 0,
      pass_count: 0,
      total_count: 0,
      compile_msg: null,
      detail: null,
      judged_at: null,
    });
    return true;
  })();
}

function insertCaseIfOwned(submissionId: number, workerId: string, token: string, result: CaseResult): boolean {
  return db.transaction(() => {
    if (!ownsClaim(submissionId, workerId, token)) return false;
    db.prepare(
      'INSERT INTO submission_cases (submission_id, case_index, status, time_ms, memory_kb, is_sample, message, first_diff) VALUES (?,?,?,?,?,?,?,?)'
    ).run(
      submissionId,
      result.caseIndex,
      result.status,
      result.timeMs,
      result.memoryKb,
      result.isSample ? 1 : 0,
      result.message,
      result.firstDiff ? JSON.stringify(result.firstDiff) : null
    );
    return true;
  })();
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
    case 'SE':
      return '评测器运行异常';
    default:
      return null;
  }
}

/**
 * 判一条提交。进度不再走进程内事件——逐点结果写 submission_cases（含 first_diff），
 * API 进程的 SSE 通过轮询这张表推给前端，跨进程也成立。
 * workerId 用于判完后释放队列认领。
 */
export async function judgeOne(
  submissionId: number,
  workerId: string,
  claimToken: string,
  exec: JudgeExecutor = getExecutor()
): Promise<void> {
  if (!beginAttempt(submissionId, workerId, claimToken)) return;
  const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId) as SubmissionRow | undefined;
  if (!sub) {
    releaseClaim(submissionId, workerId, claimToken);
    return;
  }

  const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(sub.problem_id) as ProblemRow | undefined;
  if (!problem) {
    updateSubmission(submissionId, { status: 'SE', judged_at: new Date().toISOString() });
    finishJudging(submissionId, workerId, claimToken, { status: 'SE', judged_at: new Date().toISOString() });
    return;
  }

  if (!LANGUAGES[sub.language]) {
    finishJudging(submissionId, workerId, claimToken, { status: 'SE', judged_at: new Date().toISOString() });
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
    built = await exec.build({
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
        checker = await exec.build({
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
        if (!ownsClaim(submissionId, workerId, claimToken)) return;
        const tc = cases[i];
        const run = await exec.run(built.dir, sub.language, built.sourceFile, {
          input: tc.input,
          timeLimitMs: problem.time_limit_ms,
          memoryLimitMb: problem.memory_limit_mb,
        });

        let status: JudgeStatus;
        let checkerMessage: string | null = null;
        if (run.status !== 'OK') {
          status = run.status;
        } else if (checker) {
          const verdict = await exec.runChecker({
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
          status = verdict.systemError ? 'SE' : verdict.ok ? 'AC' : 'WA';
          checkerMessage = verdict.systemError ? '评测器运行异常' : verdict.ok ? null : verdict.message;
          if (verdict.systemError) compileMsg = `评测器运行异常（${verdict.systemErrorStatus ?? '未知错误'}）`;
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

        if (!insertCaseIfOwned(submissionId, workerId, claimToken, cr)) return;

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
    if (built) exec.cleanup(built.dir);
    if (checker) exec.cleanup(checker.dir);
  }

  const passCount = results.filter((r) => r.status === 'AC').length;
  const judgedAt = new Date().toISOString();

  finishJudging(submissionId, workerId, claimToken, {
    status: finalStatus,
    time_ms: maxTime,
    memory_kb: maxMem,
    pass_count: passCount,
    total_count: results.length,
    compile_msg: compileMsg,
    detail: JSON.stringify(results),
    judged_at: judgedAt,
  });
}

/**
 * 判题收尾的公共动作：结算批量重判批次里属于该提交的 item（进度由剩余数推导），
 * 再释放队列认领。顺序无所谓，两件事互相独立。
 */
function finishJudging(submissionId: number, workerId: string, token: string, patch: Partial<SubmissionRow>): void {
  db.transaction(() => {
    if (!ownsClaim(submissionId, workerId, token)) return;
    updateSubmission(submissionId, patch);
    settleBatchItems(submissionId);
    releaseClaim(submissionId, workerId, token);
  })();
}
