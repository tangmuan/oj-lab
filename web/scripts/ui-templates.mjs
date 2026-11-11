/**
 * 自定义语言模板端到端验证：
 * 模板设置 → 保存 python 模板 → 新建 python 文件自动套用 → 清理（删文件、恢复默认模板）
 * 用法：node scripts/ui-templates.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const MARK = 'CUSTOM_TEMPLATE_MARK';
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

console.log('▶ 登录 demo');
await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
await page.fill('#username', 'demo');
await page.fill('#password', 'demo123');
await page.click('button[type=submit]');
await page.waitForURL('http://localhost:5173/', { timeout: 15000 });

console.log('▶ 打开草稿箱 → 模板设置');
await page.goto('http://localhost:5173/files', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '模板设置' }).click();
const dialog = page.locator('[role=dialog]');
await dialog.waitFor({ timeout: 10000 });
await dialog.locator('select').selectOption('python');
await page.waitForTimeout(300);

const modalEditor = dialog.locator('.cm-content');
await modalEditor.click();
await page.keyboard.press('Control+A');
await page.keyboard.type(`# ${MARK}\ndef solve():\n    pass\n`);
await page.screenshot({ path: path.join(OUT, '17-template-modal.png') });
console.log('  📸 17-template-modal.png');

await dialog.getByRole('button', { name: '保存模板' }).click();
await page.waitForSelector('text=已保存，之后新建该语言文件会自动使用它', { timeout: 15000 });
console.log('  ✓ 模板已保存');

await dialog.getByRole('button', { name: '关闭' }).click();
await page.waitForTimeout(400);

console.log('▶ 新建 python 文件，检查是否自动套用自定义模板');
await page.locator('select').first().selectOption('python');
await page.getByRole('button', { name: '+ 新建文件' }).first().click();
await page.waitForTimeout(900);

const editorText = await page.locator('.cm-content').first().innerText();
console.log(`  新文件内容: ${JSON.stringify(editorText.slice(0, 60))}`);
assert(editorText.includes(MARK), '新建文件自动使用了用户自定义模板');
await page.screenshot({ path: path.join(OUT, '18-custom-template-applied.png') });
console.log('  📸 18-custom-template-applied.png');

console.log('▶ 清理：删除测试文件');
await page.getByRole('button', { name: '删除' }).click();
await page.waitForTimeout(1000);

console.log('▶ 清理：恢复系统默认模板');
await page.getByRole('button', { name: '模板设置' }).click();
await dialog.waitFor();
await dialog.locator('select').selectOption('python');
await page.waitForTimeout(300);
const resetBtn = dialog.getByRole('button', { name: '恢复系统默认' });
if (await resetBtn.count()) {
  await resetBtn.click();
  await page.waitForSelector('text=已恢复系统默认模板', { timeout: 15000 });
  console.log('  ✓ 已恢复系统默认模板');
} else {
  console.log('  （没有自定义模板可恢复）');
}
await dialog.getByRole('button', { name: '关闭' }).click();

console.log('\n▶ 控制台错误:', consoleErrors.length ? consoleErrors : '无');
await browser.close();
