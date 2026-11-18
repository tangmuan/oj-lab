/**
 * 批量重判面板截图（浅色 + 深色）。用法：node scripts/ui-rejudge.mjs
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

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#username', 'admin');
await page.fill('#password', 'admin123');
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`, { timeout: 15000 });

await page.goto(`${BASE}/admin/submissions`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '批量重判' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, 'rejudge-panel-light.png') });
console.log('  📸 rejudge-panel-light.png');

await page.evaluate(() => localStorage.setItem('oj_theme', 'dark'));
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: '批量重判' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, 'rejudge-panel-dark.png') });
console.log('  📸 rejudge-panel-dark.png');

const disabled = await page.getByRole('button', { name: '开始重判' }).isDisabled();
console.log('未勾选确认时「开始重判」禁用:', disabled ? '是' : '否');

console.log('控制台错误:', consoleErrors.length ? [...new Set(consoleErrors)] : '无');
console.log('HTTP 4xx/5xx:', httpErrors.length ? [...new Set(httpErrors)] : '无');
await browser.close();
