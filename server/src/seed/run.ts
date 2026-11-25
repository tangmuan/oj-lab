import bcrypt from 'bcryptjs';
import { config } from '../config';
import { db, initDb, tx } from '../db';

interface SeedCase {
  input: string;
  expected_output: string;
  is_sample?: boolean;
}

interface SeedProblem {
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  input_format: string;
  output_format: string;
  hint?: string;
  time_limit_ms?: number;
  memory_limit_mb?: number;
  /** 仅在该题还没有任何标签时写入，避免覆盖后台的人工编辑 */
  tags: string[];
  cases: SeedCase[];
}

const PROBLEMS: SeedProblem[] = [
  {
    title: 'A+B Problem',
    difficulty: 'easy',
    description:
      '输入两个整数 `a` 和 `b`，输出它们的和。\n\n这是最经典的入门题，用来确认你的本地环境、输入输出方式是否正确。',
    input_format: '一行两个整数 `a b`，用空格分隔，满足 `-10^9 ≤ a, b ≤ 10^9`。',
    output_format: '一行一个整数，表示 `a + b`。',
    hint: '注意数据范围：两个 10^9 相加会超过 32 位有符号整数上限，C/C++ 请使用 `long long`。',
    tags: ['入门', '数学'],
    cases: [
      { input: '1 2\n', expected_output: '3\n', is_sample: true },
      { input: '100 -50\n', expected_output: '50\n', is_sample: true },
      { input: '1000000000 1000000000\n', expected_output: '2000000000\n' },
      { input: '-1000000000 -1000000000\n', expected_output: '-2000000000\n' },
      { input: '0 0\n', expected_output: '0\n' },
    ],
  },
  {
    title: '序列求和',
    difficulty: 'easy',
    description:
      '给定一个长度为 `n` 的整数序列，求所有元素之和。\n\n本题主要练习「先读个数、再循环读入」的输入模式。',
    input_format: '第一行一个整数 `n`（`1 ≤ n ≤ 100000`）。\n\n第二行 `n` 个整数 `a_i`（`-10^9 ≤ a_i ≤ 10^9`）。',
    output_format: '一行一个整数，表示序列元素之和。',
    tags: ['数组', '入门'],
    cases: [
      { input: '5\n1 2 3 4 5\n', expected_output: '15\n', is_sample: true },
      { input: '3\n-1 -1 -1\n', expected_output: '-3\n', is_sample: true },
      { input: '1\n1000000000\n', expected_output: '1000000000\n' },
      { input: '4\n1000000000 1000000000 1000000000 1000000000\n', expected_output: '4000000000\n' },
    ],
  },
  {
    title: '斐波那契数列',
    difficulty: 'easy',
    description:
      '斐波那契数列定义为：\n\n- `F(1) = 1`\n- `F(2) = 1`\n- `F(n) = F(n-1) + F(n-2)`（`n > 2`）\n\n给定 `n`，输出 `F(n)`。',
    input_format: '一行一个整数 `n`（`1 ≤ n ≤ 90`）。',
    output_format: '一行一个整数，表示 `F(n)`。',
    hint: '`F(90)` 已经超过 32 位整数范围，需要用 `long long` / `long`。',
    tags: ['动态规划', '数学'],
    cases: [
      { input: '1\n', expected_output: '1\n', is_sample: true },
      { input: '10\n', expected_output: '55\n', is_sample: true },
      { input: '2\n', expected_output: '1\n' },
      { input: '50\n', expected_output: '12586269025\n' },
      { input: '90\n', expected_output: '2880067194370816120\n' },
    ],
  },
  {
    title: '数组排序',
    difficulty: 'medium',
    description:
      '给定 `n` 个整数，请将它们**从小到大**排序后输出。\n\n本题用于对比不同语言内置排序的使用方式与性能差异。',
    input_format: '第一行一个整数 `n`（`1 ≤ n ≤ 200000`）。\n\n第二行 `n` 个整数 `a_i`（`-10^9 ≤ a_i ≤ 10^9`）。',
    output_format: '一行 `n` 个整数，为升序排列的结果，相邻数字之间用一个空格分隔。',
    hint: '输出末尾多一个空格通常不影响判定，但建议按格式输出。',
    tags: ['排序', '数组'],
    time_limit_ms: 2000,
    cases: [
      { input: '5\n3 1 4 1 5\n', expected_output: '1 1 3 4 5\n', is_sample: true },
      { input: '3\n-5 0 5\n', expected_output: '-5 0 5\n', is_sample: true },
      { input: '1\n42\n', expected_output: '42\n' },
      { input: '6\n10 9 8 7 6 5\n', expected_output: '5 6 7 8 9 10\n' },
      { input: '4\n1 1 1 1\n', expected_output: '1 1 1 1\n' },
    ],
  },
  {
    title: '最大子段和',
    difficulty: 'hard',
    description:
      '给定一个长度为 `n` 的整数序列，找到一个**连续子段**，使其元素之和最大，输出这个最大和。\n\n子段不能为空，即至少包含一个元素。',
    input_format: '第一行一个整数 `n`（`1 ≤ n ≤ 200000`）。\n\n第二行 `n` 个整数 `a_i`（`-10^9 ≤ a_i ≤ 10^9`）。',
    output_format: '一行一个整数，表示最大子段和。',
    hint: '经典 Kadane 算法：维护「以当前位置结尾的最大和」，整体 `O(n)`。全部为负数时答案是最大的那个负数。',
    tags: ['动态规划', '数组'],
    time_limit_ms: 1000,
    cases: [
      { input: '9\n-2 1 -3 4 -1 2 1 -5 4\n', expected_output: '6\n', is_sample: true },
      { input: '3\n-1 -2 -3\n', expected_output: '-1\n', is_sample: true },
      { input: '1\n-1000000000\n', expected_output: '-1000000000\n' },
      { input: '5\n1 2 3 4 5\n', expected_output: '15\n' },
      { input: '6\n4 -1 2 1 -5 4\n', expected_output: '6\n' },
    ],
  },
];

