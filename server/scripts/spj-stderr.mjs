/**
 * SPJ 错因收紧回归脚本：隐藏测试点不外泄 checker stderr，样例正常展示
 * 用法：先启动后端（npm run dev 或 npm start），再 node scripts/spj-stderr.mjs
 * 覆盖验收项：隐藏点只回「评测器判为错误」（详情接口 + SSE 都看不到期望值）、
 * 样例测试点 stderr 正常展示。结束时会清理临时题目。
 */
const BASE = process.env.BASE || 'http://localhost:3001';
const ADMIN = { username: 'admin', password: 'admin123' };
const USER_A = { username: 'spj_a', password: 'spj12345' };
const USER_B = { username: 'spj_b', password: 'spj12345' };
const TITLE_PREFIX = '[SPJ-TEST]';

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, cond, extra = '') {
  results.push({ 检查项: name, 结果: cond ? 'PASS' : 'FAIL', 说明: extra });
  if (!cond) throw new Error(`断言失败：${name}${extra ? `（${extra}）` : ''}`);
}

async function ensureLogin(account) {
  try {
    const r = await api('/auth/login', { method: 'POST', body: account });
    return { token: r.token, id: r.user.id };
  } catch {
    const r = await api('/auth/register', { method: 'POST', body: account });
    return { token: r.token, id: r.user.id };
  }
}

async function cleanup() {
  const admin = await ensureLogin(ADMIN);
  const problems = await api('/admin/problems', { token: admin.token });
  for (const p of problems.items.filter((x) => x.title.startsWith(TITLE_PREFIX))) {
    await api(`/admin/problems/${p.id}`, { method: 'DELETE', token: admin.token });
  }
}

async function submitAndWait(token, problemId, language, code) {
  const { id } = await api('/submissions', { method: 'POST', token, body: { problemId, language, code } });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const detail = await api(`/submissions/${id}`, { token });
    if (!['PENDING', 'JUDGING'].includes(detail.submission.status)) return { id, ...detail.submission, cases: detail.cases };
    await sleep(400);
  }
  throw new Error('判题超时（90s）');
}

/** 换一次性票据后读完整 SSE 文本（判题已结束时服务端会主动断流） */
async function readSse(submissionId, token) {
  const { ticket } = await api(`/submissions/${submissionId}/stream-ticket`, { method: 'POST', token });
  const res = await fetch(`${BASE}/api/submissions/${submissionId}/stream?ticket=${encodeURIComponent(ticket)}`);
  return res.text();
}

/** checker：输出与答案一致时退出码 0（AC），否则把期望值打进 stderr 并以非 0 退出 */
const CHECKER_CODE = [
  "import sys",
  "inp, out_path, ans_path = sys.argv[1], sys.argv[2], sys.argv[3]",
  "out = open(out_path, encoding='utf-8').read().strip()",
  "ans = open(ans_path, encoding='utf-8').read().strip()",
  "if out == ans:",
  "    sys.exit(0)",
  "sys.stderr.write('期望 ' + ans + '\\n')",
  "sys.exit(1)",
].join('\n');

async function main() {
  console.log('▶ 清理旧测试数据…');
  await cleanup();

  console.log('▶ 准备账号与 SPJ 题目（checker 的 stderr 会打印期望值）…');
  const admin = await ensureLogin(ADMIN);
  const a = await ensureLogin(USER_A);
  const b = await ensureLogin(USER_B);

  const problemId = await api(
    '/admin/problems',
    {
      method: 'POST',
      token: admin.token,
      body: {
        title: `${TITLE_PREFIX} A+B`,
        difficulty: 'easy',
        description: '输入两个整数 a 和 b，输出它们的和。',
        input_format: '一行两个整数 a b。',
        output_format: '一行一个整数。',
        time_limit_ms: 1000,
        memory_limit_mb: 256,
        is_public: 1,
        checker_language: 'python',
        checker_code: CHECKER_CODE,
        testcases: [
          { input: '1 2\n', expected_output: '3\n', is_sample: 1, ord: 1 },
          { input: '20 22\n', expected_output: '42\n', is_sample: 0, ord: 2 },
        ],
      },
    }
  ).then((r) => r.id);

  console.log('▶ 提交 A：样例对、隐藏点错 → 隐藏点错因必须只回固定文案…');
  const subA = await submitAndWait(a.token, problemId, 'python', 'a, b = map(int, input().split())\nprint(3 if a == 1 else 0)\n');
  check('提交 A 整体为 WA（样例 AC + 隐藏点 WA）', subA.status === 'WA' && subA.pass_count === 1, `实际 ${subA.status} / ${subA.pass_count}`);

  const hiddenCase = subA.cases.find((c) => c.is_sample === 0);
  // 等值断言同时保证：没有透出 stderr、stdout、退出码等任何判定依据
  check('隐藏测试点错因严格等于「评测器判为错误」', hiddenCase?.message === '评测器判为错误', `实际「${hiddenCase?.message}」`);
  const detailText = JSON.stringify(subA);
  check('学生详情接口看不到 checker stderr（无「期望 42」）', !detailText.includes('期望 42'));

  const sseText = await readSse(subA.id, a.token);
  check('SSE 快照里同样看不到「期望 42」', !sseText.includes('期望 42'));
  check('SSE 快照里包含「评测器判为错误」', sseText.includes('评测器判为错误'));

  console.log('▶ 提交 B：样例就错 → 样例上 stderr 正常展示…');
  const subB = await submitAndWait(b.token, problemId, 'python', 'a, b = map(int, input().split())\nprint(a - b)\n');
  const sampleCase = subB.cases.find((c) => c.is_sample === 1);
  check('提交 B 整体为 WA', subB.status === 'WA');
  check('样例测试点错因包含 checker stderr（「期望 3」）', (sampleCase?.message ?? '').includes('期望 3'), `实际「${sampleCase?.message}」`);

  console.table(results);
  console.log('✓ SPJ 错因收紧回归全部通过');
}

main()
  .catch((e) => {
    console.error('✗ spj-stderr failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup().catch((e) => console.error('清理失败（请手动删除 [SPJ-TEST] 数据）:', e.message));
  });
