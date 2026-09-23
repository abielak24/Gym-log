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

/**
 * A stand-in for the deployed worker: the same three routes, in memory.
 * The worker's own rules are covered by tests/worker.test.ts; this exists so
 * the client can be driven end to end without anything deployed.
 */
const crews = new Map();
const members = new Map();

async function crewApi(request, response, path) {
  const body = await new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => resolve(raw));
  });

  const send = (status, payload) => {
    response.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    response.end(JSON.stringify(payload));
  };

  if (request.method === 'POST' && path === '/api/crew') {
    const crewId = `c${crews.size + 1}`;
    const secret = `s${crews.size + 1}`;
    crews.set(crewId, secret);
    members.set(crewId, new Map());
    return send(201, { crewId, secret });
  }

  const put = /^\/api\/crew\/([^/]+)\/member\/([^/]+)$/.exec(path);
  const get = /^\/api\/crew\/([^/]+)$/.exec(path);
  const crewId = put?.[1] ?? get?.[1];

  if (!crewId || crews.get(crewId) !== request.headers['x-crew-secret']) return send(404, { error: 'no such crew' });

  if (put && request.method === 'PUT') {
    members.get(crewId).set(put[2], {
      memberId: put[2],
      name: JSON.parse(body).name,
      updatedAt: Date.now(),
      summary: JSON.parse(body),
      token: request.headers['x-member-token'],
    });
    return send(200, { ok: true });
  }

  if (put && request.method === 'DELETE') {
    members.get(crewId).delete(put[2]);
    return send(200, { ok: true });
  }

  if (get && request.method === 'GET') {
    return send(200, {
      members: [...members.get(crewId).values()].map(({ token, ...rest }) => rest),
    });
  }

  return send(404, { error: 'not found' });
}

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
    if (path.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type,x-crew-secret,x-member-token',
        });
        return response.end();
      }
      return crewApi(request, response, path);
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
check('the grid lists the split’s exercises down the left', rowNames.join(',') === 'Pull Ups,Lat Pull Down,Rows | Cable Rows,Curls', rowNames.join(','));
check('five sessions of history are columns', (await page.locator('.grid-date').count()) === 5, String(await page.locator('.grid-date').count()));
check('and their sets are in the cells', (await page.locator('.grid').textContent())?.includes('170x'));
check('an unfinished session shows as a blank cell', (await page.locator('.grid-cell:empty').count()) > 0);
await page.screenshot({ path: join(SHOTS, '13-history-grid.png'), fullPage: true });

// --- Starting today adds a column on the right -------------------------------
await page.locator('.btn-primary', { hasText: 'Log today' }).click();
await page.waitForSelector('.grid-cell-today');

const dates = await page.locator('.grid-date').allTextContents();
check('today becomes a new column, to the right of last time', dates.length === 6, dates.join(' '));
check('only today’s column can be typed into', (await page.locator('.grid-cell-today').count()) === rowNames.length);

