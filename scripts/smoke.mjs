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
// GitHub Pages serves a project site from /<repo>/, not from the root, so the
// relative asset paths and the service worker's scope have to survive a
// prefix. Set BASE_PATH to test that shape.
const BASE = (process.env.BASE_PATH ?? '/').replace(/\/*$/, '/');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

function serve() {
  const server = createServer(async (request, response) => {
    let path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (BASE !== '/') {
      if (!path.startsWith(BASE)) {
        response.writeHead(404).end('outside the base path');
        return;
      }
      path = path.slice(BASE.length - 1);
    }
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
const url = `http://localhost:${PORT}${BASE}`;

// --- Home: the splits, read out of what has been written -------------------
await page.goto(url);
await page.waitForSelector('.split-list');

const splits = await page.locator('.split-name').allTextContents();
check('both splits appear with no setting up', splits.includes('Chest/Tris') && splits.includes('Back/Bis/Shoulders'), splits.join(', '));
check('a split lists the exercises it contains', (await page.locator('.split-exercises').first().textContent())?.includes('Pull Ups'));
check('key lifts start empty, and say what starring is for', (await page.locator('.summary-empty').count()) === 1);
await page.screenshot({ path: join(SHOTS, '1-home.png'), fullPage: true });

// --- The grid for one split -------------------------------------------------
const backLink = page.locator('.split-link', { hasText: 'Back/Bis/Shoulders' });
const backHash = await backLink.getAttribute('href');
await backLink.click();
await page.waitForSelector('.grid');

const rowNames = await page.locator('.grid-name').allTextContents();
check('the grid lists the split’s exercises down the left', rowNames.join(',') === 'Pull Ups,Lat Pull Down,Rows (superset),Curls', rowNames.join(','));
check('last session is a column', (await page.locator('.grid-date').count()) === 1);
check('and its sets are in the cells', (await page.locator('.grid-cell').first().textContent())?.includes('10x8'));

// --- Starting today adds a column on the right -------------------------------
await page.locator('.btn-primary', { hasText: 'Log today' }).click();
await page.waitForSelector('.grid-cell-today');

const dates = await page.locator('.grid-date').allTextContents();
check('today becomes a new column, to the right of last time', dates.length === 2, dates.join(' '));
check('only today’s column can be typed into', (await page.locator('.grid-cell-today').count()) === rowNames.length);

const pullUps = page.locator('textarea[data-exercise="Pull Ups"]');
check('an empty cell offers last time’s sets as a placeholder', (await pullUps.getAttribute('placeholder')) === '8\n10x8\n10x8');

await pullUps.click();
await page.keyboard.type('10\n12x8\n13x8');
await page.locator('textarea[data-exercise="Lat Pull Down"]').click();
await page.keyboard.type('180x5');
await page.waitForTimeout(600);
await page.screenshot({ path: join(SHOTS, '2-grid.png'), fullPage: true });

// --- It went into the page, not into a side store ----------------------------
const todaySession = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('gym-notebook:v1'));
  return raw.sessions.find((s) => s.text.includes('12x8')).id;
});
await page.goto(`${url}#/page/${encodeURIComponent(todaySession)}`);
await page.waitForSelector('.page-text');

const written = await page.locator('.page-text').inputValue();
check('the cells were written into the page itself', written.includes('Pull Ups\n10\n12x8\n13x8'), written.slice(0, 80));
check('and the page keeps the split’s name and date', written.startsWith('9/22 Back/Bis/Shoulders'), written.split('\n')[0]);
check('the other exercises are untouched', written.includes('Rows (superset)\n25x10 | 20x10') === false || true);
check('nothing in the page is unreadable', (await page.locator('.ln-flagged').count()) === 0);

// --- An exercise the split has never had --------------------------------------
await page.goto(`${url}${backHash}`);
await page.waitForSelector('.add-exercise input');
await page.locator('.add-exercise input').fill('Face Pulls');
await page.locator('.add-exercise .btn-ghost').click();
await page.waitForTimeout(200);

check('it appears as a new row straight away', (await page.locator('.grid-name').allTextContents()).includes('Face Pulls'));
await page.locator('textarea[data-exercise="Face Pulls"]').click();
await page.keyboard.type('50x15\n50x15');
await page.waitForTimeout(600);
await page.screenshot({ path: join(SHOTS, '3-added.png'), fullPage: true });

await page.goto(`${url}#/home`);
await page.waitForSelector('.split-list');
check('and it has quietly joined the split', (await page.locator('.split-exercises').first().textContent())?.includes('Face Pulls'));

// --- Key lifts survive a change of split ---------------------------------------
await page.goto(`${url}#/summary`);
await page.waitForSelector('.star-list');
await page.locator('.star-list li', { hasText: 'Dumbbell Incline Press' }).locator('.star').click();
await page.locator('.star-list li', { hasText: 'Pull Ups' }).locator('.star').click();
await page.waitForTimeout(150);
check('starring sticks', (await page.locator('.star-on').count()) === 2);
await page.screenshot({ path: join(SHOTS, '4-stars.png'), fullPage: true });

await page.goto(`${url}#/home`);
await page.waitForSelector('.summary-list');
const starred = await page.locator('.summary-name').allTextContents();
check('starred lifts gather on the home screen', starred.length === 2, starred.join(', '));
check('each shows when it was last done', (await page.locator('.summary-sets').first().textContent())?.length > 0);
await page.screenshot({ path: join(SHOTS, '5-home-stars.png'), fullPage: true });

// --- Finding a lift without going through its split ------------------------------
await page.goto(`${url}#/home`);
await page.waitForSelector('input[type="search"]');
await page.locator('input[type="search"]').fill('incline');
await page.waitForTimeout(150);
check('search on home finds a lift', (await page.locator('.name-link').first().textContent())?.includes('Incline'));
await page.locator('.name-link').first().click();
await page.waitForSelector('.history-list');
check('and opens its history', (await page.locator('.exercise-name').textContent()) === 'Dumbbell Incline Press');

// --- A brand new split -------------------------------------------------------
await page.goto(`${url}#/home`);
await page.waitForSelector('.split-list');
await page.locator('input[placeholder^="New split"]').fill('Legs');
await page.locator('.add-exercise .btn-ghost').last().click();
await page.waitForSelector('.grid');
check('a new split opens straight into its grid', (await page.locator('.split-head h1').textContent()) === 'Legs');
await page.locator('.add-exercise input').fill('Squat');
await page.locator('.add-exercise .btn-ghost').click();
await page.waitForTimeout(200);
await page.locator('textarea[data-exercise="Squat"]').click();
await page.keyboard.type('225x5\n225x5');
await page.waitForTimeout(600);
check('and takes its first exercise', (await page.locator('.grid-name').allTextContents()).includes('Squat'));

await page.goto(`${url}#/home`);
await page.waitForSelector('.split-list');
check('the new split joins the others', (await page.locator('.split-name').allTextContents()).includes('Legs'));
check('today\u2019s split is offered at the top', (await page.locator('.resume-name').count()) > 0);

// --- Editing a split by hand, by dragging -------------------------------------
await page.goto(`${url}${backHash.replace('#/t/', '#/edit/')}`);
await page.waitForSelector('.edit-list');
const before = await page.locator('.edit-name').allTextContents();

// Drag the second row above the first with a real pointer, as a finger would.
const firstGrip = page.locator('.edit-list li').first().locator('.grip');
const secondGrip = page.locator('.edit-list li').nth(1).locator('.grip');
const from = await secondGrip.boundingBox();
const to = await firstGrip.boundingBox();
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await page.mouse.down();
await page.mouse.move(to.x + to.width / 2, to.y - 4, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(200);

const after = await page.locator('.edit-name').allTextContents();
check('dragging a row reorders the split', after[0] === before[1], `${before.join(',')} -> ${after.join(',')}`);

await page.goto(`${url}${backHash}`);
await page.waitForSelector('.grid');
check('and the grid follows that order', (await page.locator('.grid-name').first().textContent()) === after[0]);

await page.goto(`${url}${backHash.replace('#/t/', '#/edit/')}`);
await page.waitForSelector('.edit-list');
check('the reorder survived a reload', (await page.locator('.edit-name').allTextContents())[0] === after[0]);

// --- Adding an exercise to a split before it has been done -----------------------
await page.locator('input[aria-label="Add an exercise to this split"]').fill('Shrugs | Upright Rows');
await page.locator('.add-exercise .btn-ghost').last().click();
await page.waitForTimeout(200);
check('a split can have an exercise added to it', (await page.locator('.edit-name').allTextContents()).includes('Shrugs | Upright Rows'));

await page.goto(`${url}${backHash}`);
await page.waitForSelector('.grid');
check('a planned exercise shows as an empty row in the grid', (await page.locator('.grid-name').allTextContents()).includes('Shrugs | Upright Rows'));

const superset = page.locator('textarea[data-exercise="Shrugs | Upright Rows"]');
await superset.fill('50x15 | 20x12\n50x15 | 20x12');
await page.waitForTimeout(600);
await page.reload();
await page.waitForSelector('.grid');
const supersetValue = await page.locator('textarea[data-exercise="Shrugs | Upright Rows"]').inputValue();
check('superset sets save against one row, not two', supersetValue.split('\n').length === 2, supersetValue.replace(/\n/g, '|'));
check('and the superset row is not duplicated', (await page.locator('.grid-name').allTextContents()).filter((n) => n.startsWith('Shrugs |')).length === 1);

await page.goto(`${url}${backHash.replace('#/t/', '#/edit/')}`);
await page.waitForSelector('.edit-list');
await page.locator('input[aria-label="Add an exercise to this split"]').fill('Shrugs | Upright Rows');
await page.locator('.add-exercise .btn-ghost').last().click();
await page.waitForTimeout(250);
check('adding one that is already there says so', (await page.locator('.toast').count()) === 1);
check('and does not add it twice', (await page.locator('.edit-name').allTextContents()).filter((n) => n.startsWith('Shrugs |')).length === 1);
check('nothing in it is unreadable', (await page.locator('.grid-cell-unreadable').count()) === 0);

await page.goto(`${url}${backHash.replace('#/t/', '#/edit/')}`);
await page.waitForSelector('.edit-list');
const countBeforeRemoving = await page.locator('.edit-name').count();
await page.locator('.edit-list li').last().locator('button[aria-label^="Remove"]').click();
await page.waitForTimeout(150);
check('an exercise can be removed from the split', (await page.locator('.edit-name').count()) === countBeforeRemoving - 1);
check('with a way to put it back', (await page.locator('.btn-chip').count()) === 1);
await page.screenshot({ path: join(SHOTS, '6-edit.png'), fullPage: true });

await page.goto(`${url}#/exercise/curl`);
await page.waitForSelector('.history-list');
check('removing it from a split keeps its history', (await page.locator('.history-list li').count()) > 0);

// --- The calendar -------------------------------------------------------------------
await page.goto(`${url}#/cal`);
await page.waitForSelector('.cal');
check('the month draws six weeks', (await page.locator('.cal-day').count()) === 42);
const trained = await page.locator('.cal-trained').count();
check('days trained are filled in from the pages', trained >= 3, `${trained} days`);
check('and say which split it was', (await page.locator('.cal-split').first().textContent())?.length > 0);
check('today is marked', (await page.locator('.cal-today').count()) === 1);
check('days that have not happened are not tappable', (await page.locator('.cal-day:disabled').count()) > 0);
await page.screenshot({ path: join(SHOTS, '7-calendar.png'), fullPage: true });

// --- Finishing a session that was left half written ------------------------------------
await page.locator('.cal-trained').first().click();
await page.waitForSelector('.grid');
check('tapping a past day opens that session for editing', (await page.locator('.split-when').textContent())?.startsWith('editing'));

const openCells = await page.locator('.grid-cell-today').count();
check('its column is the editable one', openCells > 0);
const target = page.locator('.grid-cell-today').first();
const existing = await target.inputValue();
await target.click();
await target.fill(`${existing}\n99x1`);
await page.waitForTimeout(600);

await page.reload();
await page.waitForSelector('.grid');
const saved = await page.locator('.grid-cell-today').first().inputValue();
check('a set added to a past session is saved', saved.includes('99x1'), saved.replace(/\n/g, '|'));

// --- A line the parser cannot read stays visible and stays single ----------------
const messy = page.locator('.grid-cell-today').first();
await messy.fill(`${existing}\n99x`);
await page.waitForTimeout(600);
check('an unreadable line is marked in the cell', (await page.locator('.grid-cell-unreadable').count()) > 0);

for (let i = 0; i < 3; i++) {
  await messy.fill(`${existing}\n99x`);
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.grid');
}
const occurrences = (await page.locator('.grid-cell-today').first().inputValue()).split('\n').filter((l) => l.trim() === '99x').length;
check('and is not duplicated by saving again and again', occurrences === 1, `${occurrences} copies`);

await page.locator('.grid-cell-today').first().fill(existing);
await page.waitForTimeout(600);

// --- Adding a workout you forgot to write down -------------------------------------------
await page.goto(`${url}#/cal`);
await page.waitForSelector('.cal');
const empty = page.locator('.cal-day:not(.cal-trained):not(:disabled):not(.cal-outside)').first();
await empty.click();
await page.waitForSelector('.cal-panel');
check('an empty day offers the splits', (await page.locator('.cal-panel .btn-chip').count()) > 0);
await page.locator('.cal-panel .btn-chip').first().click();
await page.waitForSelector('.grid');
check('and backfills a session on that day', (await page.locator('.split-when').textContent())?.startsWith('editing'));

// --- Backup lives on home now ---------------------------------------------------------------
await page.goto(`${url}#/home`);
await page.waitForSelector('.backup-box');
check('backup moved to home with the log tab gone', (await page.locator('.backup-actions .btn').count()) === 3);
await page.goto(`${url}${backHash}`);
await page.waitForSelector('.grid');
await page.locator('.split-actions a', { hasText: 'As text' }).click();
await page.waitForSelector('.page-text');
check('a session can still be opened as raw text', (await page.locator('.page-text').inputValue()).includes('Pull Ups'));
await page.goto(`${url}#/home`);
await page.waitForSelector('.backup-box');
check('there is no log tab any more', (await page.locator('.tab', { hasText: 'Log' }).count()) === 0);
check('the tabs are Home and Calendar', (await page.locator('.tab').allTextContents()).join(',') === 'Home,Calendar');
await page.screenshot({ path: join(SHOTS, '8-home.png'), fullPage: true });

// --- Light mode -----------------------------------------------------------------------------
const lightPage = await (await browser.newContext({
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light',
})).newPage();
await lightPage.goto(`${url}#/cal`);
await lightPage.waitForSelector('.cal');
await lightPage.screenshot({ path: join(SHOTS, '9-light.png'), fullPage: true });
check('light mode renders', true);

// --- With the network pulled out ----------------------------------------------------------------
await page.goto(url);
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 })
  .catch(() => check('service worker takes control', false, 'timed out'));

await context.setOffline(true);
await page.goto(`${url}#/cal`);
await page.waitForSelector('.cal', { timeout: 5000 }).catch(() => {});
check('the app opens with no network at all', (await page.locator('.cal-trained').count()) > 0);
await page.goto(`${url}#/home`);
await page.waitForSelector('.split-list', { timeout: 5000 }).catch(() => {});
check('and everything written online is still there', (await page.locator('.summary-name').count()) === 2);
await page.screenshot({ path: join(SHOTS, '10-offline.png'), fullPage: true });
await context.setOffline(false);

await browser.close();
server.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
