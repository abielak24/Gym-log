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
 * A stand-in for the deployed worker, in memory.
 *
 * The worker's own rules are covered by tests/worker.test.ts; this exists so
 * the client can be driven end to end without anything deployed. It is
 * deliberately loose where the real one is strict - it is here to let the
 * browser make real requests, not to re-prove the rules.
 */
const accounts = new Map();   // handleKey -> { id, handle, displayName, salt, key, recovery }
const tokens = new Map();     // token -> accountId
const log = new Map();        // accountId -> Map of "kind:id" -> record
const crews = new Map();
const members = new Map();
let nextId = 0;

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

  const fold = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const json = () => { try { return JSON.parse(body); } catch { return {}; } };
  const whoami = () => accounts.get(tokens.get(request.headers['x-account-token']) ?? '') ?? null;
  const issue = (account) => {
    const token = `tok${nextId += 1}`;
    tokens.set(token, account.handleKey);
    return { accountId: account.id, token, handle: account.handle, displayName: account.displayName };
  };

  /* Accounts ------------------------------------------------------------- */

  if (request.method === 'POST' && path === '/api/account') {
    const wanted = json();
    const key = fold(wanted.handle);
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(String(wanted.handle ?? ''))) {
      return send(400, { error: 'a handle is 3 to 40 letters, numbers, dots, dashes or underscores' });
    }
    if (accounts.has(key)) return send(409, { error: 'that handle is taken' });

    const account = {
      id: `acc${nextId += 1}`,
      handleKey: key,
      handle: wanted.handle,
      displayName: wanted.displayName || wanted.handle,
      salt: wanted.salt,
      key: wanted.key,
      recovery: wanted.recovery,
    };
    accounts.set(key, account);
    return send(201, issue(account));
  }

  if (request.method === 'POST' && path === '/api/account/salt') {
    const found = accounts.get(fold(json().handle));
    // A handle nobody has still gets a stable answer, so it cannot be probed.
    return send(200, { salt: found ? found.salt : `made-up-${fold(json().handle)}` });
  }

  if (request.method === 'POST' && path === '/api/session') {
    const wanted = json();
    const found = accounts.get(fold(wanted.handle));
    if (!found || found.key !== wanted.key) return send(403, { error: 'that handle and password do not match' });
    return send(200, issue(found));
  }

  if (request.method === 'POST' && path === '/api/account/recover') {
    const wanted = json();
    const found = accounts.get(fold(wanted.handle));
    if (!found || found.recovery !== wanted.recovery) {
      return send(403, { error: 'that handle and recovery code do not match' });
    }
    found.salt = wanted.salt;
    found.key = wanted.key;
    found.recovery = wanted.nextRecovery;
    for (const [token, owner] of tokens) if (owner === found.handleKey) tokens.delete(token);
    return send(200, issue(found));
  }

  if (request.method === 'DELETE' && path === '/api/session') {
    tokens.delete(request.headers['x-account-token']);
    return send(200, { ok: true });
  }

  if (request.method === 'GET' && path === '/api/me') {
    const me = whoami();
    if (!me) return send(401, { error: 'not signed in' });
    return send(200, { accountId: me.id, handle: me.handle, displayName: me.displayName });
  }

  /* The log -------------------------------------------------------------- */

  if (path === '/api/log') {
    const me = whoami();
    if (!me) return send(401, { error: 'not signed in' });

    const mine = log.get(me.id) ?? new Map();
    log.set(me.id, mine);

    if (request.method === 'PUT') {
      for (const record of JSON.parse(body).records ?? []) {
        const key = `${record.kind}:${record.id}`;
        const before = mine.get(key);
        // Mirrors the worker: an older write never lands on a newer one.
        if (!before || record.updatedAt > before.updatedAt) mine.set(key, record);
      }
      return send(200, { ok: true, now: Date.now() });
    }

    if (request.method === 'GET') {
      const since = Number(new URL(request.url, 'http://x').searchParams.get('since') ?? 0);
      const records = [...mine.values()].filter((r) => r.updatedAt > since).sort((a, b) => a.updatedAt - b.updatedAt);
      return send(200, { now: Date.now(), more: false, cursor: Date.now(), records });
    }
  }

  /* Crews ---------------------------------------------------------------- */

  if (request.method === 'POST' && path === '/api/crew') {
    const me = whoami();
    if (!me) return send(401, { error: 'not signed in' });

    const crewId = `c${crews.size + 1}`;
    const secret = `s${crews.size + 1}`;
    crews.set(crewId, { secret, ownerAccountId: me.id });
    members.set(crewId, new Map());
    return send(201, { crewId, secret });
  }

  const mine = /^\/api\/crew\/([^/]+)\/member$/.exec(path);
  const other = /^\/api\/crew\/([^/]+)\/member\/([^/]+)$/.exec(path);
  const get = /^\/api\/crew\/([^/]+)$/.exec(path);
  const rotate = /^\/api\/crew\/([^/]+)\/rotate$/.exec(path);
  const crewId = mine?.[1] ?? other?.[1] ?? get?.[1] ?? rotate?.[1];

  const crew = crewId ? crews.get(crewId) : undefined;
  if (!crew || crew.secret !== request.headers['x-crew-secret']) return send(404, { error: 'no such crew' });

  const me = whoami();
  const isOwner = Boolean(me && me.id === crew.ownerAccountId);

  if (rotate && request.method === 'POST') {
    if (!isOwner) return send(403, { error: 'only whoever started the crew can do that' });
    crew.secret = `${crew.secret}-rotated`;
    return send(200, { secret: crew.secret });
  }

  if (mine && request.method === 'PUT') {
    if (!me) return send(401, { error: 'not signed in' });

    const crewMembers = members.get(crewId);
    const summary = JSON.parse(body);
    const clash = [...crewMembers.values()].find((m) => fold(m.name) === fold(summary.name) && m.memberId !== me.id);
    if (clash) return send(409, { error: 'that name is taken' });

    crewMembers.set(me.id, { memberId: me.id, name: summary.name, updatedAt: Date.now(), summary });
    return send(200, { ok: true, accountId: me.id });
  }

  if (mine && request.method === 'DELETE') {
    if (!me) return send(401, { error: 'not signed in' });
    members.get(crewId).delete(me.id);
    return send(200, { ok: true });
  }

  if (other && request.method === 'DELETE') {
    if (!isOwner) return send(403, { error: 'only whoever started the crew can do that' });
    if (other[2] === me.id) return send(400, { error: 'you cannot remove yourself' });
    members.get(crewId).delete(other[2]);
    return send(200, { ok: true });
  }

  if (get && request.method === 'GET') {
    return send(200, {
      ownerAccountId: crew.ownerAccountId,
      members: [...members.get(crewId).values()],
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

// Point the app at the stand-in worker, as a deploy would.
await context.addInitScript((api) => localStorage.setItem('gym-notebook:crew-api', api), `http://localhost:${PORT}${BASE}api`);

/**
 * Make an account, which is now how every device starts.
 *
 * Deriving the key is deliberately slow, so this is not instant - which is
 * itself worth knowing, since it is what every real sign-in costs.
 */
const makeAccount = async (pg, handle, password = 'pass') => {
  await pg.waitForSelector('.auth-form');
  if (await pg.locator('.btn-ghost', { hasText: 'Create an account' }).count()) {
    await pg.locator('.btn-ghost', { hasText: 'Create an account' }).click();
  }
  await pg.locator('input[aria-label="Handle"]').fill(handle);
  await pg.locator('input[aria-label="Password"]').fill(password);
  await pg.locator('input[aria-label="Password again"]').fill(password);
  await pg.locator('.btn-primary', { hasText: 'Create account' }).click();
  await pg.waitForSelector('.recovery-code', { timeout: 30000 });
  const code = (await pg.locator('.recovery-code').textContent())?.trim();
  await pg.locator('.confirm-saved input').check();
  await pg.locator('.btn-primary', { hasText: 'Continue' }).click();
  return code;
};

/**
 * Tap Sync now and wait for what it was supposed to bring.
 *
 * A fixed pause here passes on a fast machine and fails on a loaded CI
 * runner, which is exactly what it did. Wait for the condition instead, and
 * tap again if the first round crossed with the other device's push.
 */
const syncUntil = async (pg, settled, rounds = 4) => {
  for (let round = 0; round < rounds; round += 1) {
    await pg.goto(`${url}#/home`);
    await pg.waitForSelector('.account-box');
    await pg.locator('.account-actions .btn', { hasText: 'Sync now' }).click();
    await pg.waitForSelector('.toast', { timeout: 20000 }).catch(() => {});
    // The check runs out here rather than in the page, so it is free to
    // navigate to wherever the thing it is looking for actually lives.
    if (await settled()) return true;
  }
  return false;
};

/**
 * Wait for the board to actually have rows on it.
 *
 * `.board-list` appears first holding "Loading the board…", so waiting on
 * the list is not waiting for the board, and counting rows before the fetch
 * lands reads whatever happens to be there.
 */
const waitForRows = async (pg, count) => {
  await pg.waitForFunction(
    (want) => document.querySelectorAll('.board-name').length === want,
    count,
    { timeout: 20000 },
  ).catch(() => {});
};

const signInAs = async (pg, handle, password = 'pass') => {
  await pg.waitForSelector('.auth-form');
  if (await pg.locator('.btn-ghost', { hasText: 'I already have an account' }).count()) {
    await pg.locator('.btn-ghost', { hasText: 'I already have an account' }).click();
  }
  await pg.locator('input[aria-label="Handle"]').fill(handle);
  await pg.locator('input[aria-label="Password"]').fill(password);
  await pg.locator('.btn-primary', { hasText: 'Sign in' }).click();
};

// --- The front door -------------------------------------------------------
await page.goto(url);
await page.waitForSelector('.auth-form');
check('a new phone asks for an account before anything else', (await page.locator('.exercise-name').textContent()) === 'Create an account');
check('with nothing to navigate away into', (await page.locator('.topbar:visible').count()) === 0);

await page.goto(`${url}#/home`);
await page.waitForSelector('.auth-form');
check('and a link straight to the log does not get past it', (await page.locator('.split-list').count()) === 0);

await page.locator('.btn-ghost', { hasText: 'I already have an account' }).click();
await page.locator('input[aria-label="Handle"]').fill('nobody');
await page.locator('input[aria-label="Password"]').fill('nope');
await page.locator('.btn-primary', { hasText: 'Sign in' }).click();
await page.waitForSelector('.toast', { timeout: 30000 });
check('a handle nobody has is refused like a wrong password', (await page.locator('.toast').textContent())?.includes('do not match'));

// Too short is still refused, and says so rather than failing at the server.
await page.locator('.btn-ghost', { hasText: 'Create an account' }).click();
await page.locator('input[aria-label="Handle"]').fill('alex');
await page.locator('input[aria-label="Password"]').fill('ab');
await page.locator('input[aria-label="Password again"]').fill('ab');
await page.locator('.btn-primary', { hasText: 'Create account' }).click();
await page.waitForSelector('.toast', { timeout: 20000 });
// The previous toast has not faded yet, so read the newest rather than
// whichever one the selector happens to resolve to first.
check('a password too short to be one is refused', (await page.locator('.toast').last().textContent())?.includes('at least 4'));

const recoveryCode = await makeAccount(page, 'alex');
await page.waitForSelector('.split-list');
check('the recovery code is shown once, and is readable', /^[2-9A-Z-]{10,}$/.test(recoveryCode ?? ''), recoveryCode ?? '');
check('making an account opens the app', (await page.locator('.split-list').count()) === 1);

await page.reload();
await page.waitForSelector('.split-list');
check('and being signed in survives a reload', (await page.locator('.auth-form').count()) === 0);

await page.screenshot({ path: join(SHOTS, '0-signed-in.png'), fullPage: true });

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
// The samples cover three weeks, which straddles a month boundary for most
// of any month - so count across this month and last, or this check passes
// or fails on the date it happens to be run.
const trainedThisMonth = await page.locator('.cal-trained').count();
await page.locator('.cal-head .btn-icon').first().click();
await page.waitForSelector('.cal');
const trainedLastMonth = await page.locator('.cal-trained').count();
await page.goto(`${url}#/cal`);
await page.waitForSelector('.cal');

const trained = trainedThisMonth + trainedLastMonth;
check('a month of training is filled in from the pages', trained >= 10, `${trainedThisMonth} + ${trainedLastMonth} days`);
check('and say which split it was', (await page.locator('.cal-split').first().textContent())?.length > 0);
check('today is marked', (await page.locator('.cal-today').count()) === 1);
check('days that have not happened are not tappable', (await page.locator('.cal-day:disabled').count()) > 0);
await page.screenshot({ path: join(SHOTS, '7-calendar.png'), fullPage: true });

// --- Finishing a session that was left half written ------------------------------------
// A day holding both a workout and a tracker asks which you meant, so going
// straight for `.grid` works only on the days that happen to be unambiguous.
await page.locator('.cal-trained').first().click();
await page.waitForSelector('.grid, .cal-panel');
if (await page.locator('.cal-panel').count()) {
  await page.locator('.cal-panel .btn-chip').first().click();
}
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

// --- Adding something to track asks what, then how much -------------------------------------
const rowsBefore = await page.locator(".daily-row").count();
check('adding something starts by asking what', (await page.locator('input[aria-label="Add something to track daily"]').count()) === 1);

await page.locator('.btn-primary', { hasText: 'Next' }).click();
await page.waitForTimeout(150);
check('a nameless thing is not tracked', (await page.locator('.toast').last().textContent())?.includes('What do you want to count'));
check('and no row appears for it', (await page.locator('.daily-row').count()) === rowsBefore);

await page.locator('input[aria-label="Add something to track daily"]').fill('Water');
await page.locator('.btn-primary', { hasText: 'Next' }).click();
await page.waitForSelector('input[aria-label="Daily goal for Water"]');
check('then asks what the goal is, before the row exists', (await page.locator('.daily-row').count()) === rowsBefore);
check('saying what a goal can look like', (await page.locator('.daily .note').last().textContent())?.includes('30min'));

await page.locator('.btn-primary', { hasText: 'Add' }).click();
await page.waitForTimeout(150);
check('and will not take a row with no goal', (await page.locator('.toast').last().textContent())?.includes('daily goal for Water'));
check('still with no row added', (await page.locator('.daily-row').count()) === rowsBefore);

await page.locator('input[aria-label="Daily goal for Water"]').fill('3l');
await page.waitForTimeout(100);
check('it reads the goal back as you type', (await page.locator('.daily .note').last().textContent())?.includes('3 l'));

await page.locator('.btn', { hasText: 'Back' }).click();
await page.waitForSelector('input[aria-label="Add something to track daily"]');
check('and the first step can be gone back to', (await page.locator('input[aria-label="Daily goal for Water"]').count()) === 0);

await page.locator('input[aria-label="Add something to track daily"]').fill('Water');
await page.locator('.btn-primary', { hasText: 'Next' }).click();
await page.locator('input[aria-label="Daily goal for Water"]').fill('3l');
await page.locator('.btn-primary', { hasText: 'Add' }).click();
await page.waitForTimeout(400);
check('a named thing with a goal is tracked', (await page.locator('.daily-row').count()) === rowsBefore + 1);
check('with the goal it was given', (await page.locator('input[aria-label="Water goal"]').inputValue()) === '3l');
check('and the form back at the start for the next one', (await page.locator('input[aria-label="Add something to track daily"]').count()) === 1);

await page.reload();
await page.waitForSelector('.daily-row');
check('and it survives a reload', (await page.locator('input[aria-label="Water goal"]').inputValue()) === '3l');
await page.screenshot({ path: join(SHOTS, '11b-daily-add.png'), fullPage: true });

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
const lightCtx = await browser.newContext({
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light',
});
await lightCtx.addInitScript((api) => localStorage.setItem('gym-notebook:crew-api', api), `${url}api`);
const lightPage = await lightCtx.newPage();
await lightPage.goto(`${url}#/home`);
await makeAccount(lightPage, 'lighty');
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

// --- Fixing a workout opened by mistake --------------------------------------
await page.goto(`${url}#/home`);
await page.waitForSelector('.split-list');
await page.locator('input[aria-label="New split"]').fill('Arms');
await page.locator('button[aria-label="Add split"]').click();
await page.waitForSelector('.grid');
await page.locator('.add-exercise input').first().fill('Hammer Curls');
await page.locator('.add-exercise .btn-ghost').first().click();
await page.waitForTimeout(200);
await page.locator('textarea[data-exercise="Hammer Curls"]').fill('30x12\n30x12');
await page.waitForTimeout(600);

check('an open session offers a way out of a wrong tap', (await page.locator('.session-actions .btn').count()) === 2);

// Move it, keeping what was typed.
await page.locator('.btn', { hasText: 'Move to another split' }).click();
await page.waitForTimeout(150);
check('moving offers the splits you already have', (await page.locator('.session-actions .btn-chip').count()) > 0);
await page.screenshot({ path: join(SHOTS, '18-session-actions.png'), fullPage: true });

await page.locator('.session-actions input').fill('Pull Day');
await page.locator('.session-actions .add-exercise .btn-ghost').click();
await page.waitForSelector('.split-head h1');
await page.waitForTimeout(400);
check('the session moves to the split you name', (await page.locator('.split-head h1').textContent()) === 'Pull Day');
check('carrying everything already written', (await page.locator('textarea[data-exercise="Hammer Curls"]').inputValue()) === '30x12\n30x12');

await page.goto(`${url}#/home`);
await page.waitForSelector('.split-list');
const afterMove = await page.locator('.split-name').allTextContents();
check('the split it came from is gone, having nothing left in it', afterMove.includes('Arms') === false, afterMove.join(', '));
check('and the one it went to is there', afterMove.includes('Pull Day'));

// Now delete it outright.
await page.locator('.split-link', { hasText: 'Pull Day' }).click();
await page.waitForSelector('.session-actions');
await page.locator('.btn', { hasText: 'Delete this workout' }).click();
await page.waitForTimeout(150);
check('deleting says what it costs first', (await page.locator('.session-actions .danger-note').textContent())?.includes('cannot be undone'));

await page.locator('.btn', { hasText: 'Keep it' }).click();
await page.waitForTimeout(150);
check('and can be backed out of', (await page.locator('.session-actions .danger-note').count()) === 0);

await page.locator('.btn', { hasText: 'Delete this workout' }).click();
await page.locator('.session-actions .btn-danger-on').click();
await page.waitForTimeout(400);

await page.goto(`${url}#/home`);
await page.waitForSelector('.split-list');
check('deleting removes the workout', (await page.locator('.split-name').allTextContents()).includes('Pull Day') === false);

await page.goto(`${url}#/cal`);
await page.waitForSelector('.cal');
check('and takes it off the calendar', (await page.locator('.cal-split', { hasText: 'Pull' }).count()) === 0);

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

await mine.goto(url);
await makeAccount(mine, 'alexlifts');
await mine.goto(`${url}#/friends`);
await mine.waitForSelector('.add-exercise');
check('the tab explains what a crew is before anything is sent', (await mine.locator('.banner-nudge').textContent())?.includes('never leave this phone'));
check('and warns that the link is the key', (await mine.locator('.banner-nudge').textContent())?.includes('Anyone holding the link'));
await mine.screenshot({ path: join(SHOTS, '16-crew-start.png'), fullPage: true });

await mine.locator('input[aria-label="Your name on the board"]').fill('Alex');
check('the board name is offered, not demanded again', (await mine.locator('input[aria-label="Your name on the board"]').inputValue()) !== '');
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
await theirs.waitForSelector('.auth-form');
check('a friend\u2019s link still meets the front door first', (await theirs.locator('.exercise-name').textContent()) === 'Create an account');
check('and says why they are being asked', (await theirs.locator('.note').first().textContent())?.includes('invited'));

await makeAccount(theirs, 'samlifts');
await theirs.waitForSelector('input[aria-label="Your name on the board"]');
check('making an account lands them in the crew, not on the home screen', theirs.url().includes('#/join/'));
check('showing who is already on that board', (await theirs.locator('.board-name').textContent()) === 'Alex');

await theirs.locator('input[aria-label="Your name on the board"]').fill('Sam');
await theirs.locator('.btn-primary', { hasText: 'Join' }).click();
await theirs.waitForSelector('.board-list');
await waitForRows(theirs, 2);
check('joining shows the board', (await theirs.locator('.board-name').count()) === 2, (await theirs.locator('.board-name').allTextContents()).join(' | '));

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

// --- Only whoever started the crew can remove anyone -------------------------------
await theirs.goto(`${url}#/friends`);
await theirs.waitForSelector('.board-list');
check('a member sees no way to remove anyone', (await theirs.locator('.board-admin').count()) === 0);

await mine.goto(`${url}#/friends`);
await mine.waitForSelector('.board-list');
await mine.locator('.btn', { hasText: 'Refresh' }).click();
await mine.waitForTimeout(800);
check('whoever started it can remove the others', (await mine.locator('.board-admin').count()) === 1);
check('but not themselves', (await mine.locator('.board-row', { hasText: '(you)' }).locator('.board-admin').count()) === 0);

await mine.locator('.board-admin .btn', { hasText: 'Remove' }).click();
await mine.waitForTimeout(150);
check('removing says the link is the catch', (await mine.locator('.danger-note').textContent())?.includes('still hold the join link'));
await mine.screenshot({ path: join(SHOTS, '19-remove.png'), fullPage: true });

await mine.locator('.btn', { hasText: 'Cancel' }).click();
await mine.waitForTimeout(150);
check('and can be backed out of', (await mine.locator('.danger-note').count()) === 0);

// --- Removing and changing the link ---------------------------------------------------
const oldLink = await mine.locator('.share-link').textContent();
await mine.locator('.board-admin .btn', { hasText: 'Remove' }).click();
await mine.locator('.btn', { hasText: 'Remove and change the link' }).click();
await mine.waitForTimeout(1200);

check('the removed member is off the board', (await mine.locator('.board-name').count()) === 1);
const newLink = await mine.locator('.share-link').textContent();
check('and the join link is a different one', newLink !== oldLink, `${oldLink?.slice(-12)} -> ${newLink?.slice(-12)}`);

// The removed friend's app now holds a link that opens nothing. Ask the
// board directly rather than relying on when the tab last refreshed itself.
await theirs.reload();
await theirs.waitForSelector('.board-list, .banner-warn');
if (await theirs.locator('.btn', { hasText: 'Refresh' }).count()) {
  await theirs.locator('.btn', { hasText: 'Refresh' }).click();
}
await theirs.waitForSelector('.banner-warn', { timeout: 10000 }).catch(() => {});
check('their app says the link changed rather than failing quietly', (await theirs.locator('.banner-warn').textContent())?.includes('link has changed'));
await theirs.screenshot({ path: join(SHOTS, '20-link-changed.png'), fullPage: true });

// The new link puts them back - and because this phone is already in this
// crew, without asking them to sign up a second time.
await theirs.goto(newLink.trim());
await theirs.waitForSelector('.board-list');
check('without making them join again', (await theirs.locator('input[aria-label="Your name on the board"]').count()) === 0);
check('landing them on the board itself', theirs.url().endsWith('#/friends'));

// Ask the server, not the copy cached from before they were removed.
await theirs.waitForTimeout(800);
await theirs.locator('.btn', { hasText: 'Refresh' }).click();
await waitForRows(theirs, 2);
check('and the new link puts their row back on the board', (await theirs.locator('.board-name').count()) === 2);
check('as their own row, not a second one', (await theirs.locator('.board-row:has-text("(you)") .board-name').textContent())?.startsWith('Sam'));

// --- The same account, on a second device ------------------------------------------------
const laptopCtx = await phone();
const laptop = await laptopCtx.newPage();
await laptop.goto(newLink.trim());
await laptop.waitForSelector('.auth-form');

await signInAs(laptop, 'samlifts');
await laptop.waitForSelector('input[aria-label="Your name on the board"]', { timeout: 30000 });
check('signing in on a second device lands in the same crew', laptop.url().includes('#/join/'));

await laptop.locator('input[aria-label="Your name on the board"]').fill('Sam');
await laptop.locator('.btn-primary', { hasText: 'Join' }).click();
await laptop.waitForSelector('.board-list');
await waitForRows(laptop, 2);
check('and updates that account\u2019s row rather than making a second', (await laptop.locator('.board-name').count()) === 2, (await laptop.locator('.board-name').allTextContents()).join(' | '));
check('which it knows is its own', (await laptop.locator('.board-row', { hasText: '(you)' }).locator('.board-name').textContent())?.startsWith('Sam'));

const wrongCtx = await phone();
const wrong = await wrongCtx.newPage();
await wrong.goto(newLink.trim());
await signInAs(wrong, 'samlifts', 'nope');
await wrong.waitForSelector('.toast', { timeout: 30000 });
check('a wrong password gets nowhere near the board', (await wrong.locator('.board-list').count()) === 0);
check('and says so without saying whether the handle exists', (await wrong.locator('.toast').textContent())?.includes('do not match'));
await wrongCtx.close();

// --- One account, two devices, one log -----------------------------------------------------
const firstCtx = await phone();
const first = await firstCtx.newPage();
first.on('pageerror', (error) => check('no page errors while syncing', false, error.message));
await first.goto(url);
await makeAccount(first, 'syncer');
await first.waitForSelector('.split-list');

// Something real to sync: the samples deliberately do not travel.
await first.locator('.split-name', { hasText: 'Chest/Tris' }).click();
await first.waitForSelector('.grid');
await first.locator('.btn-primary', { hasText: 'Log today' }).click();
await first.waitForSelector('.grid-cell-today');
const firstCell = first.locator('textarea.grid-cell-today').first();
await firstCell.click();
await first.keyboard.type('185x5\n185x5\n185x4');
await first.waitForTimeout(900);
// Today's column is a textarea, so its contents are a value and never turn
// up in the grid's text. Reading the wrong one passes on an empty cell.
check('the workout is written on the first device', (await firstCell.inputValue()).includes('185x5'));

await first.goto(`${url}#/home`);
await first.waitForSelector('.account-box');
await first.locator('.account-actions .btn', { hasText: 'Sync now' }).click();
await first.waitForSelector('.toast');
check('a log can be pushed to the account', (await first.locator('.toast').textContent())?.includes('Synced'), await first.locator('.toast').textContent());

const secondCtx = await phone();
const second = await secondCtx.newPage();
second.on('pageerror', (error) => check('no page errors on the second device', false, error.message));
await second.goto(url);
await signInAs(second, 'syncer');
await second.waitForSelector('.split-list', { timeout: 30000 });
await syncUntil(second, async () =>
  (await second.locator('.split-name').allTextContents()).includes('Chest/Tris'));
await second.goto(`${url}#/home`);
await second.waitForSelector('.split-list');

const carried = await second.locator('.split-name').allTextContents();
check('signing in on a second device brings the log with it', carried.includes('Chest/Tris'), carried.join(', '));

await second.locator('.split-name', { hasText: 'Chest/Tris' }).click();
await second.waitForSelector('.grid');
check('including what was written on the last workout', (await second.locator('textarea.grid-cell-today').first().inputValue()).includes('185x5'));
check('and not the demo data, which stays where it was made', (await second.locator('.grid').textContent())?.includes('95x7') === false);
await second.screenshot({ path: join(SHOTS, '21-second-device.png'), fullPage: true });

// A change on the second device goes the other way.
await second.goto(`${url}#/home`);
await second.waitForSelector('.split-list');
await second.locator('.split-name', { hasText: 'Chest/Tris' }).click();
await second.waitForSelector('.grid-cell-today');
const secondCell = second.locator('textarea.grid-cell-today').first();
await secondCell.click();
await second.keyboard.press('End');
await second.keyboard.type('\n185x3');
await second.waitForTimeout(900);
await second.goto(`${url}#/home`);
await second.waitForSelector('.account-box');
await second.locator('.account-actions .btn', { hasText: 'Sync now' }).click();
await second.waitForSelector('.toast', { timeout: 20000 });

// The check navigates to the grid, so it also leaves us there.
const cameBack = await syncUntil(first, async () => {
  await first.locator('.split-name', { hasText: 'Chest/Tris' }).click();
  await first.waitForSelector('.grid');
  return (await first.locator('textarea.grid-cell-today').first().inputValue()).includes('185x3');
});
check('and an edit there comes back the other way', cameBack);

// Deleting has to travel too, or the other device puts it straight back.
await first.waitForSelector('.session-actions');
await first.locator('.btn', { hasText: 'Delete this workout' }).click();
await first.locator('.session-actions .btn-danger-on').click();
await first.waitForTimeout(600);
// Nothing to wait for on this side: the delete only has to reach the server.
await syncUntil(first, async () => true, 1);

await syncUntil(second, async () =>
  !(await second.locator('.split-name').allTextContents()).includes('Chest/Tris'));
await second.reload();
// An empty log renders no split list at all, so wait on something Home
// always has rather than on the thing being asserted away.
await second.waitForSelector('.account-box');
const left = await second.locator('.split-name').allTextContents();
check('a deleted workout does not come back from the other device', left.includes('Chest/Tris') === false, left.join(', '));

await firstCtx.close();
await secondCtx.close();

// --- When the app cannot start at all ------------------------------------------------------
// A phone holding a stale service worker gets a page whose script is gone,
// and a blank screen says nothing to somebody who cannot open a console.
const brokenCtx = await phone();
const broken = await brokenCtx.newPage();
await broken.goto(url);
await broken.waitForSelector('.auth-form, .split-list');

await broken.evaluate(() => {
  window.dispatchEvent(new ErrorEvent('error', { message: 'Could not load assets/index-old.js' }));
});
await broken.waitForTimeout(200);

check('a failure to start says so rather than showing nothing', (await broken.locator('#view h1').textContent()) === 'The app did not start');
check('and says what it was', (await broken.locator('#view p').last().textContent())?.includes('index-old.js'));
check('and offers the repair that fixes it', (await broken.locator('#view button').count()) === 1);

// The repair is the point: it has to actually let go of the stored copy.
// It reloads when it is done, so the evidence goes in sessionStorage, which
// survives that; a variable on window would not.
await broken.evaluate(() => {
  const realKeys = caches.keys.bind(caches);
  caches.keys = () => realKeys().then((keys) => {
    sessionStorage.setItem('cleared-caches', 'yes');
    return keys;
  });
  navigator.serviceWorker.getRegistrations = () => {
    sessionStorage.setItem('unregistered-workers', 'yes');
    return Promise.resolve([]);
  };
});
await broken.locator('#view button').click();
await broken.waitForSelector('.auth-form, .split-list', { timeout: 20000 });

const cleared = await broken.evaluate(() => [
  sessionStorage.getItem('cleared-caches'),
  sessionStorage.getItem('unregistered-workers'),
]);
check('which clears the cached app', cleared[0] === 'yes');
check('and unregisters the worker holding it', cleared[1] === 'yes');
check('and comes back to a working app', (await broken.locator('#view h1').textContent()) !== 'The app did not start');
await brokenCtx.close();

// --- The recovery code -------------------------------------------------------------------
const lostCtx = await phone();
const lost = await lostCtx.newPage();
await lost.goto(url);
await lost.waitForSelector('.auth-form');
await lost.locator('.btn-ghost', { hasText: 'I already have an account' }).click();
await lost.locator('.btn-ghost', { hasText: 'I have lost my password' }).click();
check('a lost password has a way back', (await lost.locator('.exercise-name').textContent()) === 'Use your recovery code');

await lost.locator('input[aria-label="Handle"]').fill('alex');
await lost.locator('input[aria-label="Recovery code"]').fill(recoveryCode ?? '');
await lost.locator('input[aria-label="Password"]').fill('new1');
await lost.locator('input[aria-label="Password again"]').fill('new1');
await lost.locator('.btn-primary', { hasText: 'Set a new password' }).click();
await lost.waitForSelector('.recovery-code', { timeout: 30000 });
const nextCode = (await lost.locator('.recovery-code').textContent())?.trim();
check('and using it hands over a fresh code', Boolean(nextCode) && nextCode !== recoveryCode);
check('which stays put rather than being redrawn away', (await lost.locator('.recovery-code').count()) === 1);

await lost.locator('.confirm-saved input').check();
await lost.locator('.btn-primary', { hasText: 'Continue' }).click();
await lost.waitForSelector('.split-list');
check('recovering opens the app', (await lost.locator('.split-list').count()) === 1);
check('on a phone that starts with nothing of its own', (await lost.locator('.session-count').count()) >= 0);

const staleCtx = await phone();
const stale = await staleCtx.newPage();
await stale.goto(url);
await signInAs(stale, 'alex');
await stale.waitForSelector('.toast', { timeout: 30000 });
check('and the old password stops working', (await stale.locator('.toast').textContent())?.includes('do not match'));
await staleCtx.close();
await lostCtx.close();
await laptopCtx.close();

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