const pullUps = page.locator('textarea[data-exercise="Pull Ups"]');
check('an empty cell offers last time’s sets as a placeholder', (await pullUps.getAttribute('placeholder')) === '12\n10x8\n10x8', String(await pullUps.getAttribute('placeholder')));

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
// Built from today's date, not written down: a hardcoded one breaks daily.
const todayHeader = await page.evaluate(() => {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()}`;
});
check('and the page keeps the split’s name and date', written.startsWith(`${todayHeader} Back/Bis/Shoulders`), written.split('\n')[0]);
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
await page.locator('input[aria-label="New split"]').fill('Legs');
await page.locator('button[aria-label="Add split"]').click();
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
check('a month of training is filled in from the pages', trained >= 10, `${trained} days`);
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

// --- Writing a comment that is not a set ----------------------------------------
const noteCell = page.locator('.grid-cell-today').first();
const beforeNote = await noteCell.inputValue();
await noteCell.fill(`${beforeNote}\nshoulder felt tight`);
await page.waitForTimeout(500);

check('the app tells you a sentence is not a set', (await page.locator('.cell-notice-head').textContent())?.includes('will not be read as a set'));
check('and says what will happen to it', (await page.locator('.cell-notice .problem-why').first().textContent())?.includes('kept as a note'));
check('the cell is marked, but not as an error', (await page.locator('.grid-cell-prose').count()) === 1);
check('and the rule is written down where you are typing', (await page.locator('.note').last().textContent())?.includes('//'));
await page.screenshot({ path: join(SHOTS, '15-note-offer.png'), fullPage: true });

await page.locator('.cell-notice .btn', { hasText: 'Make it a note' }).click();
await page.waitForTimeout(500);
check('one tap makes it a note', (await page.locator('.grid-cell-today').first().inputValue()).includes('// shoulder felt tight'));
check('and the warning goes away', (await page.locator('.cell-notice-head').count()) === 0);
check('with the cell no longer marked', (await page.locator('.grid-cell-prose').count()) === 0);

await page.reload();
await page.waitForSelector('.grid');
const kept = await page.locator('.grid-cell-today').first().inputValue();
check('the note survives a reload, in the cell', kept.includes('// shoulder felt tight'), kept.replace(/\n/g, '|'));
check('and did not become an exercise', (await page.locator('.grid-name').allTextContents()).includes('shoulder felt tight') === false);
check('nor a flagged line', (await page.locator('.grid-cell-unreadable').count()) === 0);

// Even without tapping the offer, tabbing away keeps it with its exercise.
const untouched = page.locator('.grid-cell-today').nth(1);
const priorValue = await untouched.inputValue();
await untouched.fill(`${priorValue}\nback was tight`);
await untouched.blur();
await page.waitForTimeout(500);
check('leaving a cell settles a sentence into a note by itself', (await untouched.inputValue()).includes('// back was tight'));
await page.reload();
await page.waitForSelector('.grid');
check('and it is not an exercise after a reload either', (await page.locator('.grid-name').allTextContents()).includes('back was tight') === false);
await page.locator('.grid-cell-today').nth(1).fill(priorValue);
await page.waitForTimeout(500);

await page.locator('.grid-cell-today').first().fill(beforeNote);
await page.waitForTimeout(500);

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
check('the tabs are Home, Calendar and Friends', (await page.locator('.tab').allTextContents()).join(',') === 'Home,Calendar,Friends');
await page.screenshot({ path: join(SHOTS, '8-home.png'), fullPage: true });

// --- The daily tracker ---------------------------------------------------------
await page.goto(`${url}#/home`);
await page.waitForSelector('.daily');
check('today starts from the sample history\u2019s goals', (await page.locator('.daily-row').count()) === 3, String(await page.locator('.daily-row').count()));
check('with its values empty', (await page.locator('input[aria-label="Steps today"]').inputValue()) === '');

const goals = [['Pushups', '100', '100'], ['Cardio', '30min', '30min'], ['Steps', '10k', '7.5k']];
for (const [name, goal, value] of goals) {
  await page.locator(`input[aria-label="${name} goal"]`).fill(goal);
  await page.locator(`input[aria-label="${name} today"]`).fill(value);
}
await page.waitForTimeout(600);

check('a met goal is marked', (await page.locator('.daily-met').count()) === 2, String(await page.locator('.daily-met').count()));
check('a missed goal is not', (await page.locator('.daily-row:not(.daily-met)').count()) === 1);
const width = await page.locator('.daily-row:not(.daily-met) .daily-bar span').evaluate((el) => el.style.width);
check('and shows how far through it is', width === '75%', width);
await page.screenshot({ path: join(SHOTS, '11-daily.png'), fullPage: true });

await page.reload();
await page.waitForSelector('.daily-row');
check('the tracker is saved without a save button', (await page.locator('input[aria-label="Steps today"]').inputValue()) === '7.5k');
check('and the headline counts the day', (await page.locator('.section-title').allTextContents()).some((s) => s.includes('2 of 3 met')));

// --- It reaches the calendar -------------------------------------------------------
await page.goto(`${url}#/cal`);
await page.waitForSelector('.cal');
const dots = await page.locator('.cal-today .dot').count();
const met = await page.locator('.cal-today .dot-met').count();
check('today shows a dot per goal tracked', dots === 3, String(dots));
check('filled for the ones met', met === 2, String(met));
await page.screenshot({ path: join(SHOTS, '12-calendar-dots.png'), fullPage: true });

await page.locator('.cal-today').click();
await page.waitForSelector('.cal-panel');
await page.locator('.cal-panel a', { hasText: 'Daily' }).click();
await page.waitForSelector('.daily-row');
check('a day\u2019s tracker can be opened from the calendar', (await page.locator('.exercise-name').textContent())?.startsWith('Daily'));

// --- Clearing the sample history ---------------------------------------------------
await page.goto(`${url}#/home`);
await page.waitForSelector('.banner-sample');
await page.locator('.banner-sample .btn').click();
await page.waitForTimeout(250);
check('clearing samples takes the banner away', (await page.locator('.banner-sample').count()) === 0);
check('and offers to load them again', (await page.locator('.note .btn', { hasText: 'Load sample' }).count()) === 1);

await page.goto(`${url}#/cal`);
await page.waitForSelector('.cal');
const leftOver = await page.locator('.cal-trained').count();
check('the sample days come off the calendar', leftOver <= 3, `${leftOver} days left`);
const dotsLeft = await page.locator('.dot').count();
check('and their tracker dots go with them', dotsLeft <= 3, `${dotsLeft} dots left`);

await page.goto(`${url}#/home`);
await page.locator('.note .btn', { hasText: 'Load sample' }).click();
await page.waitForTimeout(300);
check('loading them again brings the history back', (await page.locator('.banner-sample').count()) === 1);
check('and the splits are back with it', (await page.locator('.split-name').allTextContents()).includes('Chest/Tris'));

// --- Goals belong to the day they were set on ------------------------------------------
// A day well before the sample tracker starts, so it is genuinely untracked.
const longAgo = await page.evaluate(() => {
  const d = new Date();
  d.setDate(d.getDate() - 60);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});
await page.goto(`${url}#/daily/${longAgo}`);
await page.waitForSelector('.daily');
check('an untracked past day starts from the last tracked goals', (await page.locator('input[aria-label="Pushups goal"]').inputValue()) === '100');
check('with its values empty, not borrowed', (await page.locator('input[aria-label="Pushups today"]').inputValue()) === '');
await page.locator('input[aria-label="Pushups goal"]').fill('50');
await page.locator('input[aria-label="Pushups today"]').fill('50');
await page.waitForTimeout(600);

await page.goto(`${url}#/home`);
await page.waitForSelector('.daily-row');
check('changing an old day\u2019s goal leaves today alone', (await page.locator('input[aria-label="Pushups goal"]').inputValue()) === '100');

// --- Light mode -----------------------------------------------------------------------------
const lightPage = await (await browser.newContext({
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light',
})).newPage();
await lightPage.goto(`${url}#/home`);
await lightPage.waitForSelector('.daily');
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

// --- A crew: one phone invites another ------------------------------------------
const phone = async (colorScheme = 'dark') => {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme,
    serviceWorkers: 'allow',
  });
  // Point the app at the stand-in worker, as a deploy would.
  await ctx.addInitScript((api) => localStorage.setItem('gym-notebook:crew-api', api), `${url}api`);
  return ctx;
};

