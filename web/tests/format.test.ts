import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDateTime, formatMemory, formatTimeLimit } from '../src/lib/format';

test('formatDateTime：空值显示占位符', () => {
  assert.equal(formatDateTime(null), '—');
  assert.equal(formatDateTime(undefined), '—');
  assert.equal(formatDateTime(''), '—');
});

test('formatDateTime：非法时间原样返回', () => {
  assert.equal(formatDateTime('not-a-time'), 'not-a-time');
});

test('formatDateTime：SQLite 的 UTC 字符串按本地时间展示', () => {
  const text = formatDateTime('2024-01-02 03:04:05');
  assert.equal(text.includes('2024'), true);
  assert.equal(text.includes('—'), false);
});

test('formatMemory：0 与负数显示占位符', () => {
  assert.equal(formatMemory(0), '—');
  assert.equal(formatMemory(-1), '—');
});

test('formatMemory：KB 换算成 MB 保留一位小数', () => {
  assert.equal(formatMemory(1024), '1.0 MB');
  assert.equal(formatMemory(1536), '1.5 MB');
});

test('formatTimeLimit：整秒用 s，否则用 ms', () => {
  assert.equal(formatTimeLimit(1000), '1 s');
  assert.equal(formatTimeLimit(2000), '2 s');
  assert.equal(formatTimeLimit(1500), '1500 ms');
});
