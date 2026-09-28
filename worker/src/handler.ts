/**
 * The API: accounts, sessions, and the crew board that hangs off them.
 *
 * An account is the front door. Everything else identifies you by the
 * session token it issues, which is why there is no per-crew password
 * anywhere below: you are the same person on every board you are on.
 *
 * The password itself never arrives here. The phone derives a key from it
 * with the account's salt and sends that; this stores only a fast hash of
 * the key. Slow work happens on the device, which has time to spare, rather
 * than in a worker billed by the millisecond.
 */

import { nameKey, type AccountRow, type Store } from './store';

/** A crew nobody can meaningfully grow beyond a group of friends. */
const MAX_MEMBERS = 30;
/** A summary is a few kB; anything far past that is not one. */
const MAX_SUMMARY_BYTES = 64 * 1024;
/** Wrong passwords allowed for one handle before it goes quiet. */
const MAX_ATTEMPTS = 10;
/** How long that lasts. */
const ATTEMPT_WINDOW = 15 * 60 * 1000;
/** Where the secret behind unknown-handle salts is kept. */
const SALT_SECRET = 'salt-secret';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,x-crew-secret,x-account-token',
  'access-control-max-age': '86400',
};

export interface Deps {
  store: Store;
  now(): number;
  randomId(): string;
  hash(value: string): Promise<string>;
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

  try {
    if (request.method === 'POST' && path === '/account') return await signUp(request, deps);
    if (request.method === 'POST' && path === '/account/salt') return await readSalt(request, deps);
    if (request.method === 'POST' && path === '/account/recover') return await recover(request, deps);
    if (request.method === 'PUT' && path === '/account/name') return await renameAccount(request, deps);
    if (request.method === 'POST' && path === '/session') return await logIn(request, deps);
    if (request.method === 'DELETE' && path === '/session') return await logOut(request, deps);
    if (request.method === 'GET' && path === '/me') return await whoAmI(request, deps);

    if (request.method === 'POST' && path === '/crew') return await createCrew(request, deps);

    const rotate = /^\/crew\/([A-Za-z0-9_-]{1,64})\/rotate$/.exec(path);
    if (rotate && request.method === 'POST') return await rotateSecret(request, deps, rotate[1]);

    const mine = /^\/crew\/([A-Za-z0-9_-]{1,64})\/member$/.exec(path);
    if (mine && request.method === 'PUT') return await putMember(request, deps, mine[1]);
    if (mine && request.method === 'DELETE') return await leaveCrew(request, deps, mine[1]);

    const member = /^\/crew\/([A-Za-z0-9_-]{1,64})\/member\/([A-Za-z0-9_-]{1,64})$/.exec(path);
    if (member && request.method === 'DELETE') return await removeMember(request, deps, member[1], member[2]);

    const crew = /^\/crew\/([A-Za-z0-9_-]{1,64})$/.exec(path);
    if (crew && request.method === 'GET') return await readCrew(request, deps, crew[1]);

    return json({ error: 'not found' }, 404);
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
}

/* Accounts ------------------------------------------------------------------ */

async function signUp(request: Request, deps: Deps): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: 'expected an account' }, 400);

  const handle = text(body.handle).slice(0, 40);
  const salt = text(body.salt);
  const key = text(body.key);
  const recovery = text(body.recovery);
  if (!handle || !salt || !key || !recovery) return json({ error: 'expected a handle, a salt, a key and a recovery code' }, 400);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(handle)) {
    return json({ error: 'a handle is 3 to 40 letters, numbers, dots, dashes or underscores' }, 400);
  }

  const key_ = nameKey(handle);
  if (await deps.store.getAccountByHandle(key_)) return json({ error: 'that handle is taken' }, 409);

  const id = deps.randomId();
  await deps.store.createAccount({
    id,
    handleKey: key_,
    handle,
    displayName: text(body.displayName).slice(0, 40) || handle,
    salt,
    keyHash: await deps.hash(key),
    recoveryHash: await deps.hash(recovery),
    createdAt: deps.now(),
  });

  return json({ ...(await issue(deps, id)), handle, displayName: text(body.displayName) || handle }, 201);
}

/**
 * The salt for a handle, so the phone can derive a key to send.
 *
 * A handle nobody has still gets one, worked out from the handle and a
 * secret this server keeps. It is stable, so a wrong handle looks exactly
 * like a wrong password rather than telling a stranger who has an account.
 */
async function readSalt(request: Request, deps: Deps): Promise<Response> {
  const body = await readJson(request);
  const handle = text(body?.handle);
  if (!handle) return json({ error: 'expected a handle' }, 400);

  const account = await deps.store.getAccountByHandle(nameKey(handle));
  if (account) return json({ salt: account.salt });

  let secret = await deps.store.getSetting(SALT_SECRET);
  if (!secret) {
    secret = deps.randomId();
    await deps.store.putSetting(SALT_SECRET, secret);
    secret = (await deps.store.getSetting(SALT_SECRET)) ?? secret;
  }
  return json({ salt: await deps.hash(`${secret}:${nameKey(handle)}`) });
}

