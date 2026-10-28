import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'msedge', headless: false });
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
await p.goto('https://uselute.xyz/welcome');
console.log('edge ok:', await p.title());
await b.close();
