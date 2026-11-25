/**
 * 比赛窗口可见性回归脚本：未开赛的挂题对普通用户隐藏，开赛/结束后恢复
 * 用法：先启动后端（npm run dev 或 npm start），再 node scripts/contest-visibility.mjs
 * 覆盖验收项：未开始隐藏（列表+详情 404）、管理员不受限、开赛恢复、
 * 「已结束 + 未开始并存 → 可见」边界、不涉赛题行为不变。结束时会清理临时数据。
 */
const BASE = process.env.BASE || 'http://localhost:3001';
const ADMIN = { username: 'admin', password: 'admin123' };
const USER = { username: 'vis_a', password: 'vis12345' };
const CONTEST_PREFIX = '[VIS-TEST]';
const PROBLEM_TITLE = `${CONTEST_PREFIX} 窗口可见性题目`;
const PLAIN_TITLE = `${CONTEST_PREFIX} 无比赛题目`;

/** ISO 字符串去掉毫秒：zod 的 datetime 校验对精度要求更严 */
function isoAt(minuteOffset) {
  return new Date(Date.now() + minuteOffset * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function apiRaw(path, { method = 'GET', body, token } = {}) {
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
  return { status: res.status, data };
}

async function api(path, opts = {}) {
  const { status, data } = await apiRaw(path, opts);
  if (!status || status >= 400) throw new Error(`${opts.method || 'GET'} ${path} -> ${status} ${JSON.stringify(data)}`);
  return data;
}

const results = [];
function check(name, cond, extra = '') {
  results.push({ 检查项: name, 结果: cond ? 'PASS' : 'FAIL', 说明: extra });
  if (!cond) throw new Error(`断言失败：${name}${extra ? `（${extra}）` : ''}`);
}

async function ensureLogin(account) {
  try {
    const r = await api('/auth/login', { method: 'POST', body: account });
    return { token: r.token, id: r.user.id, role: r.user.role };
  } catch {
    const r = await api('/auth/register', { method: 'POST', body: account });
    return { token: r.token, id: r.user.id, role: r.user.role };
  }
}

function makeProblemBody(title) {
  return {
    title,
    difficulty: 'easy',
    description: '比赛窗口可见性回归用题。',
    input_format: '一行两个整数 a b。',
    output_format: '一行一个整数，表示 a + b。',
    time_limit_ms: 1000,
    memory_limit_mb: 256,
    is_public: 1,
    testcases: [{ input: '1 2\n', expected_output: '3\n', is_sample: 1, ord: 1 }],
  };
}

async function cleanup() {
  const admin = await ensureLogin(ADMIN);
  const contests = await api('/admin/contests', { token: admin.token });
  for (const c of contests.items.filter((x) => x.title.startsWith(CONTEST_PREFIX))) {
    await api(`/admin/contests/${c.id}`, { method: 'DELETE', token: admin.token });
  }
  const problems = await api('/admin/problems', { token: admin.token });
  for (const p of problems.items.filter((x) => x.title.startsWith(CONTEST_PREFIX))) {
    await api(`/admin/problems/${p.id}`, { method: 'DELETE', token: admin.token });
  }
}

function listIds(items) {
  return new Set(items.map((x) => x.id));
}

async function main() {
  console.log('▶ 清理旧测试数据…');
  await cleanup();

  console.log('▶ 准备账号与题目…');
  const admin = await ensureLogin(ADMIN);
  const user = await ensureLogin(USER);

  const problemId = await api('/admin/problems', { method: 'POST', token: admin.token, body: makeProblemBody(PROBLEM_TITLE) }).then((r) => r.id);
  const plainId = await api('/admin/problems', { method: 'POST', token: admin.token, body: makeProblemBody(PLAIN_TITLE) }).then((r) => r.id);

  console.log('▶ 不涉及任何比赛时行为与旧版一致…');
  const list0 = await api('/problems', { token: user.token });
  check('无比赛题目在普通用户列表中可见', listIds(list0.items).has(plainId));
  check('挂题前普通用户也能看到该题', listIds(list0.items).has(problemId));
  const detail0 = await api(`/problems/${problemId}`, { token: user.token });
  check('挂题前普通用户可读详情', detail0.problem.id === problemId);

  console.log('▶ 挂到一场 1 小时后开始的比赛…');
  const contestId = await api(
    '/admin/contests',
    {
      method: 'POST',
      token: admin.token,
      body: { title: `${CONTEST_PREFIX} 未来赛`, start_at: isoAt(60), end_at: isoAt(120), frozen_minutes: 0, is_public: 1 },
    }
  ).then((r) => r.id);
  await api(`/admin/contests/${contestId}/problems`, {
    method: 'PUT',
    token: admin.token,
    body: { problems: [{ problemId, label: 'A', ord: 1 }] },
  });

  const list1 = await api('/problems', { token: user.token });
  check('未开赛：普通用户列表看不到该题', !listIds(list1.items).has(problemId));
  check('未开赛：列表 total 同步减少（分页计数不泄露）', list1.total === list0.total - 1, `list0=${list0.total} list1=${list1.total}`);
  const detail404 = await apiRaw(`/problems/${problemId}`, { token: user.token });
  check('未开赛：普通用户详情返回 404', detail404.status === 404);
  check('未开赛：404 文案与私有题一致（不泄露存在性）', detail404.data?.error?.message === '题目不存在');
  const listAdmin = await api('/problems', { token: admin.token });
  check('未开赛：管理员列表正常可见', listIds(listAdmin.items).has(problemId));
  const detailAdmin = await api(`/problems/${problemId}`, { token: admin.token });
  check('未开赛：管理员详情正常可读', detailAdmin.problem.id === problemId);
  const detailAnon = await apiRaw(`/problems/${problemId}`);
  check('未开赛：匿名详情同样 404', detailAnon.status === 404);

  console.log('▶ 比赛改为进行中，恢复可见…');
  await api(`/admin/contests/${contestId}`, { method: 'PUT', token: admin.token, body: { start_at: isoAt(-10) } });
  const list2 = await api('/problems', { token: user.token });
  check('开赛后：普通用户列表恢复可见', listIds(list2.items).has(problemId));
  const detail2 = await api(`/problems/${problemId}`, { token: user.token });
  check('开赛后：普通用户详情恢复可读', detail2.problem.id === problemId);

  console.log('▶ 已结束比赛 + 未开始比赛并存（取「任意一场已开赛即可见」）…');
  const endedId = await api(
    '/admin/contests',
    {
      method: 'POST',
      token: admin.token,
      body: { title: `${CONTEST_PREFIX} 已结束`, start_at: isoAt(-120), end_at: isoAt(-60), frozen_minutes: 0, is_public: 1 },
    }
  ).then((r) => r.id);
  await api(`/admin/contests/${endedId}/problems`, {
    method: 'PUT',
    token: admin.token,
    body: { problems: [{ problemId, label: 'A', ord: 1 }] },
  });
  // 把未来赛改回未开始，构造「已结束 + 未开始」并存的场景
  await api(`/admin/contests/${contestId}`, { method: 'PUT', token: admin.token, body: { start_at: isoAt(60) } });
  const list3 = await api('/problems', { token: user.token });
  check('已结束+未开始并存：普通用户仍可见', listIds(list3.items).has(problemId));
  const detail3 = await api(`/problems/${problemId}`, { token: user.token });
  check('已结束+未开始并存：详情仍可读', detail3.problem.id === problemId);

  console.table(results);
  console.log('✓ 比赛窗口可见性回归全部通过');
}

main()
  .catch((e) => {
    console.error('✗ contest-visibility failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup().catch((e) => console.error('清理失败（请手动删除 [VIS-TEST] 数据）:', e.message));
  });
