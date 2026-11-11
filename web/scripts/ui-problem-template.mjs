/**
 * 题目页模板验证：用户自定义模板应作用于题目页；自己写过的代码仍然优先保留
 * 用法：node scripts/ui-problem-template.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const MARK = 'CUSTOM_CPP_TEMPLATE_MARK';
const consoleErrors = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on('dialog', (d) => d.accept());
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
  }
}

const BASE = 'http://localhost:5173';

console.log('▶ 登录 demo');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#username', 'demo');
await page.fill('#password', 'demo123');
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`, { timeout: 15000 });

// 拿 token，直接改模板 + 清理题目页缓存
const token = await page.evaluate(() => localStorage.getItem('oj_token'));
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const problems = await (await fetch('http://localhost:3001/api/problems')).json();
const pid = problems.items[0].id;
console.log(`  目标题目: #${pid} ${problems.items[0].title}`);

await fetch('http://localhost:3001/api/templates/cpp', {
  method: 'PUT',
  headers,
  body: JSON.stringify({ content: `// ${MARK}\n#include <bits/stdc++.h>\nint main() {\n    return 0;\n}\n` }),
});
await page.evaluate(() => {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('oj_code_'))
    .forEach((k) => localStorage.removeItem(k));
});

console.log('▶ 打开题目页，检查是否使用自定义模板');
await page.goto(`${BASE}/problems/${pid}`, { waitUntil: 'networkidle' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await page.waitForTimeout(1200);
const tplText = await page.locator('.cm-content').first().innerText();
console.log(`  编辑器首行: ${JSON.stringify(tplText.split('\n')[0])}`);
assert(tplText.includes(MARK), '题目页使用了用户自定义模板');
await page.screenshot({ path: path.join(OUT, '19-problem-custom-template.png') });
console.log('  📸 19-problem-custom-template.png');

console.log('▶ 自己改写代码后刷新，应保留自己的代码');
await page.click('.cm-content');
await page.keyboard.press('Control+A');
await page.keyboard.type('int main(){ /* MY_OWN_CODE */ return 0; }');
await page.waitForTimeout(900);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await page.waitForTimeout(1200);
const afterReload = await page.locator('.cm-content').first().innerText();
assert(afterReload.includes('MY_OWN_CODE'), '改过的代码在刷新后仍保留（未被模板覆盖）');

console.log('▶ 清理：恢复内置模板 + 清空缓存');
await fetch('http://localhost:3001/api/templates/cpp', { method: 'DELETE', headers });
await page.evaluate(() => {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('oj_code_'))
    .forEach((k) => localStorage.removeItem(k));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await page.waitForTimeout(1200);
const builtin = await page.locator('.cm-content').first().innerText();
assert(builtin.includes('#include <bits/stdc++.h>') && !builtin.includes(MARK), '恢复后回到内置模板');

console.log('\n▶ 控制台错误:', consoleErrors.length ? consoleErrors : '无');
await browser.close();
