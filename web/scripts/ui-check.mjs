/**
 * UI 冒烟：用本机 Edge 打开页面、截图，并走一遍登录 → 提交 → 判题结果流程
 * 用法：node scripts/ui-check.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const httpErrors = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });

page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text().slice(0, 300));
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('response', (res) => {
  if (res.status() >= 400) httpErrors.push(`${res.status()} ${res.url()}`);
});

async function shot(name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log(`  📸 ${name}.png`);
}

console.log('▶ 首屏（未登录题目列表）');
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await shot('01-problem-list');

console.log('▶ 登录页');
await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await shot('02-login');

console.log('▶ 用 admin 登录');
await page.fill('#username', 'admin');
await page.fill('#password', 'admin123');
await page.click('button[type=submit]');
await page.waitForURL('http://localhost:5173/', { timeout: 15000 });
await page.waitForTimeout(900);
await shot('03-list-logged-in');

console.log('▶ 打开第一道题');
const firstRow = page.locator('table tbody tr').first();
const problemHref = await firstRow.locator('a').first().getAttribute('href');
await page.goto(`http://localhost:5173${problemHref}`, { waitUntil: 'networkidle' });
await shot('04-problem-detail');

console.log('▶ 在编辑器里写 C++ 并提交');
await page.click('.cm-content');
await page.keyboard.press('Control+A');
await page.keyboard.type('#include <bits/stdc++.h>\nusing namespace std;\nint main(){ long long a,b; cin>>a>>b; cout<<a+b<<"\\n"; }');
await shot('05-code-written');

console.log('▶ 自测运行（样例输入 → 查看输出）');
const inputBox = page.locator('textarea').first();
await inputBox.fill('7 35\n');
await page.getByRole('button', { name: '▶ 运行' }).click();
await page.waitForSelector('text=运行完成', { timeout: 60000 });
await page.waitForTimeout(500);
const runOutput = await page.getByTestId('self-output').innerText();
console.log(`  自测输出: ${JSON.stringify(runOutput)}`);
if (!runOutput.includes('42')) console.error('  ✗ 自测输出不是预期的 42');
await shot('06-self-test');

console.log('▶ 提交判题');
await page.getByRole('button', { name: /提交代码/ }).click();

// 等结果面板出现「通过」，并等所有测试点卡片渲染完
await page.waitForSelector('text=通过', { timeout: 60000 });
await page.waitForFunction(() => !document.body.innerText.includes('判题中'), { timeout: 60000 });
await page.waitForTimeout(800);
await shot('07-judge-result');

const caseCards = await page.locator('text=/测试点 \\d+/').count();
const panel = await page.locator('div.card').filter({ hasText: '通过' }).last().innerText();
console.log(`  测试点卡片数量: ${caseCards}`);
console.log(`  结果面板: ${panel.replace(/\n+/g, ' | ').slice(0, 180)}`);

if (caseCards < 3) console.error('  ✗ 测试点卡片数量异常');

console.log('▶ 提交记录页');
await page.goto('http://localhost:5173/submissions', { waitUntil: 'networkidle' });
await shot('08-submissions');

console.log('▶ 排行榜');
await page.goto('http://localhost:5173/leaderboard', { waitUntil: 'networkidle' });
await shot('09-leaderboard');

console.log('▶ 管理端');
await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle' });
await shot('10-admin');
const editHref = await page.locator('table tbody tr').first().locator('a', { hasText: '编辑' }).getAttribute('href');
await page.goto(`http://localhost:5173${editHref}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot('11-admin-edit');

console.log('\n▶ 控制台错误:', consoleErrors.length ? consoleErrors : '无');
console.log('▶ HTTP 4xx/5xx:', httpErrors.length ? [...new Set(httpErrors)] : '无');
await browser.close();
