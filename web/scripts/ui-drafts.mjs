/**
 * 草稿箱端到端验证：新建 → 编辑自动保存 → 刷新恢复 → 立即刷新（本地镜像兜底）→ 运行 → 删除
 * 用法：node scripts/ui-drafts.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const TITLE = 'E2E 草稿测试';
const MARK = 'E2E_MARK';
const KEEP = 'KEEPALIVE_AFTER_RELOAD';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on('dialog', (d) => d.accept());
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

async function shot(name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  📸 ${name}.png`);
}

async function typeCode(text) {
  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
}

async function bodyText() {
  return page.locator('body').innerText();
}

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

console.log('▶ 打开草稿箱并新建 python 文件');
await page.goto('http://localhost:5173/files', { waitUntil: 'networkidle' });
await page.locator('select').first().selectOption('python');
await page.getByRole('button', { name: '+ 新建文件' }).first().click();
await page.waitForSelector('.cm-content', { timeout: 15000 });
await page.waitForTimeout(600);

await page.fill('input[placeholder="文件名"]', TITLE);
await typeCode(`print(6 * 7)  # ${MARK}`);
await page.waitForSelector('text=已保存', { timeout: 15000 });
await shot('12-draft-editor');
console.log('  ✓ 自动保存状态出现');

console.log('▶ 刷新页面，验证状态恢复');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const afterReload = await bodyText();
assert(afterReload.includes(MARK), '刷新后代码内容仍在');
assert(afterReload.includes(TITLE), '刷新后文件名仍在');

console.log('▶ 再改一次后「立刻」刷新（验证本地镜像兜底）');
await typeCode(`print(6 * 7)  # ${MARK}\nprint("${KEEP}")`);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const afterHardReload = await bodyText();
assert(afterHardReload.includes(KEEP), '未等自动保存就刷新，内容仍未丢失');
await shot('13-draft-restored');

console.log('▶ 在草稿箱里运行代码');
await page.getByRole('button', { name: '▶ 运行' }).click();
await page.waitForSelector('text=运行完成', { timeout: 60000 });
await page.waitForTimeout(500);
const output = await page.getByTestId('self-output').innerText();
console.log(`  输出: ${JSON.stringify(output)}`);
assert(output.includes('42'), '运行输出包含 42');
assert(output.includes(KEEP), '运行输出包含第二行内容');
await shot('14-draft-run');

console.log('▶ 删除测试文件');
await page.getByRole('button', { name: '删除' }).click();
await page.waitForTimeout(1200);
const afterDelete = await bodyText();
assert(!afterDelete.includes(TITLE), '文件已从列表移除');

console.log('\n▶ 控制台错误:', consoleErrors.length ? consoleErrors : '无');
await browser.close();
