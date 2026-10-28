// Captures real screens of the live product (public pages) at 1920x1080 for the demo video.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const root = join(process.env.LOCALAPPDATA, 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const exe = join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
const browser = await chromium.launch({ executablePath: exe });
const shots = [
  ['welcome', 'https://uselute.xyz/welcome', 'dark'],
  ['welcome-light', 'https://uselute.xyz/welcome', 'light'],
  ['preview', 'https://uselute.xyz/preview', 'dark'],
  ['payslip', 'https://uselute.xyz/payslip/f_ZP25T4rePJyoTaoNDHMw', 'dark'],
  ['evidence', 'https://uselute.xyz/docs/evidence', 'dark'],
  ['custody', 'https://uselute.xyz/docs/custody', 'dark'],
  ['signup', 'https://uselute.xyz/signup', 'dark'],
  ['github', 'https://github.com/Stella112/zlute', 'dark'],
];
for (const [name, url, scheme] of shots) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `public/shots/${name}.png` });
  if (name === 'evidence') {
    await page.goto('https://uselute.xyz/docs/evidence#e-014', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'public/shots/evidence-e014.png' });
  }
  if (name === 'welcome') {
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#privacy')?.offsetTop ?? 1400));
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'public/shots/welcome-privacy.png' });
  }
  await ctx.close();
  console.log('captured', name);
}
await browser.close();
