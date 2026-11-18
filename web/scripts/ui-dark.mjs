/**
 * 深色模式逐页检查：每个页面浅色 / 深色各截一张，并校验深色下背景确实变了。
 * 用法：node scripts/ui-dark.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:5173';
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
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log(`  📸 ${name}.png`);
}

async function setTheme(theme) {
  await page.evaluate((v) => localStorage.setItem('oj_theme', v), theme);
  await page.reload({ waitUntil: 'networkidle' });
}

/** 校验 html.dark 生效且 body 背景是深色 */
async function assertDark(label) {
  const info = await page.evaluate(() => ({
    hasDarkClass: document.documentElement.classList.contains('dark'),
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  const isDark = info.hasDarkClass && info.bg !== 'rgb(248, 250, 252)';
  console.log(`  ${isDark ? '✓' : '✗'} ${label} 深色生效（bg=${info.bg}）`);
  if (!isDark) consoleErrors.push(`深色未生效：${label}`);
}

console.log('▶ 登录 demo');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#username', 'demo');
await page.fill('#password', 'demo123');
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`, { timeout: 15000 });

// 先取一条有「上一条」的提交详情，用于 diff 截图
await page.goto(`${BASE}/submissions`, { waitUntil: 'networkidle' });
const firstHref = await page.locator('table tbody tr').nth(0).locator('a').first().getAttribute('href');
const detailPath = firstHref ?? '/submissions';

const pages = [
  { path: '/', name: '01-problem-list' },
  { path: '/problems/5', name: '02-problem-detail' },
  { path: '/submissions', name: '03-submissions' },
  { path: detailPath, name: '04-submission-detail' },
  { path: '/leaderboard', name: '05-leaderboard' },
  { path: '/u/2', name: '06-user-profile' },
  { path: '/files', name: '07-drafts' },
  { path: '/admin', name: '08-admin' },
  { path: '/admin/problems/5/edit', name: '09-admin-edit' },
];

for (const p of pages) {
  console.log(`▶ ${p.name}`);
  await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle' });
  await setTheme('light');
  await shot(`darkcheck-${p.name}-light`);
  await setTheme('dark');
  await shot(`darkcheck-${p.name}-dark`);
  await assertDark(p.name);
}

console.log('▶ 提交对比（深色）');
await page.goto(`${BASE}${detailPath}`, { waitUntil: 'networkidle' });
const diffButton = page.getByRole('button', { name: /与上次提交对比/ });
if ((await diffButton.count()) > 0) {
  await diffButton.click();
  const diff = page.locator('[data-testid="code-diff"]');
  await diff.waitFor({ timeout: 15000 });
  await diff.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await diff.screenshot({ path: path.join(OUT, 'darkcheck-10-code-diff-dark.png') });
  console.log('  📸 darkcheck-10-code-diff-dark.png');
  const rows = await page.locator('text=/^[+−]$/').count();
  console.log(`  diff 行标记数量: ${rows}`);
} else {
  console.log('  ⚠ 当前提交没有上一条，跳过 diff 截图');
}

console.log('\n▶ 控制台错误:', consoleErrors.length ? [...new Set(consoleErrors)] : '无');
console.log('▶ HTTP 4xx/5xx:', httpErrors.length ? [...new Set(httpErrors)] : '无');
await browser.close();
