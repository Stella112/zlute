// Captures real signed-in screens of the live product for the demo video. Opens a visible
// 1920x1080 Edge window; the owner signs in themselves (the script never sees the password).
// Then it captures pages, creates one real payment request, and records it until it is paid.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'https://uselute.xyz';
mkdirSync('public/shots', { recursive: true });
mkdirSync('public/rec', { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1940,1150'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark', recordVideo: { dir: 'public/rec', size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
log('Waiting for you to sign in in the Edge window…');
const me = async () => page.evaluate(async () => { const r = await fetch('/v1/me'); return r.ok ? r.json() : null; }).catch(() => null);
for (let i = 0; i < 450; i++) {
  const m = await me();
  if (m?.username) { log(`SIGNED IN as ${m.username}`); break; }
  await page.waitForTimeout(2000);
}

const shot = async (name, path, prep) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  if (prep) await prep();
  await page.screenshot({ path: `public/shots/app-${name}.png` });
  log(`captured ${name}`);
};
await shot('home', '/');
await shot('activity', '/activity');
await shot('payroll', '/payroll');
await shot('payroll-runs', '/payroll', async () => {
  await page.getByText('Payroll runs').first().scrollIntoViewIfNeeded().catch(() => undefined);
  await page.waitForTimeout(800);
});
await shot('agents', '/agents');
await shot('agents-grants', '/agents', async () => {
  await page.getByText('Grants').last().scrollIntoViewIfNeeded().catch(() => undefined);
  await page.waitForTimeout(800);
});
await shot('privacy', '/privacy');
await shot('privacy-matrix', '/privacy', async () => {
  await page.getByText('Who can see what').first().scrollIntoViewIfNeeded().catch(() => undefined);
  await page.waitForTimeout(800);
});
await shot('privacy-tests', '/privacy', async () => {
  await page.getByText('Test suites').first().scrollIntoViewIfNeeded().catch(() => undefined);
  await page.waitForTimeout(800);
});
await shot('streams', '/streams');
await shot('commerce', '/commerce');
await shot('subscriptions', '/subscriptions');
await shot('send-fee', '/send', async () => {
  const amount = page.locator('input').first();
  await amount.fill('0.0002').catch(() => undefined);
  await page.waitForTimeout(800);
});

// A real payment request, recorded until it is paid (if the owner pays it from Zodl).
await page.goto(`${BASE}/receive`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const amountInput = page.locator('input').first();
await amountInput.fill('0.0003');
const noteToggle = page.getByText(/add a note/i).first();
if (await noteToggle.isVisible().catch(() => false)) {
  await noteToggle.click();
  await page.locator('textarea').first().fill('Logo design, invoice 12');
}
await page.getByRole('button', { name: /create|request/i }).first().click();
await page.waitForTimeout(3000);
await page.screenshot({ path: 'public/shots/app-request-qr.png' });
log('REQUEST READY: scan the QR on screen with Zodl and pay 0.0003 ZEC (optional). Recording for up to 15 minutes.');
let last = '';
for (let i = 0; i < 180; i++) {
  const text = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
  const state = text.includes('paid: received') || text.includes('received and confirmed') ? 'paid' : text.includes('confirming') ? 'confirming' : text.includes('partially') ? 'partial' : 'waiting';
  if (state !== last) {
    await page.screenshot({ path: `public/shots/app-request-${state}.png` });
    log(`request state: ${state}`);
    last = state;
  }
  if (state === 'paid') break;
  await page.waitForTimeout(5000);
}
writeFileSync('public/rec/done.txt', `finished ${new Date().toISOString()} last=${last}\n`);
await ctx.close();
await browser.close();
log('DONE');
