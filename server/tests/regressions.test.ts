import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { JudgeExecutor } from '../src/judge/executor';

test('OJ security, judging, queue, and contest regressions', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-regressions-'));
  process.env.NODE_ENV = 'test';
  process.env.OJ_DEPLOYMENT_MODE = 'development';
  process.env.JWT_SECRET = 'regression-test-secret-not-for-production';
  process.env.DB_PATH = path.join(tempRoot, 'oj.db');
  process.env.JUDGE_WORK_DIR = path.join(tempRoot, 'judge');
  process.env.JUDGE_EXECUTOR = 'local';
  process.env.JUDGE_WORKERS = '2';
  process.env.JUDGE_QUEUE_LIMIT = '100';
  process.env.RUN_COOLDOWN_MS = '10';
  process.env.SUBMIT_COOLDOWN_SEC = '0';

  const { db, initDb } = await import('../src/db');
  const { createApp } = await import('../src/app');
  const { signToken } = await import('../src/utils/jwt');
  const { toSqlUtc, freezeMoment, isFrozenForViewer } = await import('../src/utils/contest');
  const { interpretCheckerResult } = await import('../src/judge/executor');
  const { LANGUAGES } = await import('../src/judge/languages');
  const { claimNext, enqueueSubmission, heartbeatClaims, recoverExpiredQueue, releaseWorkerClaims, retryClaim } =
    await import('../src/judge/queue');
  const { acquireExecutionLease, consumeRateLimit, releaseExecutionLease } = await import('../src/utils/requestLimits');
  const { judgeOne } = await import('../src/judge');
  const { startWorker } = await import('../src/judge/worker');

  initDb();
  const app = createApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const now = new Date();
  const userInsert = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  const adminId = Number(userInsert.run('admin-test', 'x', 'admin').lastInsertRowid);
  const studentId = Number(userInsert.run('student-test', 'x', 'user').lastInsertRowid);
  const otherId = Number(userInsert.run('other-test', 'x', 'user').lastInsertRowid);
  const adminToken = signToken({ id: adminId, username: 'admin-test', role: 'admin' });
  const studentToken = signToken({ id: studentId, username: 'student-test', role: 'user' });

  async function api(url: string, options: { method?: string; token?: string; body?: unknown } = {}) {
    const response = await fetch(`${base}${url}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) as Record<string, any> : null };
  }

  function addProblem(title: string, opts: { checker?: string | null; memoryMb?: number } = {}): number {
    const result = db.prepare(
      `INSERT INTO problems (title, description, input_format, output_format, hint, time_limit_ms,
             memory_limit_mb, is_public, checker_language, checker_code)
       VALUES (?, '', '', '', '', 5000, ?, 1, ?, ?)`
    ).run(title, opts.memoryMb ?? 256, opts.checker ? 'cpp' : null, opts.checker ?? null);
    return Number(result.lastInsertRowid);
  }

  function addSubmission(problemId: number, userId: number, status: string, createdAt: string, language = 'cpp', code = 'int main(){}'): number {
    const result = db.prepare(
      'INSERT INTO submissions (user_id, problem_id, language, code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, problemId, language, code, status, createdAt);
    return Number(result.lastInsertRowid);
  }

  await t.test('SPJ timeout/memory/output failures are system errors while WA remains a verdict', () => {
    const result = (status: 'OK' | 'TLE' | 'MLE' | 'OLE' | 'RE', stdout: string, exitCode: number | null) => ({
      status,
      stdout,
      stderr: '',
      exitCode,
      timeMs: 10,
      memoryKb: 0,
    });
    for (const status of ['TLE', 'MLE', 'OLE'] as const) {
      const verdict = interpretCheckerResult(result(status, 'AC\n', 0));
      assert.equal(verdict.ok, false, `AC from a ${status} checker must not pass`);
      assert.equal(verdict.systemError, true);
      assert.equal(verdict.systemErrorStatus, status);
    }
    assert.deepEqual(interpretCheckerResult(result('RE', 'WA\n', 1)), {
      ok: false,
      systemError: false,
      message: null,
    });
    assert.equal(interpretCheckerResult(result('OK', 'AC\n', 0)).ok, true);
  });

  await t.test('judge flow records SPJ infrastructure errors as SE and normal checker rejection as WA', async () => {
    const problemId = addProblem('[test] checker', { checker: 'int main() { return 0; }' });
    db.prepare('INSERT INTO testcases (problem_id, input, expected_output, is_sample, ord) VALUES (?, ?, ?, 0, 1)')
      .run(problemId, '', '3\n');

    const fakeExecutor: JudgeExecutor = {
      name: 'local',
      async build(params) {
        return {
          ok: true,
          dir: path.join(tempRoot, params.prefix),
          language: LANGUAGES[params.language],
          sourceFile: LANGUAGES[params.language].sourceFile(params.code),
          compileMsg: null,
        };
      },
      async run() {
        return { status: 'OK', stdout: '3\n', stderr: '', exitCode: 0, timeMs: 1, memoryKb: 0 };
      },
      async runChecker() {
        return this.verdict;
      },
      cleanup() {},
      verdict: { ok: false, systemError: true, systemErrorStatus: 'TLE', message: 'private checker diagnostic' },
    } as JudgeExecutor & { verdict: { ok: boolean; systemError: boolean; systemErrorStatus: 'TLE'; message: string } };

    async function judgeWith(verdict: { ok: boolean; systemError: boolean; systemErrorStatus?: 'TLE'; message: string }) {
      fakeExecutor.verdict = verdict;
      const id = addSubmission(problemId, studentId, 'PENDING', toSqlUtc(new Date()));
      enqueueSubmission(id);
      const claim = claimNext('fake-worker');
      assert.ok(claim);
      await judgeOne(id, 'fake-worker', claim.token, fakeExecutor);
      return db.prepare('SELECT status, compile_msg FROM submissions WHERE id = ?').get(id) as { status: string; compile_msg: string | null };
    }

    const systemFailure = await judgeWith({
      ok: false,
      systemError: true,
      systemErrorStatus: 'TLE',
      message: 'private checker diagnostic',
    });
    assert.equal(systemFailure.status, 'SE');
    assert.equal(systemFailure.compile_msg, '评测器运行异常（TLE）');
    assert.equal((db.prepare('SELECT status FROM submission_cases WHERE submission_id = (SELECT MAX(id) FROM submissions)').get() as { status: string }).status, 'SE');
    assert.equal(JSON.stringify(systemFailure).includes('private checker diagnostic'), false);

    const wrongAnswer = await judgeWith({ ok: false, systemError: false, message: 'wrong answer' });
    assert.equal(wrongAnswer.status, 'WA');
    db.prepare('DELETE FROM submissions').run();
  });

  const visibleProblem = addProblem('[test] visible during contest');
  const contestStart = new Date(now.getTime() - 2 * 60 * 60_000);
  const contestEnd = new Date(now.getTime() + 20 * 60_000);
  const freezeContestId = Number(db.prepare(
    'INSERT INTO contests (title, start_at, end_at, frozen_minutes, is_public) VALUES (?, ?, ?, 30, 1)'
  ).run('freeze-test', toSqlUtc(contestStart), toSqlUtc(contestEnd)).lastInsertRowid);
  db.prepare('INSERT INTO contest_problems (contest_id, problem_id, label) VALUES (?, ?, ?)').run(freezeContestId, visibleProblem, 'A');
  const extraUpcoming = Number(db.prepare(
    'INSERT INTO contests (title, start_at, end_at, frozen_minutes, is_public) VALUES (?, ?, ?, 0, 1)'
  ).run('second-upcoming', toSqlUtc(new Date(now.getTime() + 2 * 60 * 60_000)), toSqlUtc(new Date(now.getTime() + 4 * 60 * 60_000))).lastInsertRowid);
  db.prepare('INSERT INTO contest_problems (contest_id, problem_id, label) VALUES (?, ?, ?)').run(extraUpcoming, visibleProblem, 'B');

  const upcomingProblem = addProblem('[test] upcoming only');
  const upcomingContestId = Number(db.prepare(
    'INSERT INTO contests (title, start_at, end_at, frozen_minutes, is_public) VALUES (?, ?, ?, 0, 1)'
  ).run('upcoming-test', toSqlUtc(new Date(now.getTime() + 2 * 60 * 60_000)), toSqlUtc(new Date(now.getTime() + 4 * 60 * 60_000))).lastInsertRowid);
  db.prepare('INSERT INTO contest_problems (contest_id, problem_id, label) VALUES (?, ?, ?)').run(upcomingContestId, upcomingProblem, 'A');

  const beforeFreeze = toSqlUtc(new Date(now.getTime() - 15 * 60_000));
  const afterFreeze = toSqlUtc(new Date(now.getTime() - 5 * 60_000));
  const oldWrongId = addSubmission(visibleProblem, studentId, 'WA', beforeFreeze);
  const frozenAcceptedId = addSubmission(visibleProblem, studentId, 'AC', afterFreeze);

  await t.test('upcoming problems cannot be read, submitted, self-tested, or queried for stats', async () => {
    assert.equal((await api(`/problems/${upcomingProblem}`)).status, 404);
    assert.equal((await api(`/stats/problems/${upcomingProblem}`)).status, 404);
    assert.equal((await api(`/problems/${upcomingProblem}`, { token: adminToken })).status, 200);
    assert.equal((await api('/submissions', {
      token: studentToken,
      method: 'POST',
      body: { problemId: upcomingProblem, language: 'cpp', code: 'int main(){}' },
    })).status, 404);
    assert.equal((await api('/run', {
      token: studentToken,
      method: 'POST',
      body: { problemId: upcomingProblem, language: 'cpp', code: 'int main(){}', input: '' },
    })).status, 404);
    const list = await api('/problems');
    assert.equal(list.data.items.some((item: { id: number }) => item.id === upcomingProblem), false);
    const submissions = await api(`/submissions?problemId=${upcomingProblem}`);
    assert.equal(submissions.data.total, 0);
  });

  await t.test('frozen results are hidden across lists, statistics, profiles, and standings', async () => {
    assert.equal((await api(`/problems/${visibleProblem}`)).status, 200, 'a started linked contest keeps the problem visible');

    const list = await api(`/submissions?problemId=${visibleProblem}`);
    const hidden = list.data.items.find((item: { id: number }) => item.id === frozenAcceptedId);
    assert.equal(hidden.status, 'HIDDEN');
    assert.equal(hidden.pass_count, 0);
    assert.equal(list.data.items.find((item: { id: number }) => item.id === oldWrongId).status, 'WA');
    const problemList = await api('/problems');
    const visibleSummary = problemList.data.items.find((item: { id: number }) => item.id === visibleProblem);
    assert.equal(visibleSummary.submit_count, 1);
    assert.equal(visibleSummary.ac_count, 0);

    const problemStats = await api(`/stats/problems/${visibleProblem}`);
    assert.deepEqual(problemStats.data.distribution, [{ status: 'WA', c: 1 }, { status: 'HIDDEN', c: 1 }]);
    assert.equal(problemStats.data.recent[0].status, 'HIDDEN');

    const overview = await api('/stats/overview');
    assert.equal(overview.data.submissions, 1);
    assert.equal(overview.data.accepted, 0);
    const leaderboard = await api('/stats/leaderboard');
    const studentRank = leaderboard.data.items.find((item: { id: number }) => item.id === studentId);
    assert.equal(studentRank.submit_count, 1);
    assert.equal(studentRank.solved, 0);

    const profile = await api(`/stats/users/${studentId}`);
    assert.equal(profile.data.stats.acCount, 0);
    assert.equal(profile.data.distribution.find((row: { status: string }) => row.status === 'HIDDEN').c, 1);
    assert.equal(profile.data.recent.find((row: { id: number }) => row.id === frozenAcceptedId).status, 'HIDDEN');

    const standings = await api(`/contests/${freezeContestId}/standings`);
    const studentRow = standings.data.rows.find((row: { userId: number }) => row.userId === studentId);
    assert.equal(studentRow.cells[0].status, 'FROZEN');
    assert.equal(studentRow.solved, 0);

    const adminStats = await api(`/stats/problems/${visibleProblem}`, { token: adminToken });
    assert.equal(adminStats.data.distribution.find((row: { status: string }) => row.status === 'AC').c, 1);
    const adminList = await api('/problems', { token: adminToken });
    const adminSummary = adminList.data.items.find((item: { id: number }) => item.id === visibleProblem);
    assert.equal(adminSummary.submit_count, 2);
    assert.equal(adminSummary.ac_count, 1);
    const ownerStats = await api(`/stats/problems/${visibleProblem}`, { token: studentToken });
    assert.equal(ownerStats.data.distribution.find((row: { status: string }) => row.status === 'AC').c, 1);

    assert.equal((await api(`/submissions/${frozenAcceptedId}`, { token: signToken({ id: otherId, username: 'other-test', role: 'user' }) })).status, 403);
    assert.equal((await api(`/submissions/${frozenAcceptedId}/stream-ticket`, {
      method: 'POST',
      token: signToken({ id: otherId, username: 'other-test', role: 'user' }),
    })).status, 403);
    assert.equal((await api(`/submissions/${frozenAcceptedId}/stream-ticket`, { method: 'POST', token: studentToken })).status, 200);
    assert.equal((await api(`/submissions/${frozenAcceptedId}/stream-ticket`, { method: 'POST', token: adminToken })).status, 200);
  });

  await t.test('manual and automatic unfreeze restore results at the expected boundaries', async () => {
    const contest = db.prepare('SELECT * FROM contests WHERE id = ?').get(freezeContestId) as {
      start_at: string;
      end_at: string;
      frozen_minutes: number;
      unfrozen_at: string | null;
    };
    const freezeAt = freezeMoment(contest);
    const boundaryWindows = new Map([[visibleProblem, freezeAt]]);
    const { isSubmissionFrozen } = await import('../src/utils/contest');
    // 边界必须用绝对时间算：字符串截秒再拼 "01" 只在当前秒恰为 00 时才晚于封榜时刻，
    // 否则会构造出一个更早的时间，导致断言随机失败（CI 上就是这么红的）
    const freezeMs = new Date(`${freezeAt.replace(' ', 'T')}Z`).getTime();
    assert.equal(isSubmissionFrozen(boundaryWindows, visibleProblem, freezeAt), false);
    assert.equal(isSubmissionFrozen(boundaryWindows, visibleProblem, toSqlUtc(new Date(freezeMs + 1000))), true);
    assert.equal(isSubmissionFrozen(boundaryWindows, visibleProblem, toSqlUtc(new Date(freezeMs - 1000))), false);
    assert.equal(isFrozenForViewer(contest, 'user', contest.end_at), false);

    db.prepare('UPDATE contests SET unfrozen_at = ? WHERE id = ?').run(toSqlUtc(new Date()), freezeContestId);
    const stats = await api(`/stats/problems/${visibleProblem}`);
    assert.equal(stats.data.distribution.find((row: { status: string }) => row.status === 'AC').c, 1);
    assert.equal(stats.data.distribution.some((row: { status: string }) => row.status === 'HIDDEN'), false);
    assert.equal((await api(`/submissions?problemId=${visibleProblem}`)).data.items.find((item: { id: number }) => item.id === frozenAcceptedId).status, 'AC');
  });

  await t.test('worker claims are exclusive, owner-scoped, and expired attempts discard old cases', () => {
    const problemId = visibleProblem;
    const submissionId = addSubmission(problemId, studentId, 'PENDING', toSqlUtc(new Date()));
    enqueueSubmission(submissionId);
    const first = claimNext('worker-one');
    assert.ok(first);
    assert.equal(first.submissionId, submissionId);
    assert.equal(claimNext('worker-two'), null, 'a claimed task cannot be consumed twice');
    db.prepare("UPDATE submissions SET status = 'JUDGING' WHERE id = ?").run(submissionId);
    db.prepare('INSERT INTO submission_cases (submission_id, case_index, status) VALUES (?, 1, ?)').run(submissionId, 'AC');
    releaseWorkerClaims('worker-two');
    assert.equal((db.prepare('SELECT claimed_by FROM judge_queue WHERE submission_id = ?').get(submissionId) as { claimed_by: string }).claimed_by, 'worker-one');

    heartbeatClaims('worker-one');
    assert.equal(recoverExpiredQueue(), 0, 'a live lease is left alone');
    db.prepare("UPDATE judge_queue SET claimed_at = datetime('now', '-60 seconds') WHERE submission_id = ?").run(submissionId);
    assert.equal(recoverExpiredQueue(), 1);
    assert.equal((db.prepare('SELECT status FROM submissions WHERE id = ?').get(submissionId) as { status: string }).status, 'PENDING');
    assert.equal((db.prepare('SELECT COUNT(*) AS c FROM submission_cases WHERE submission_id = ?').get(submissionId) as { c: number }).c, 0);

    const second = claimNext('worker-two');
    assert.ok(second);
    assert.notEqual(second.token, first.token);
    retryClaim(submissionId, 'worker-one', first.token);
    assert.equal((db.prepare('SELECT claimed_by FROM judge_queue WHERE submission_id = ?').get(submissionId) as { claimed_by: string }).claimed_by, 'worker-two');
    releaseWorkerClaims('worker-two');

    const workerOneTask = addSubmission(problemId, studentId, 'PENDING', toSqlUtc(new Date()));
    const workerTwoTask = addSubmission(problemId, studentId, 'PENDING', toSqlUtc(new Date()));
    enqueueSubmission(workerOneTask);
    enqueueSubmission(workerTwoTask);
    const own = claimNext('owner-a');
    const foreign = claimNext('owner-b');
    assert.ok(own && foreign);
    db.prepare("UPDATE submissions SET status = 'JUDGING' WHERE id IN (?, ?)").run(own.submissionId, foreign.submissionId);
    releaseWorkerClaims('owner-a');
    assert.equal((db.prepare('SELECT status FROM submissions WHERE id = ?').get(own.submissionId) as { status: string }).status, 'PENDING');
    assert.equal((db.prepare('SELECT status FROM submissions WHERE id = ?').get(foreign.submissionId) as { status: string }).status, 'JUDGING');
    assert.equal((db.prepare('SELECT claimed_by FROM judge_queue WHERE submission_id = ?').get(foreign.submissionId) as { claimed_by: string }).claimed_by, 'owner-b');
    releaseWorkerClaims('owner-b');
    db.prepare('DELETE FROM submissions WHERE id IN (?, ?, ?)').run(submissionId, workerOneTask, workerTwoTask);

    const leaseA = acquireExecutionLease(studentId, 1);
    assert.ok(leaseA);
    assert.equal(acquireExecutionLease(otherId, 1), null, 'self-test concurrency is shared across API processes');
    releaseExecutionLease(leaseA);
    const leaseB = acquireExecutionLease(otherId, 1);
    assert.ok(leaseB);
    db.prepare('UPDATE execution_leases SET expires_at_ms = 0 WHERE id = ?').run(leaseB);
    assert.ok(acquireExecutionLease(studentId, 1), 'expired execution leases are reclaimed');

    assert.equal(consumeRateLimit('rate-test', 60_000, 1).allowed, true);
    assert.equal(consumeRateLimit('rate-test', 60_000, 1).allowed, false);
  });

  await t.test('five languages pass through the real queue and judge flow', async () => {
    const problemId = addProblem('[test] multilingual');
    db.prepare('INSERT INTO testcases (problem_id, input, expected_output, is_sample, ord) VALUES (?, ?, ?, 1, 1)')
      .run(problemId, '1 2\n', '3\n');
    const programs: Record<string, string> = {
      c: '#include <stdio.h>\nint main(){int a,b;if(scanf("%d%d",&a,&b)!=2)return 1;printf("%d\\n",a+b);}\n',
      cpp: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n',
      python: 'a,b=map(int,input().split())\nprint(a+b)\n',
      node: "const a=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(a[0]+a[1]);\n",
      java: 'import java.util.*; public class Main { public static void main(String[] x) { Scanner s=new Scanner(System.in); System.out.println(s.nextInt()+s.nextInt()); } }\n',
    };
    const ids = Object.entries(programs).map(([language, code]) => {
      const id = addSubmission(problemId, studentId, 'PENDING', toSqlUtc(new Date()), language, code);
      enqueueSubmission(id);
      return id;
    });

    const worker = startWorker({ concurrency: 2, label: 'integration' });
    try {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const statuses = ids.map((id) => (db.prepare('SELECT status FROM submissions WHERE id = ?').get(id) as { status: string }).status);
        if (statuses.every((status) => !['PENDING', 'JUDGING'].includes(status))) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      for (const id of ids) {
        const row = db.prepare('SELECT status, total_count FROM submissions WHERE id = ?').get(id) as { status: string; total_count: number };
        assert.equal(row.status, 'AC', `submission ${id}`);
        assert.equal(row.total_count, 1);
        assert.equal((db.prepare('SELECT COUNT(*) AS c FROM submission_cases WHERE submission_id = ?').get(id) as { c: number }).c, 1);
      }
    } finally {
      await worker.stop();
    }
  });

  let dockerAvailable = false;
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }

  await t.test('real Docker executor enforces stdin, runtime, output, memory, and checker limits', {
    skip: dockerAvailable ? false : 'Docker CLI or daemon is unavailable in this environment',
  }, async () => {
    const { dockerExecutor } = await import('../src/judge/docker-executor');
    const { interpretCheckerResult } = await import('../src/judge/executor');
    const sum = await dockerExecutor.build({
      code: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n',
      language: 'cpp',
      memoryLimitMb: 256,
      prefix: 'docker-sum',
      warmup: false,
    });
    assert.equal(sum.ok, true);
    try {
      const run = await dockerExecutor.run(sum.dir, 'cpp', sum.sourceFile, {
        input: '20 22\n',
        timeLimitMs: 2000,
        memoryLimitMb: 256,
      });
      assert.equal(run.status, 'OK');
      assert.equal(run.stdout.trim(), '42');
      assert.ok(run.timeMs < 1500, `runtime excludes Docker startup, got ${run.timeMs}ms`);
      assert.equal(run.memoryKb, 0, 'container peak memory is not confused with Docker CLI RSS');
    } finally {
      dockerExecutor.cleanup(sum.dir);
    }

    const endless = await dockerExecutor.build({
      code: '#include <iostream>\nint main(){volatile unsigned long long i=0;while(true)++i;}\n',
      language: 'cpp',
      memoryLimitMb: 256,
      prefix: 'docker-tle',
      warmup: false,
    });
    try {
      const run = await dockerExecutor.run(endless.dir, 'cpp', endless.sourceFile, {
        input: '',
        timeLimitMs: 200,
        memoryLimitMb: 256,
      });
      assert.equal(run.status, 'TLE');
      assert.ok(run.timeMs < 2000, `in-container time limit excludes startup, got ${run.timeMs}ms`);

      const checker = await dockerExecutor.build({
        code: '#include <iostream>\nint main(){std::cout<<"AC\\n";while(true){}}\n',
        language: 'cpp',
        memoryLimitMb: 512,
        prefix: 'docker-checker-tle',
        warmup: false,
      });
      try {
        const outcome = await dockerExecutor.runChecker({
          dir: checker.dir,
          language: 'cpp',
          sourceFile: checker.sourceFile,
          input: '',
          output: '3\n',
          answer: '3\n',
          timeLimitMs: 200,
          memoryLimitMb: 512,
        });
        assert.equal(outcome.systemError, true, 'checker AC followed by TLE is an evaluator failure');
        assert.equal(interpretCheckerResult({
          status: 'TLE', stdout: 'AC\n', stderr: '', exitCode: 124, timeMs: 200, memoryKb: 0,
        }).systemError, true);
      } finally {
        dockerExecutor.cleanup(checker.dir);
      }
    } finally {
      dockerExecutor.cleanup(endless.dir);
    }

    const output = await dockerExecutor.build({
      code: '#include <iostream>\nint main(){while(true)std::cout<<"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";}\n',
      language: 'cpp',
      memoryLimitMb: 256,
      prefix: 'docker-ole',
      warmup: false,
    });
    try {
      const run = await dockerExecutor.run(output.dir, 'cpp', output.sourceFile, {
        input: '',
        timeLimitMs: 2000,
        memoryLimitMb: 256,
        outputLimitBytes: 128,
      });
      assert.equal(run.status, 'OLE');
    } finally {
      dockerExecutor.cleanup(output.dir);
    }

    const memory = await dockerExecutor.build({
      code: '#include <cstdlib>\nint main(){char* p=(char*)std::malloc(256*1024*1024);if(!p)return 2;for(int i=0;i<256*1024*1024;i+=4096)p[i]=1;return 0;}\n',
      language: 'cpp',
      memoryLimitMb: 64,
      prefix: 'docker-mle',
      warmup: false,
    });
    try {
      const run = await dockerExecutor.run(memory.dir, 'cpp', memory.sourceFile, {
        input: '',
        timeLimitMs: 5000,
        memoryLimitMb: 64,
      });
      assert.equal(run.status, 'MLE');
    } finally {
      dockerExecutor.cleanup(memory.dir);
    }
  });
});
