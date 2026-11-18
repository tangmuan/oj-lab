import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSameOutput, normalizeOutput, truncate } from '../src/judge/comparator';

test('normalizeOutput：CRLF / 单独 CR 统一成 LF', () => {
  assert.equal(normalizeOutput('1\r\n2\r3'), '1\n2\n3');
});

test('normalizeOutput：去掉行尾空格与制表符', () => {
  assert.equal(normalizeOutput('1  \n2\t\n'), '1\n2');
});

test('normalizeOutput：去掉末尾连续空行', () => {
  assert.equal(normalizeOutput('42\n\n\n'), '42');
});

test('normalizeOutput：保留行内空白与中间空行', () => {
  assert.equal(normalizeOutput('a   b\n\nc\n'), 'a   b\n\nc');
});

test('normalizeOutput：全空白输入归一为空串', () => {
  assert.equal(normalizeOutput('  \n\t\n'), '');
});

test('isSameOutput：行尾差异不判错', () => {
  assert.equal(isSameOutput('3\r\n', '3\n\n'), true);
});

test('isSameOutput：大小写与多余空格仍判错', () => {
  assert.equal(isSameOutput('Yes\n', 'yes\n'), false);
  assert.equal(isSameOutput('1  2\n', '1 2\n'), false);
});

test('isSameOutput：空输出与空答案一致', () => {
  assert.equal(isSameOutput('', '\n\n'), true);
});

test('truncate：短文本原样返回', () => {
  assert.equal(truncate('abc', 10), 'abc');
});

test('truncate：超长时截断并标注总长度', () => {
  const s = 'x'.repeat(12);
  assert.equal(truncate(s, 5), 'xxxxx…（共 12 字符）');
});
