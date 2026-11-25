/**
 * 封榜语义回归脚本：建比赛 → 挂题 → 双账号提交 → 断言三个读接口的打码与恢复
 * 用法：先启动后端（npm run dev 或 npm start），再 node scripts/contest-freeze.mjs
 * 不依赖 playwright，纯 fetch；结束时会清理临时比赛与临时题目。
 */
const BASE = process.env.BASE || 'http://localhost:3001';
const ADMIN = { username: 'admin', password: 'admin123' };
const USER_A = { username: 'freeze_a', password: 'freeze123' };
const USER_B = { username: 'freeze_b', password: 'freeze123' };
const CONTEST_PREFIX = '[FREEZE-TEST]';
const PROBLEM_TITLE = `${CONTEST_PREFIX} A+B Problem`;

/** ISO 字符串去掉毫秒：zod 的 datetime 校验对精度要求更严 */
function isoAt(minuteOffset) {
  return new Date(Date.now() + minuteOffset * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

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
    return { token: r.token, id: r.user.id, role: r.user.role };
  } catch {
    const r = await api('/auth/register', { method: 'POST', body: account });
    return { token: r.token, id: r.user.id, role: r.user.role };
  }
}

async function cleanup() {
  const admin = await ensureLogin(ADMIN);
  const contests = await api('/admin/contests', { token: admin.token });
  for (const c of contests.items.filter((x) => x.title.startsWith(CONTEST_PREFIX))) {
    await api(`/admin/contests/${c.id}`, { method: 'DELETE', token: admin.token });
  }
  const problems = await api('/admin/problems', { token: admin.token });
  for (const p of problems.items.filter((x) => x.title === PROBLEM_TITLE)) {
    await api(`/admin/problems/${p.id}`, { method: 'DELETE', token: admin.token });
  }
}

async function submitAndWait(token, problemId, language, code) {
  const { id } = await api('/submissions', { method: 'POST', token, body: { problemId, language, code } });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const detail = await api(`/submissions/${id}`, { token });
    if (!['PENDING', 'JUDGING'].includes(detail.submission.status)) return { id, ...detail.submission };
    await sleep(400);
  }
  throw new Error('判题超时（90s）');
}

function findRow(items, username) {
  const row = items.find((x) => x.username === username);
  if (!row) throw new Error(`在结果里找不到用户 ${username} 的提交，实际返回 ${JSON.stringify(items)}`);
  return row;
}

function cellOf(standings, userId, problemId) {
  const row = standings.rows.find((r) => r.userId === userId);
  if (!row) throw new Error(`榜单里找不到 userId=${userId}`);
  const cell = row.cells.find((c) => c.problemId === problemId);
  if (!cell) throw new Error(`榜单里找不到 problemId=${problemId} 的格子`);
  return cell;
}

/** 个人主页的 recent 没有 username 字段（全是主页主人自己的提交），按题目 id 定位 */
function findProfileRow(items, problemId) {
  const row = items.find((x) => x.problem_id === problemId);
  if (!row) throw new Error(`在个人主页 recent 里找不到 problemId=${problemId} 的提交`);
  return row;
}