function main() {
  if (config.isProd) {
    throw new Error('The demo seed is development-only. Use npm run admin:create to initialize an administrator.');
  }
  initDb();

  const removedSmoke = db.prepare("DELETE FROM problems WHERE title LIKE '[SMOKE]%'").run().changes;

  const result = tx(() => {
    let created = 0;
    let updated = 0;
    const insertProblem = db.prepare(
      `INSERT INTO problems (title, difficulty, description, input_format, output_format, hint, time_limit_ms, memory_limit_mb, is_public)
       VALUES (?,?,?,?,?,?,?,?,1)`
    );
    const insertCase = db.prepare(
      'INSERT INTO testcases (problem_id, input, expected_output, is_sample, ord) VALUES (?,?,?,?,?)'
    );

    const upsertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
    const countProblemTags = db.prepare('SELECT COUNT(*) AS c FROM problem_tags WHERE problem_id = ?');
    const clearProblemTags = db.prepare('DELETE FROM problem_tags WHERE problem_id = ?');
    const linkTag = db.prepare('INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)');

    /** 只在题目还没有标签时写入种子标签：管理员手工配过的标签优先 */
    const seedTagsIfEmpty = (problemId: number, names: string[]): void => {
      const count = (countProblemTags.get(problemId) as { c: number }).c;
      if (count > 0 || names.length === 0) return;
      clearProblemTags.run(problemId);
      for (const name of names) {
        upsertTag.run(name);
        const row = findTag.get(name) as { id: number } | undefined;
        if (row) linkTag.run(problemId, row.id);
      }
    };

    for (const p of PROBLEMS) {
      const exists = db.prepare('SELECT id FROM problems WHERE title = ?').get(p.title) as { id: number } | undefined;
      if (exists) {
        // 已存在则刷新题面文本（测试点保持不动，避免覆盖后台手工编辑）
        db.prepare(
          `UPDATE problems SET difficulty = ?, description = ?, input_format = ?, output_format = ?, hint = ?,
                  time_limit_ms = ?, memory_limit_mb = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(
          p.difficulty,
          p.description,
          p.input_format,
          p.output_format,
          p.hint ?? '',
          p.time_limit_ms ?? 1000,
          p.memory_limit_mb ?? 256,
          exists.id
        );
        seedTagsIfEmpty(exists.id, p.tags);
        updated += 1;
        continue;
      }
      const info = insertProblem.run(
        p.title,
        p.difficulty,
        p.description,
        p.input_format,
        p.output_format,
        p.hint ?? '',
        p.time_limit_ms ?? 1000,
        p.memory_limit_mb ?? 256
      );
      const pid = Number(info.lastInsertRowid);
      p.cases.forEach((c, i) => insertCase.run(pid, c.input.replace(/\\n/g, '\n'), c.expected_output.replace(/\\n/g, '\n'), c.is_sample ? 1 : 0, i + 1));
      seedTagsIfEmpty(pid, p.tags);
      created += 1;
    }

    // 账号必须显式建出来：注册接口的「首个用户成为管理员」只在空库生效，
    // 先 seed 会让 demo 占住首位，全新部署就再也没有管理员入口。
    const seedAccounts: Array<{ username: string; password: string; role: 'user' | 'admin' }> = [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'demo', password: 'demo123', role: 'user' },
    ];
    const accountResults: Array<{ username: string; role: string; created: boolean }> = [];
    for (const account of seedAccounts) {
      const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(account.username);
      if (!exists) {
        db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)').run(
          account.username,
          bcrypt.hashSync(account.password, 10),
          account.role
        );
      }
      accountResults.push({ username: account.username, role: account.role, created: !exists });
    }

    // 已有部署可能只有 demo：上面的循环只会「不存在才创建」，救不了「admin 用户名被普通账号占用」的库，
    // 这里把该账号提权，保证升级后一定有管理员入口；已是管理员则无操作（幂等）
    const adminRow = db.prepare("SELECT id, role FROM users WHERE username = 'admin'").get() as
      | { id: number; role: string }
      | undefined;
    const promoted = !!adminRow && adminRow.role !== 'admin';
    if (promoted) {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(adminRow!.id);
    }
    const adminCount = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number }).c;

    return { created, updated, accountResults, adminCount, promoted };
  });

  console.log(`[seed] 清理冒烟题目：${removedSmoke} 条`);
  console.log(`[seed] 新增题目：${result.created} 道，刷新题面：${result.updated} 道`);
  for (const a of result.accountResults) {
    console.log(`[seed] 账号 ${a.username}（${a.role}）：${a.created ? '已创建' : '已存在，未改动'}`);
  }
  if (result.promoted) console.log('[seed] 已将 admin 提升为管理员');
  console.log(`[seed] 管理员账号总数：${result.adminCount}`);
  const count = (db.prepare('SELECT COUNT(*) AS c FROM problems').get() as { c: number }).c;
  console.log(`[seed] 当前题库总量：${count} 道`);
}

main();