async function logIn(request: Request, deps: Deps): Promise<Response> {
  const body = await readJson(request);
  const handle = text(body?.handle);
  const key = text(body?.key);
  if (!handle || !key) return json({ error: 'expected a handle and a key' }, 400);

  const folded = nameKey(handle);
  if (await tooManyAttempts(deps, folded)) {
    return json({ error: 'too many attempts; wait a few minutes and try again' }, 429);
  }

  const account = await deps.store.getAccountByHandle(folded);
  // One answer for a handle nobody has and a password that is wrong.
  if (!account || account.keyHash !== (await deps.hash(key))) {
    await countAttempt(deps, folded);
    return json({ error: 'that handle and password do not match' }, 403);
  }

  await deps.store.clearAttempts(folded);
  return json({ ...(await issue(deps, account.id)), handle: account.handle, displayName: account.displayName });
}

/**
 * Back in with the code shown at sign-up.
 *
 * There is no email here, so this is the only way back. It replaces the
 * password, the salt and the code itself, and signs out every device that
 * was using the old one - somebody recovering an account may be doing it
 * because a phone is gone.
 */
async function recover(request: Request, deps: Deps): Promise<Response> {
  const body = await readJson(request);
  const handle = text(body?.handle);
  const recovery = text(body?.recovery);
  const salt = text(body?.salt);
  const key = text(body?.key);
  const nextRecovery = text(body?.nextRecovery);
  if (!handle || !recovery || !salt || !key || !nextRecovery) {
    return json({ error: 'expected a handle, a recovery code and a new password' }, 400);
  }

  const folded = nameKey(handle);
  if (await tooManyAttempts(deps, folded)) {
    return json({ error: 'too many attempts; wait a few minutes and try again' }, 429);
  }

  const account = await deps.store.getAccountByHandle(folded);
  if (!account || account.recoveryHash !== (await deps.hash(recovery))) {
    await countAttempt(deps, folded);
    return json({ error: 'that handle and recovery code do not match' }, 403);
  }

  await deps.store.updateAccount(account.id, {
    salt,
    keyHash: await deps.hash(key),
    recoveryHash: await deps.hash(nextRecovery),
  });
  await deps.store.deleteSessionsFor(account.id);
  await deps.store.clearAttempts(folded);

  return json({ ...(await issue(deps, account.id)), handle: account.handle, displayName: account.displayName });
}

async function renameAccount(request: Request, deps: Deps): Promise<Response> {
  const account = await requireAccount(request, deps);
  if (account instanceof Response) return account;

  const body = await readJson(request);
  const displayName = text(body?.displayName).slice(0, 40);
  if (!displayName) return json({ error: 'expected a name' }, 400);

  await deps.store.updateAccount(account.id, { displayName });
  return json({ displayName });
}

async function whoAmI(request: Request, deps: Deps): Promise<Response> {
  const account = await requireAccount(request, deps);
  if (account instanceof Response) return account;
  return json({ accountId: account.id, handle: account.handle, displayName: account.displayName });
}

async function logOut(request: Request, deps: Deps): Promise<Response> {
  const token = request.headers.get('x-account-token') ?? '';
  if (token) await deps.store.deleteSession(await deps.hash(token));
  return json({ ok: true });
}

async function issue(deps: Deps, accountId: string): Promise<{ accountId: string; token: string }> {
  const token = deps.randomId();
  await deps.store.createSession({ tokenHash: await deps.hash(token), accountId, createdAt: deps.now() });
  return { accountId, token };
}

/** Whoever this request is, or the refusal to send back. */
async function requireAccount(request: Request, deps: Deps): Promise<AccountRow | Response> {
  const token = request.headers.get('x-account-token') ?? '';
  if (!token) return json({ error: 'not signed in' }, 401);

  const session = await deps.store.getSession(await deps.hash(token));
  if (!session) return json({ error: 'not signed in' }, 401);

  const account = await deps.store.getAccount(session.accountId);
  if (!account) return json({ error: 'not signed in' }, 401);
  return account;
}

async function tooManyAttempts(deps: Deps, handleKey: string): Promise<boolean> {
  const row = await deps.store.getAttempts(handleKey);
  if (!row) return false;
  if (deps.now() - row.windowStart > ATTEMPT_WINDOW) return false;
  return row.count >= MAX_ATTEMPTS;
}