async function main() {
  console.log('▶ 清理旧测试数据…');
  await cleanup();

  console.log('▶ 准备账号 / 题目 / 比赛…');
  const admin = await ensureLogin(ADMIN);
  const a = await ensureLogin(USER_A);
  const b = await ensureLogin(USER_B);

  const problemId = await api(
    '/admin/problems',
    {
      method: 'POST',
      token: admin.token,
      body: {
        title: PROBLEM_TITLE,
        difficulty: 'easy',
        description: '输入两个整数 a 和 b，输出它们的和。',
        input_format: '一行两个整数 a b。',
        output_format: '一行一个整数，表示 a + b。',
        time_limit_ms: 1000,
        memory_limit_mb: 256,
        is_public: 1,
        testcases: [{ input: '1 2\n', expected_output: '3\n', is_sample: 1, ord: 1 }],
      },
    }
  ).then((r) => r.id);

  // 已过封榜时刻（now-10min）、尚未结束（now+20min）：此刻正处于封榜期
  const contestId = await api(
    '/admin/contests',
    {
      method: 'POST',
      token: admin.token,
      body: { title: `${CONTEST_PREFIX} 封榜回归`, start_at: isoAt(-40), end_at: isoAt(20), frozen_minutes: 30, is_public: 1 },
    }
  ).then((r) => r.id);
  await api(`/admin/contests/${contestId}/problems`, {
    method: 'PUT',
    token: admin.token,
    body: { problems: [{ problemId, label: 'A', ord: 1 }] },
  });
  await api(`/contests/${contestId}/register`, { method: 'POST', token: a.token });
  await api(`/contests/${contestId}/register`, { method: 'POST', token: b.token });

  console.log('▶ 两个账号各提交一次…');
  const ac = await submitAndWait(a.token, problemId, 'python', 'a, b = map(int, input().split())\nprint(a + b)\n');
  const wa = await submitAndWait(b.token, problemId, 'python', 'a, b = map(int, input().split())\nprint(a - b)\n');
  check('两个提交均已判完且为 AC/WA', ac.status === 'AC' && wa.status === 'WA', `实际 ${ac.status}/${wa.status}`);

  console.log('▶ 封榜期断言…');
  const listAnon = await api(`/submissions?problemId=${problemId}`);
  check('匿名在提交列表看到 A 的提交为 HIDDEN', findRow(listAnon.items, USER_A.username).status === 'HIDDEN');
  check('匿名在提交列表看到 B 的提交为 HIDDEN', findRow(listAnon.items, USER_B.username).status === 'HIDDEN');
  const hiddenRow = findRow(listAnon.items, USER_A.username);
  check('HIDDEN 行的耗时/内存/通过点已置 0', hiddenRow.time_ms === 0 && hiddenRow.memory_kb === 0 && hiddenRow.pass_count === 0);

  const listB = await api(`/submissions?problemId=${problemId}`, { token: b.token });
  check('本人（B）在提交列表看到自己的真实状态', findRow(listB.items, USER_B.username).status === 'WA');
  check('本人（B）看到他人（A）为 HIDDEN', findRow(listB.items, USER_A.username).status === 'HIDDEN');

  const listAdmin = await api(`/submissions?problemId=${problemId}`, { token: admin.token });
  check('管理员在提交列表看到真实状态', findRow(listAdmin.items, USER_A.username).status === 'AC' && findRow(listAdmin.items, USER_B.username).status === 'WA');

  const statsAnon = await api(`/stats/problems/${problemId}`);
  check('匿名在题目统计里看到 A 为 HIDDEN', findRow(statsAnon.recent, USER_A.username).status === 'HIDDEN');
  check('匿名在题目统计里看到 B 为 HIDDEN', findRow(statsAnon.recent, USER_B.username).status === 'HIDDEN');
  const statsAdmin = await api(`/stats/problems/${problemId}`, { token: admin.token });
  check('管理员在题目统计里看到真实状态', findRow(statsAdmin.recent, USER_A.username).status === 'AC' && findRow(statsAdmin.recent, USER_B.username).status === 'WA');

  const profileAnon = await api(`/stats/users/${a.id}`);
  check('匿名在他人主页看到 A 的提交为 HIDDEN', findProfileRow(profileAnon.recent, problemId).status === 'HIDDEN');
  const profileB = await api(`/stats/users/${a.id}`, { token: b.token });
  check('非本人（B）在他人主页同样看到 HIDDEN', findProfileRow(profileB.recent, problemId).status === 'HIDDEN');
  const profileAdmin = await api(`/stats/users/${a.id}`, { token: admin.token });
  check('管理员在他人主页看到真实状态', findProfileRow(profileAdmin.recent, problemId).status === 'AC');

  const standingsAnon = await api(`/contests/${contestId}/standings`);
  check('封榜期榜单 frozen=true', standingsAnon.frozen === true);
  check('封榜期榜单里 A 的格子为 FROZEN', cellOf(standingsAnon, a.id, problemId).status === 'FROZEN');
  check('封榜期榜单里 B 的格子为 FROZEN', cellOf(standingsAnon, b.id, problemId).status === 'FROZEN');
  const standingsAdmin = await api(`/contests/${contestId}/standings`, { token: admin.token });
  check('管理员榜单看到真实 AC/WA', cellOf(standingsAdmin, a.id, problemId).status === 'AC' && cellOf(standingsAdmin, b.id, problemId).status === 'WA');

  console.log('▶ 结束比赛后断言自动恢复…');
  await api(`/admin/contests/${contestId}`, { method: 'PUT', token: admin.token, body: { end_at: isoAt(-1) } });
  const listAfter = await api(`/submissions?problemId=${problemId}`);
  check('赛后提交列表恢复真实状态', findRow(listAfter.items, USER_A.username).status === 'AC' && findRow(listAfter.items, USER_B.username).status === 'WA');
  const statsAfter = await api(`/stats/problems/${problemId}`);
  check('赛后题目统计恢复真实状态', findRow(statsAfter.recent, USER_A.username).status === 'AC');
  const profileAfter = await api(`/stats/users/${a.id}`);
  check('赛后他人主页恢复真实状态', findProfileRow(profileAfter.recent, problemId).status === 'AC');

  console.log('▶ 不封榜的比赛（frozen_minutes=0）行为不变…');
  const contest2Id = await api(
    '/admin/contests',
    {
      method: 'POST',
      token: admin.token,
      body: { title: `${CONTEST_PREFIX} 不封榜`, start_at: isoAt(-10), end_at: isoAt(30), frozen_minutes: 0, is_public: 1 },
    }
  ).then((r) => r.id);
  await api(`/admin/contests/${contest2Id}/problems`, {
    method: 'PUT',
    token: admin.token,
    body: { problems: [{ problemId, label: 'A', ord: 1 }] },
  });
  const listNoFreeze = await api(`/submissions?problemId=${problemId}`);
  check('不封榜比赛进行中：提交列表状态不受影响', findRow(listNoFreeze.items, USER_A.username).status === 'AC');
  const statsNoFreeze = await api(`/stats/problems/${problemId}`);
  check('不封榜比赛进行中：题目统计状态不受影响', findRow(statsNoFreeze.recent, USER_B.username).status === 'WA');
  const profileNoFreeze = await api(`/stats/users/${a.id}`);
  check('不封榜比赛进行中：他人主页状态不受影响', findProfileRow(profileNoFreeze.recent, problemId).status === 'AC');
  const standingsNoFreeze = await api(`/contests/${contest2Id}/standings`);
  check(
    '不封榜比赛：榜单 frozen=false 且格子为真实结果',
    standingsNoFreeze.frozen === false && cellOf(standingsNoFreeze, a.id, problemId).status === 'AC' && cellOf(standingsNoFreeze, b.id, problemId).status === 'WA'
  );

  console.table(results);
  console.log('✓ 封榜语义回归全部通过');
}

main()
  .catch((e) => {
    console.error('✗ contest-freeze failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    // 无论成败都清场，避免残留 [FREEZE-TEST] 比赛和题目
    cleanup().catch((e) => console.error('清理失败（请手动删除 [FREEZE-TEST] 数据）:', e.message));
  });