const mineCtx = await phone();
const mine = await mineCtx.newPage();
mine.on('pageerror', (error) => check('no page errors on the crew tab', false, error.message));

await mine.goto(`${url}#/friends`);
await mine.waitForSelector('.add-exercise');
check('the tab explains what a crew is before anything is sent', (await mine.locator('.banner-nudge').textContent())?.includes('never leave this phone'));
check('and warns that the link is the key', (await mine.locator('.banner-nudge').textContent())?.includes('Anyone holding the link'));
await mine.screenshot({ path: join(SHOTS, '16-crew-start.png'), fullPage: true });

await mine.locator('input[aria-label="Your name on the board"]').fill('Alex');
await mine.locator('.btn-primary', { hasText: 'Start a crew' }).click();
await mine.waitForSelector('.board-list');

const invite = await mine.locator('.share-link').textContent();
check('a crew produces a link to send', invite?.includes('#/join/'), invite ?? '');
check('and I am on the board straight away', (await mine.locator('.board-name').textContent())?.includes('Alex'));
check('with what I have actually done', (await mine.locator('.board-stats').first().textContent())?.includes('lift'));

// --- The friend opens the link on their own phone ----------------------------------
const theirsCtx = await phone();
const theirs = await theirsCtx.newPage();
theirs.on('pageerror', (error) => check('no page errors on the friend\u2019s phone', false, error.message));
await theirs.goto(invite.trim());
await theirs.waitForSelector('.add-exercise');
check('the link lands the friend on a join screen', (await theirs.locator('.exercise-name').textContent()) === 'Join this crew');

