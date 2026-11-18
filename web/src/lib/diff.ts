export type DiffType = 'same' | 'add' | 'del';

export interface DiffRow {
  type: DiffType;
  /** 该行在旧代码里的行号，新增行为 null */
  oldLine: number | null;
  /** 该行在新代码里的行号，删除行为 null */
  newLine: number | null;
  text: string;
}

/**
 * 超过这个行数就不做 LCS：64KB 代码约 2000 行，DP 表会吃掉几十 MB 临时内存，
 * 而大文件本来也没人逐行看。降级成「整段删除 + 整段新增」，语义仍然正确。
 */
const MAX_DIFF_LINES = 1500;

function wholeReplace(oldCode: string, newCode: string): DiffRow[] {
  const rows: DiffRow[] = [];
  oldCode.split('\n').forEach((text, i) => rows.push({ type: 'del', oldLine: i + 1, newLine: null, text }));
  newCode.split('\n').forEach((text, i) => rows.push({ type: 'add', oldLine: null, newLine: i + 1, text }));
  return rows;
}

/**
 * 逐行 LCS diff。返回统一视图的行序列：same 两侧行号都有，add 只有新行号，del 只有旧行号。
 */
export function diffLines(oldCode: string, newCode: string): DiffRow[] {
  const a = oldCode.split('\n');
  const b = newCode.split('\n');
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return wholeReplace(oldCode, newCode);

  const n = a.length;
  const m = b.length;
  const width = m + 1;
  // 用 Int32Array 而不是二维数组：同样的表内存占用只有 1/2～1/4
  const dp = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', oldLine, newLine, text: a[i] });
      i += 1;
      j += 1;
      oldLine += 1;
      newLine += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      rows.push({ type: 'del', oldLine, newLine: null, text: a[i] });
      i += 1;
      oldLine += 1;
    } else {
      rows.push({ type: 'add', oldLine: null, newLine, text: b[j] });
      j += 1;
      newLine += 1;
    }
  }
  while (i < n) {
    rows.push({ type: 'del', oldLine, newLine: null, text: a[i] });
    i += 1;
    oldLine += 1;
  }
  while (j < m) {
    rows.push({ type: 'add', oldLine: null, newLine, text: b[j] });
    j += 1;
    newLine += 1;
  }

  return rows;
}

export function diffStats(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.type === 'add') added += 1;
    else if (r.type === 'del') removed += 1;
  }
  return { added, removed };
}

export interface DiffBlock {
  /** null 表示这是被折叠的未改动行 */
  rows: DiffRow[] | null;
  hiddenCount: number;
}

/**
 * 把连续相同的行折叠起来：代码 diff 里大段未改动内容只会稀释视线，
 * 保留上下文 3 行、其余折成一条提示。
 */
export function foldContext(rows: DiffRow[], context = 3): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let i = 0;

  while (i < rows.length) {
    if (rows[i].type !== 'same') {
      const start = i;
      while (i < rows.length && rows[i].type !== 'same') i += 1;
      blocks.push({ rows: rows.slice(start, i), hiddenCount: 0 });
      continue;
    }
    const start = i;
    while (i < rows.length && rows[i].type === 'same') i += 1;
    const run = rows.slice(start, i);

    if (run.length <= context * 2 + 1) {
      blocks.push({ rows: run, hiddenCount: 0 });
      continue;
    }
    blocks.push({ rows: run.slice(0, context), hiddenCount: 0 });
    blocks.push({ rows: null, hiddenCount: run.length - context * 2 });
    blocks.push({ rows: run.slice(run.length - context), hiddenCount: 0 });
  }

  return blocks;
}
