import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffLines, diffStats, foldContext } from '../src/lib/diff';

test('diffLines：内容相同全是 same，行号成对递增', () => {
  const rows = diffLines('a\nb', 'a\nb');
  assert.deepEqual(
    rows.map((r) => [r.type, r.oldLine, r.newLine, r.text]),
    [
      ['same', 1, 1, 'a'],
      ['same', 2, 2, 'b'],
    ]
  );
});

test('diffLines：改一行产生一条删除 + 一条新增', () => {
  const rows = diffLines('a\nb\nc', 'a\nB\nc');
  const changed = rows.filter((r) => r.type !== 'same');
  assert.equal(changed.length, 2);
  assert.deepEqual(
    changed.map((r) => [r.type, r.text]),
    [
      ['del', 'b'],
      ['add', 'B'],
    ]
  );
  // 收尾的 c 两侧行号都要正确
  const last = rows[rows.length - 1];
  assert.deepEqual([last.type, last.oldLine, last.newLine], ['same', 3, 3]);
});

test('diffLines：新增行只有新行号', () => {
  const rows = diffLines('a\nc', 'a\nb\nc');
  const added = rows.filter((r) => r.type === 'add');
  assert.equal(added.length, 1);
  assert.deepEqual([added[0].oldLine, added[0].newLine, added[0].text], [null, 2, 'b']);
});

test('diffLines：删除行只有旧行号', () => {
  const rows = diffLines('a\nb\nc', 'a\nc');
  const removed = rows.filter((r) => r.type === 'del');
  assert.equal(removed.length, 1);
  assert.deepEqual([removed[0].oldLine, removed[0].newLine, removed[0].text], [2, null, 'b']);
});

test('diffLines：空行也算一行', () => {
  const rows = diffLines('a\n\nb', 'a\nb');
  assert.equal(rows.length, 3);
  assert.equal(rows.some((r) => r.type === 'del' && r.text === ''), true);
});

test('diffStats：统计增删行数', () => {
  // a 与 c 是公共行，b 被删、d 被加
  const stats = diffStats(diffLines('a\nb\nc', 'a\nc\nd'));
  assert.equal(stats.added, 1);
  assert.equal(stats.removed, 1);
});

test('foldContext：长段未改动被折成一条提示', () => {
  const oldCode = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
  const newCode = `${oldCode}\nnew`;
  const blocks = foldContext(diffLines(oldCode, newCode));

  const folded = blocks.filter((b) => b.rows === null);
  assert.equal(folded.length, 1);
  // 20 行相同内容，保留首尾各 3 行，中间 14 行折叠
  assert.equal(folded[0].hiddenCount, 14);
});

test('foldContext：改动行永远保留', () => {
  const blocks = foldContext(diffLines('a\nb\nc', 'a\nB\nc'));
  const kept = blocks.flatMap((b) => b.rows ?? []);
  assert.equal(kept.some((r) => r.type === 'add' && r.text === 'B'), true);
  assert.equal(kept.some((r) => r.type === 'del' && r.text === 'b'), true);
});
