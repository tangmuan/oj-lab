/**
 * 端到端冒烟测试：建题 → 四语言提交 → 轮询判题结果
 * 用法：node scripts/smoke.mjs
 */
const BASE = process.env.BASE || 'http://localhost:3001';
const ADMIN = { username: 'admin', password: 'admin123' };
const TITLE_PREFIX = '[SMOKE]';

let token = '';

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
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

async function ensureLogin() {
  try {
    const r = await api('/auth/login', { method: 'POST', body: ADMIN, auth: false });
    token = r.token;
  } catch {
    const r = await api('/auth/register', { method: 'POST', body: ADMIN, auth: false });
    token = r.token;
  }
  return token;
}

async function cleanup() {
  const { items } = await api('/admin/problems');
  for (const p of items.filter((x) => x.title.startsWith(TITLE_PREFIX))) {
    await api(`/admin/problems/${p.id}`, { method: 'DELETE' });
  }
}

async function createProblem() {
  const { id } = await api('/admin/problems', {
    method: 'POST',
    body: {
      title: `${TITLE_PREFIX} A+B Problem`,
      difficulty: 'easy',
      description: '输入两个整数 a 和 b，输出它们的和。',
      input_format: '一行两个整数 a b（-1e9 ≤ a,b ≤ 1e9）。',
      output_format: '一行一个整数，表示 a + b。',
      time_limit_ms: 1000,
      memory_limit_mb: 256,
      is_public: 1,
      testcases: [
        { input: '1 2\n', expected_output: '3\n', is_sample: 1, ord: 1 },
        { input: '100 -50\n', expected_output: '50\n', is_sample: 1, ord: 2 },
        { input: '1000000000 1000000000\n', expected_output: '2000000000\n', is_sample: 0, ord: 3 },
      ],
    },
  });
  return id;
}

const CODES = {
  python_ac: {
    language: 'python',
    expect: 'AC',
    code: 'a, b = map(int, input().split())\nprint(a + b)\n',
  },
  python_wa: {
    language: 'python',
    expect: 'WA',
    code: 'a, b = map(int, input().split())\nprint(a - b)\n',
  },
  cpp_ac: {
    language: 'cpp',
    expect: 'AC',
    code: '#include <bits/stdc++.h>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n',
  },
  c_ac: {
    language: 'c',
    expect: 'AC',
    code: '#include <stdio.h>\nint main(){long long a,b;if(scanf("%lld %lld",&a,&b)!=2)return 0;printf("%lld\\n",a+b);return 0;}\n',
  },
  java_ac: {
    language: 'java',
    expect: 'AC',
    code: 'import java.util.*;\npublic class Main{public static void main(String[] args){Scanner sc=new Scanner(System.in);long a=sc.nextLong(),b=sc.nextLong();System.out.println(a+b);}}\n',
  },
  node_ac: {
    language: 'node',
    expect: 'AC',
    code: "const d=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(d[0]+d[1]);\n",
  },
  c_tle: {
    language: 'c',
    expect: 'TLE',
    code: '#include <stdio.h>\nint main(){volatile long long i=0;while(1){i++;}return 0;}\n',
  },
  cpp_ce: {
    language: 'cpp',
    expect: 'CE',
    code: 'int main(){ this is not valid cpp }\n',
  },
  python_re: {
    language: 'python',
    expect: 'RE',
    code: 'raise ValueError("boom")\n',
  },
};

async function submitAndWait(problemId, key, def) {
  const { id } = await api('/submissions', {
    method: 'POST',
    body: { problemId, language: def.language, code: def.code },
  });

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const detail = await api(`/submissions/${id}`);
    const s = detail.submission;
    if (!['PENDING', 'JUDGING'].includes(s.status)) {
      return { key, id, ...s, cases: detail.cases };
    }
    await sleep(400);
  }
  throw new Error(`${key} 判题超时（90s）`);
}

async function main() {
  console.log('▶ 登录管理员…');
  await ensureLogin();
  console.log('   OK');

  console.log('▶ 清理旧冒烟题目…');
  await cleanup();

  console.log('▶ 创建题目 + 测试点…');
  const problemId = await createProblem();
  console.log(`   problemId = ${problemId}`);

  console.log('▶ 逐语言提交判题：');
  const rows = [];
  for (const [key, def] of Object.entries(CODES)) {
    await sleep(1200); // 避开提交冷却
    const r = await submitAndWait(problemId, key, def);
    const passed = r.status === def.expect;
    rows.push({ 用例: key, 语言: r.language, 期望: def.expect, 实际: r.status, 耗时: `${r.time_ms}ms`, 内存: `${r.memory_kb}KB`, 结果: passed ? 'PASS' : 'FAIL' });
  }

  console.table(rows);
  const failed = rows.filter((r) => r.结果 === 'FAIL');

  // 顺带看一下统计接口
  const lb = await api('/stats/leaderboard');
  const overview = await api('/stats/overview');
  console.log('▶ overview:', overview);
  console.log('▶ leaderboard top3:', lb.items.slice(0, 3));

  if (failed.length) {
    console.error(`\n✗ ${failed.length} 项不符合预期`);
    process.exit(1);
  }
  console.log('\n✓ 全部判题结果符合预期');
}

main().catch((e) => {
  console.error('✗ smoke failed:', e.message);
  process.exit(1);
});