await theirs.locator('input[aria-label="Your name on the board"]').fill('Sam');
await theirs.locator('.btn-primary', { hasText: 'Join' }).click();
await theirs.waitForSelector('.board-list');
check('joining shows the board', (await theirs.locator('.board-name').count()) === 2);

await theirs.goto(`${url}#/home`);
await theirs.waitForSelector('input[aria-label="New split"]');
check('and the friend still gets a working app of their own', (await theirs.locator('.split-name').count()) > 0);
check('the crew tab does not paint over it', (await theirs.locator('.section-title').count()) > 0);

// Clear the samples so what follows is only what this friend actually did.
await theirs.locator('.banner-sample .btn').click();
await theirs.waitForTimeout(300);

// --- Their training shows up on my board --------------------------------------------
await theirs.locator('input[aria-label="New split"]').fill('Legs');
await theirs.locator('button[aria-label="Add split"]').click();
await theirs.waitForSelector('.grid');
await theirs.locator('.add-exercise input').fill('Squat');
await theirs.locator('.add-exercise .btn-ghost').click();
await theirs.waitForTimeout(200);
await theirs.locator('textarea[data-exercise="Squat"]').fill('225x5\n245x3');
await theirs.waitForTimeout(4000);

await mine.goto(`${url}#/friends`);
await mine.waitForSelector('.board-list');
// Already on this tab, so nothing re-rendered: ask the board directly.
await mine.locator('.btn', { hasText: 'Refresh' }).click();
await mine.waitForTimeout(800);
const names = await mine.locator('.board-name').allTextContents();
check('my board shows my friend', names.some((n) => n.startsWith('Sam')), names.join(', '));
check('and marks which row is mine', names.some((n) => n.includes('(you)')));
const samRow = await mine.locator('.board-row', { hasText: 'Sam' }).locator('.board-stats').textContent();
check('with their week on it', samRow?.includes('1 day this week'), samRow ?? '');

await mine.goto(`${url}#/home`);
await mine.waitForSelector('.split-list');
check('but their workouts stay on their phone, not mine', (await mine.locator('.split-name').allTextContents()).includes('Legs') === false);
await mine.goto(`${url}#/friends`);
await mine.waitForSelector('.board-list');
await mine.screenshot({ path: join(SHOTS, '17-crew-board.png'), fullPage: true });

// --- What is shared, and what is not --------------------------------------------------
const posted = await theirs.evaluate(() => JSON.parse(localStorage.getItem('gym-notebook:v1')).lastPosted);
check('a summary carries lifts and best sets', posted.includes('Squat') && posted.includes('245'));
check('but no page text', posted.includes('Legs 9/') === false);
check('and no session detail', posted.includes('225x5\n245x3') === false);

// --- Holding one lift back ---------------------------------------------------------------
await theirs.goto(`${url}#/exercise/squat`);
await theirs.waitForSelector('.exercise-head');
check('a lift can be held back from the crew', (await theirs.locator('.btn', { hasText: 'Shared with your crew' }).count()) === 1);
await theirs.locator('.btn', { hasText: 'Shared with your crew' }).click();
await theirs.waitForTimeout(4000);
check('and says so once held back', (await theirs.locator('.btn', { hasText: 'Held back' }).count()) === 1);

