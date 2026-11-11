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

export function truncate(s: string, max = 400): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…（共 ${s.length} 字符）`;
}