async function countAttempt(deps: Deps, handleKey: string): Promise<void> {
  const row = await deps.store.getAttempts(handleKey);
  const fresh = !row || deps.now() - row.windowStart > ATTEMPT_WINDOW;
  await deps.store.putAttempts({
    handleKey,
    count: fresh ? 1 : row.count + 1,
    windowStart: fresh ? deps.now() : row.windowStart,
  });
}

/* Crews --------------------------------------------------------------------- */

async function createCrew(request: Request, deps: Deps): Promise<Response> {
  const account = await requireAccount(request, deps);
  if (account instanceof Response) return account;

  const id = deps.randomId();
  const secret = deps.randomId();
  await deps.store.createCrew({ id, secretHash: await deps.hash(secret), ownerAccountId: account.id }, deps.now());
  return json({ crewId: id, secret }, 201);
}

/**
 * A new secret, and with it a new join link.
 *
 * Removing somebody is theatre while they still hold the old link, so this
 * exists to make it stick. Everyone else needs re-inviting, which is the
 * honest cost and is said plainly in the app.
 */
async function rotateSecret(request: Request, deps: Deps, crewId: string): Promise<Response> {
  const owner = await requireOwner(request, deps, crewId);
  if (owner instanceof Response) return owner;

  const secret = deps.randomId();
  await deps.store.setCrewSecret(crewId, await deps.hash(secret));
  return json({ secret });
}

async function putMember(request: Request, deps: Deps, crewId: string): Promise<Response> {
  const account = await requireAccount(request, deps);
  if (account instanceof Response) return account;

  const allowed = await openCrew(request, deps, crewId);
  if (allowed instanceof Response) return allowed;

  const body = await request.text();
  if (body.length > MAX_SUMMARY_BYTES) return json({ error: 'summary too large' }, 413);

  let parsed: { name?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: 'summary is not json' }, 400);
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string') {
    return json({ error: 'summary needs a name' }, 400);
  }

  const existing = await deps.store.getMember(crewId, account.id);
  if (!existing && (await deps.store.countMembers(crewId)) >= MAX_MEMBERS) {
    return json({ error: 'crew is full' }, 409);
  }

  // A row belongs to an account, so posting again can only ever update your
  // own. Two people sharing a name is now cosmetic rather than ambiguous.
  const name = String(parsed.name).slice(0, 40);
  const clash = await deps.store.findMemberByName(crewId, nameKey(name));
  if (clash && clash.accountId !== account.id) return json({ error: 'that name is taken' }, 409);

  await deps.store.putMember(crewId, {
    accountId: account.id,
    name,
    nameKey: nameKey(name),
    summary: body,
    updatedAt: deps.now(),
  });

  return json({ ok: true, accountId: account.id });
}

async function leaveCrew(request: Request, deps: Deps, crewId: string): Promise<Response> {
  const account = await requireAccount(request, deps);
  if (account instanceof Response) return account;

  await deps.store.deleteMember(crewId, account.id);
  return json({ ok: true });
}

async function removeMember(request: Request, deps: Deps, crewId: string, accountId: string): Promise<Response> {
  const owner = await requireOwner(request, deps, crewId);
  if (owner instanceof Response) return owner;
  if (owner.id === accountId) return json({ error: 'you cannot remove yourself' }, 400);

  await deps.store.deleteMember(crewId, accountId);
  return json({ ok: true });
}

async function readCrew(request: Request, deps: Deps, crewId: string): Promise<Response> {
  const allowed = await openCrew(request, deps, crewId);
  if (allowed instanceof Response) return allowed;

  const crew = allowed;
  const members = await deps.store.listMembers(crewId);
  return json({
    ownerAccountId: crew.ownerAccountId,
    members: members.map((member) => ({
      memberId: member.accountId,
      name: member.name,
      updatedAt: member.updatedAt,
      summary: safeParse(member.summary),
    })),
  });
}

/** The link is what opens a crew, exactly as it always was. */
async function openCrew(request: Request, deps: Deps, crewId: string) {
  const secret = request.headers.get('x-crew-secret') ?? '';
  if (!secret) return json({ error: 'missing crew secret' }, 401);

  const crew = await deps.store.getCrew(crewId);
  // The same answer either way, so the endpoint cannot be used to find out
  // which crew ids exist.
  if (!crew || crew.secretHash !== (await deps.hash(secret))) return json({ error: 'no such crew' }, 404);
  return crew;
}

async function requireOwner(request: Request, deps: Deps, crewId: string): Promise<AccountRow | Response> {
  const account = await requireAccount(request, deps);
  if (account instanceof Response) return account;

  const crew = await openCrew(request, deps, crewId);
  if (crew instanceof Response) return crew;

  if (crew.ownerAccountId !== account.id) {
    return json({ error: 'only whoever started the crew can do that' }, 403);
  }
  return account;
}

/* Odds and ends ------------------------------------------------------------- */

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}