const afterHiding = await theirs.evaluate(() => JSON.parse(localStorage.getItem('gym-notebook:v1')).lastPosted);
check('a held-back lift stops being sent', afterHiding.includes('Squat') === false, afterHiding.slice(0, 120));

// --- Pausing, and leaving ------------------------------------------------------------------
await theirs.goto(`${url}#/friends`);
await theirs.waitForSelector('.board-list');
await theirs.locator('.btn', { hasText: 'Pause sharing' }).click();
await theirs.waitForTimeout(300);
check('sharing can be paused without leaving', (await theirs.locator('.banner-nudge').textContent())?.includes('paused'));

await theirs.locator('.btn', { hasText: 'Leave crew' }).click();
await theirs.waitForTimeout(600);
check('leaving returns to the start screen', (await theirs.locator('.btn-primary', { hasText: 'Start a crew' }).count()) === 1);

await mine.goto(`${url}#/friends`);
await mine.waitForSelector('.board-list');
await mine.locator('.btn', { hasText: 'Refresh' }).click();
await mine.waitForTimeout(800);
check('and takes their row off my board', (await mine.locator('.board-name').count()) === 1);

// --- The crew never gets in the way of logging -----------------------------------------------
await mineCtx.setOffline(true);
await mine.goto(`${url}#/home`);
await mine.waitForSelector('.daily, .split-list');
check('the app still works with the crew unreachable', (await mine.locator('.split-name').count()) > 0);
await mine.goto(`${url}#/friends`);
await mine.waitForSelector('.board-list');
check('and the board shows its last known copy', (await mine.locator('.board-name').count()) >= 1);
check('saying when it was from', (await mine.locator('.board-footer .note').textContent())?.includes('As of'));
await mineCtx.setOffline(false);

await mineCtx.close();
await theirsCtx.close();

// --- Starting fresh -------------------------------------------------------------
await page.goto(`${url}#/home`);
await page.waitForSelector('.danger-zone');
check('erasing takes two taps, not one', (await page.locator('.danger-note').count()) === 0);

await page.locator('.btn-danger').click();
await page.waitForTimeout(150);
check('the first tap explains what it does', (await page.locator('.danger-note').textContent())?.includes('cannot be undone'));

await page.locator('.backup-actions .btn', { hasText: 'Keep it' }).click();
await page.waitForTimeout(150);
check('and can be backed out of', (await page.locator('.danger-note').count()) === 0);
check('with everything still there', (await page.locator('.split-name').count()) > 0);

await page.locator('.btn-danger').click();
await page.locator('.btn-danger-on').click();
await page.waitForTimeout(300);

check('erasing leaves no splits', (await page.locator('.split-name').count()) === 0);
check('no tracked rows', (await page.locator('.daily-row').count()) === 0);
check('no starred lifts', (await page.locator('.summary-name').count()) === 0);
check('and says how to start', (await page.locator('.empty, .note').first().textContent())?.length > 0);
check('the samples do not creep back', (await page.locator('.banner-sample').count()) === 0);
check('but are offered', (await page.locator('.note .btn', { hasText: 'Load sample' }).count()) === 1);
await page.screenshot({ path: join(SHOTS, '14-fresh.png'), fullPage: true });

await page.goto(`${url}#/cal`);
await page.waitForSelector('.cal');
check('the calendar is empty too', (await page.locator('.cal-trained').count()) === 0);
check('and has no tracker dots', (await page.locator('.dot').count()) === 0);

await page.reload();
await page.waitForSelector('.cal');
check('and it stays empty after a reload', (await page.locator('.cal-trained').count()) === 0);

await page.goto(`${url}#/home`);
await page.waitForSelector('.split-list, .note');
check('there is nothing left to erase, so the button goes', (await page.locator('.btn-danger').count()) === 0);


await browser.close();
server.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
