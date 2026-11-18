/**
 * 比赛页 UI 检查：临时建一场进行中的比赛 → 截图列表/详情（浅色+深色）→ 清理。
 * 用法：node scripts/ui-contest.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const httpErrors = [];

async function api(pathname, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
const adminToken = login.data.token;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const contest = await api('/api/admin/contests', {
  method: 'POST',
  token: adminToken,
  body: {
    title: '[UI] 阶段2 比赛演示',
    start_at: iso(now - 30 * 60_000),
    end_at: iso(now + 30 * 60_000),
    frozen_minutes: 5,
    is_public: 1,
  },
});
const cid = contest.data.id;
const problems = await api('/api/admin/problems', { token: adminToken });
// 按 id 升序取题：这些老题上有历史提交，榜单才有内容可看
const picked = problems.data.items
  .slice()
  .sort((a, b) => a.id - b.id)
  .slice(0, 3)
  .map((p) => ({ problemId: p.id }));
await api(`/api/admin/contests/${cid}/problems`, { method: 'PUT', token: adminToken, body: { problems: picked } });
console.log(`临时比赛 #${cid}，挂 ${picked.length} 题`);

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

async function setTheme(theme) {
  await page.evaluate((v) => localStorage.setItem('oj_theme', v), theme);
  await page.reload({ waitUntil: 'networkidle' });
}

console.log('▶ 登录 demo');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#username', 'demo');
await page.fill('#password', 'demo123');
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`, { timeout: 15000 });

console.log('▶ 比赛列表');
await page.goto(`${BASE}/contests`, { waitUntil: 'networkidle' });
await setTheme('light');
await shot('contest-01-list-light');
await setTheme('dark');
await shot('contest-01-list-dark');

console.log('▶ 比赛详情');
await page.goto(`${BASE}/contests/${cid}`, { waitUntil: 'networkidle' });
await setTheme('light');
// 顺手点一次报名，验证按钮状态切换
const registerBtn = page.getByRole('button', { name: /报名参赛/ });
if ((await registerBtn.count()) > 0) {
  await registerBtn.click();
  await page.waitForTimeout(600);
}
await shot('contest-02-detail-light');

const rowCount = await page.locator('table').last().locator('tbody tr').count();
const countdown = await page.locator('.font-mono.text-lg').first().innerText().catch(() => '(无)');
console.log(`  榜单行数=${rowCount} 倒计时=${countdown}`);

await setTheme('dark');
await shot('contest-02-detail-dark');

console.log('▶ 管理员比赛管理页');
// 必须先清登录态再进 /login，否则路由会直接把已登录用户弹回首页
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#username', 'admin');
await page.fill('#password', 'admin123');
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`, { timeout: 15000 });
await page.goto(`${BASE}/admin/contests`, { waitUntil: 'networkidle' });
await setTheme('light');
await shot('contest-03-admin-light');
await setTheme('dark');
await shot('contest-03-admin-dark');

console.log('\n▶ 控制台错误:', consoleErrors.length ? [...new Set(consoleErrors)] : '无');
console.log('▶ HTTP 4xx/5xx:', httpErrors.length ? [...new Set(httpErrors)] : '无');

await browser.close();

const del = await api(`/api/admin/contests/${cid}`, { method: 'DELETE', token: adminToken });
console.log(`临时比赛清理: ${del.status === 200 ? '完成' : del.status}`);
