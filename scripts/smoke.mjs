/**
 * Drive the built app in a real browser at phone size.
 *
 * Unit tests prove the parser reads the notebook; this proves the thing you
 * hold in your hand actually works — ghost text appears, the flag can be
 * dismissed, history is reachable, and the app still opens with the network
 * pulled out. Screenshots land in `shots/`.
 *
 *   npm run build && node scripts/smoke.mjs
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const DIST = new URL('../dist/', import.meta.url).pathname;
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const PORT = 4173;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

function serve() {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(DIST, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? '  ok' : 'FAIL'}  ${name}${detail && !condition ? ` — ${detail}` : ''}`);
}

const server = await serve();
if (!existsSync(SHOTS)) mkdirSync(SHOTS);

// Use the browser this machine already has, or let Playwright find its own.
const preinstalled = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(preinstalled) ? { executablePath: preinstalled } : {});
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
  serviceWorkers: 'allow',
});

const page = await context.newPage();
page.on('pageerror', (error) => check('no page errors', false, error.message));
const url = `http://localhost:${PORT}/`;

// --- Today, with last week's sets offered as ghost text --------------------
await page.goto(url);
await page.waitForSelector('.page-text');

const textarea = page.locator('.page-text');
await textarea.click();
await page.keyboard.press('End');
await page.keyboard.type('Chest/Tris\nDumbbell Incline Press\n');
await page.waitForTimeout(150);

const ghostCount = await page.locator('.ln-ghost').count();
check('ghost text offers last session, all seven sets', ghostCount === 7, `saw ${ghostCount}`);
check('the hint bar names the day it came from', (await page.locator('.hint-label').first().textContent())?.includes('last time'));
await page.screenshot({ path: join(SHOTS, '1-ghost.png') });

// --- Fill, then type a real set over it ------------------------------------
await page.locator('.btn-primary', { hasText: 'Fill' }).click();
await page.waitForTimeout(150);
const filled = await textarea.inputValue();
check('Fill writes last session in as editable text', filled.includes('45x8') && filled.includes('95x7'));
check('ghost clears once the sets are yours', (await page.locator('.ln-ghost').count()) === 0);

await page.keyboard.type('Chest Fly\n47.5x12\n');
await page.waitForTimeout(150);
check('a second exercise gets its own ghost', (await page.locator('.ln-ghost').count()) === 5);
await page.screenshot({ path: join(SHOTS, '2-typed.png') });

// --- A line it cannot read --------------------------------------------------
await page.keyboard.type('47.5x\n');
await page.waitForTimeout(150);
check('a half-written set is flagged', (await page.locator('.ln-flagged').count()) === 1);

await page.locator('.btn-warn').click();
await page.waitForSelector('.sheet:not([hidden])');
check('the sheet says why', (await page.locator('.problem-why').first().textContent())?.includes('weight x reps'));
await page.screenshot({ path: join(SHOTS, '3-flagged.png') });

await page.locator('.sheet .btn-ghost').first().click();
await page.waitForTimeout(150);
check('"it\'s a note" silences the line for good', (await textarea.inputValue()).includes('// 47.5x'));
check('and the flag goes away', (await page.locator('.ln-flagged').count()) === 0);
await page.locator('.sheet .btn-primary').click();

// --- The log ----------------------------------------------------------------
await page.locator('.tab', { hasText: 'Log' }).click();
await page.waitForSelector('.log-list');
const rows = await page.locator('.log-row').count();
check('today joins the two sample pages in the log', rows === 3, `saw ${rows}`);
check('each page is summarised by sets and volume', (await page.locator('.log-summary').first().textContent())?.includes('lb'));
await page.screenshot({ path: join(SHOTS, '4-log.png'), fullPage: true });

// --- One exercise, all of its history ---------------------------------------
await page.locator('.chip-link', { hasText: 'Dumbbell Incline Press' }).first().click();
await page.waitForSelector('.history-list');
const sessionCount = await page.locator('.history-list li').count();
check('history gathers both times this lift was done', sessionCount === 2, `saw ${sessionCount}`);
check('the heaviest set is called out', (await page.locator('.exercise-summary').textContent())?.includes('95x7'));
await page.screenshot({ path: join(SHOTS, '5-history.png'), fullPage: true });

// --- Light mode --------------------------------------------------------------
const lightPage = await (await browser.newContext({
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light',
})).newPage();
await lightPage.goto(`${url}#/log`);
await lightPage.waitForSelector('.log-list');
await lightPage.screenshot({ path: join(SHOTS, '6-light.png'), fullPage: true });
check('light mode renders', true);

// --- With the network pulled out ---------------------------------------------
await page.goto(url);
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 })
  .catch(() => check('service worker takes control', false, 'timed out'));

await context.setOffline(true);
await page.goto(`${url}#/log`);
await page.waitForSelector('.log-list', { timeout: 5000 }).catch(() => {});
check('the app opens with no network at all', (await page.locator('.log-row').count()) > 0);
check('and the log written online is still there', (await page.locator('.log-title').first().textContent())?.includes('Chest/Tris'));
await page.screenshot({ path: join(SHOTS, '7-offline.png'), fullPage: true });
await context.setOffline(false);

await browser.close();
server.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
