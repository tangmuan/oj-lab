/**
 * 输出比对：忽略行尾空白、行尾空行、CRLF 差异，其余逐字符严格比对。
 */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

export function isSameOutput(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

/** 首个差异位置，行列均从 1 开始，和编辑器里的行号列号一致 */
export interface FirstDiff {
  line: number;
  column: number;
  /** 缺失的一侧为 null（例如学生少输出了几行） */
  actualLine: string | null;
  expectedLine: string | null;
}

/**
 * 定位第一处不同：先按 normalizeOutput 的规则归一化，再逐行逐字符比较。
 * 列号按「可见字符」计（用 Array.from 而非 UTF-16 下标），中文/emoji 不会偏一列。
 */
export function firstDiff(actual: string, expected: string): FirstDiff | null {
  const aLines = normalizeOutput(actual).split('\n');
  const eLines = normalizeOutput(expected).split('\n');

  for (let i = 0; i < Math.max(aLines.length, eLines.length); i += 1) {
    const aLine = i < aLines.length ? aLines[i] : null;
    const eLine = i < eLines.length ? eLines[i] : null;
    if (aLine === eLine) continue;

    // 一侧已经没有这一行，差异从行首开始
    if (aLine === null || eLine === null) {
      return { line: i + 1, column: 1, actualLine: aLine, expectedLine: eLine };
    }

    const aChars = Array.from(aLine);
    const eChars = Array.from(eLine);
    let col = 0;
    while (col < aChars.length && col < eChars.length && aChars[col] === eChars[col]) col += 1;
    return { line: i + 1, column: col + 1, actualLine: aLine, expectedLine: eLine };
  }

  return null;
}

export function truncate(s: string, max = 400): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…（共 ${s.length} 字符）`;
}
