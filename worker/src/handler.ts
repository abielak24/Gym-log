/**
 * The crew API: three routes and the rules around them.
 *
 * There are no accounts. A crew is a secret in a link, and a member is a
 * token generated on a phone. That is enough for a handful of friends and
 * keeps every password problem out of the project — the trade being that
 * anyone holding the link is in the crew, which the app says plainly before
 * anyone posts anything.
 */

import { nameKey, type Store } from './store';

/** A crew nobody can meaningfully grow beyond a group of friends. */
const MAX_MEMBERS = 30;
/** A summary is a few kB; anything far past that is not one. */
const MAX_SUMMARY_BYTES = 64 * 1024;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'access-control-allow-headers':
    'content-type,x-crew-secret,x-member-token,x-member-passcode,x-admin-token',
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
    if (request.method === 'POST' && path === '/crew') return await createCrew(deps);

    const claim = /^\/crew\/([A-Za-z0-9_-]{1,64})\/claim$/.exec(path);
    if (claim && request.method === 'POST') return await claimMember(request, deps, claim[1]);

    const rotate = /^\/crew\/([A-Za-z0-9_-]{1,64})\/rotate$/.exec(path);
    if (rotate && request.method === 'POST') return await rotateSecret(request, deps, rotate[1]);

    const member = /^\/crew\/([A-Za-z0-9_-]{1,64})\/member\/([A-Za-z0-9_-]{1,64})$/.exec(path);
    if (member && request.method === 'PUT') return await putMember(request, deps, member[1], member[2]);
    if (member && request.method === 'DELETE') return await deleteMember(request, deps, member[1], member[2]);

    const crew = /^\/crew\/([A-Za-z0-9_-]{1,64})$/.exec(path);
    if (crew && request.method === 'GET') return await readCrew(request, deps, crew[1]);

    return json({ error: 'not found' }, 404);
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
}

async function createCrew(deps: Deps): Promise<Response> {
  const id = deps.randomId();
  const secret = deps.randomId();
  // Only the phone that makes the crew ever sees this, and it is what
  // separates the person who can remove members from everyone else.
  const adminToken = deps.randomId();

  await deps.store.createCrew(id, await deps.hash(secret), await deps.hash(adminToken), deps.now());
  return json({ crewId: id, secret, adminToken }, 201);
}

/**
 * Take over your own row from a second device.
 *
 * The member token proves a device, not a person, so a new phone needs
 * something else: the name on the board and the passcode set with it.
 */
async function claimMember(request: Request, deps: Deps, crewId: string): Promise<Response> {
  const crew = await authorise(request, deps, crewId);
  if (crew instanceof Response) return crew;

  const token = request.headers.get('x-member-token') ?? '';
  if (!token) return json({ error: 'missing member token' }, 401);

  let body: { name?: unknown; passcode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'expected a name and a passcode' }, 400);
  }

  const name = typeof body.name === 'string' ? body.name : '';
  const passcode = typeof body.passcode === 'string' ? body.passcode : '';
  if (!name || !passcode) return json({ error: 'expected a name and a passcode' }, 400);

  const member = await deps.store.findMemberByName(crewId, nameKey(name));
  // One answer for "no such name" and "wrong passcode", so this cannot be
  // used to find out who is on a board.
  const wrong = json({ error: 'that name and passcode do not match' }, 403);
  if (!member || !member.passcodeHash) return wrong;
  if (member.passcodeHash !== (await deps.hash(passcode))) return wrong;

  await deps.store.setMemberToken(crewId, member.memberId, await deps.hash(token));
  return json({ memberId: member.memberId });
}

/**
 * A new secret, and with it a new join link.
 *
 * Removing somebody is theatre while they still hold the old link, so this
 * exists to make it stick. Everyone else needs re-inviting, which is the
 * honest cost and is said plainly in the app.
 */
async function rotateSecret(request: Request, deps: Deps, crewId: string): Promise<Response> {
  const crew = await requireAdmin(request, deps, crewId);
  if (crew instanceof Response) return crew;

  const secret = deps.randomId();
  await deps.store.setCrewSecret(crewId, await deps.hash(secret));
  return json({ secret });
}

async function putMember(request: Request, deps: Deps, crewId: string, memberId: string): Promise<Response> {
  const crew = await authorise(request, deps, crewId);
  if (crew instanceof Response) return crew;

  const token = request.headers.get('x-member-token') ?? '';
  if (!token) return json({ error: 'missing member token' }, 401);

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

  const tokenHash = await deps.hash(token);
  const existing = await deps.store.getMember(crewId, memberId);

  // A member id belongs to the token that took it, or to whoever knows the
  // passcode set alongside it. Nobody else can overwrite somebody's row.
  if (existing && !(await ownsRow(request, deps, existing, tokenHash))) {
    return json({ error: 'not your member id' }, 403);
  }
  if (!existing && (await deps.store.countMembers(crewId)) >= MAX_MEMBERS) {
    return json({ error: 'crew is full' }, 409);
  }

  const name = String(parsed.name).slice(0, 40);

  // Two people called the same thing would make claiming by name ambiguous.
  const sameName = await deps.store.findMemberByName(crewId, nameKey(name));
  if (sameName && sameName.memberId !== memberId) return json({ error: 'that name is taken' }, 409);

  const passcode = request.headers.get('x-member-passcode') ?? '';

  await deps.store.putMember(crewId, {
    memberId,
    tokenHash,
    // Empty leaves whatever was already set, so posting does not wipe it.
    passcodeHash: passcode ? await deps.hash(passcode) : '',
    name,
    nameKey: nameKey(name),
    summary: body,
    updatedAt: deps.now(),
  });

  return json({ ok: true });
}

async function deleteMember(request: Request, deps: Deps, crewId: string, memberId: string): Promise<Response> {
  const crew = await authorise(request, deps, crewId);
  if (crew instanceof Response) return crew;

  const existing = await deps.store.getMember(crewId, memberId);
  if (!existing) return json({ ok: true });

  // Your own row, or anyone's if you made the crew.
  const tokenHash = await deps.hash(request.headers.get('x-member-token') ?? '');
  const isOwner = await ownsRow(request, deps, existing, tokenHash);
  const isAdmin = await holdsAdminToken(request, deps, crewId);

  if (!isOwner && !isAdmin) return json({ error: 'not your member id' }, 403);

  await deps.store.deleteMember(crewId, memberId);
  return json({ ok: true });
}

async function readCrew(request: Request, deps: Deps, crewId: string): Promise<Response> {
  const crew = await authorise(request, deps, crewId);
  if (crew instanceof Response) return crew;

  const members = await deps.store.listMembers(crewId);
  return json({
    // Token hashes stay on the server; a reader gets what was posted and
    // nothing about how anyone proves who they are.
    members: members.map((member) => ({
      memberId: member.memberId,
      name: member.name,
      updatedAt: member.updatedAt,
      summary: safeParse(member.summary),
    })),
  });
}

async function authorise(request: Request, deps: Deps, crewId: string): Promise<true | Response> {
  const secret = request.headers.get('x-crew-secret') ?? '';
  if (!secret) return json({ error: 'missing crew secret' }, 401);

  const crew = await deps.store.getCrew(crewId);
  // The same answer either way, so the endpoint cannot be used to find out
  // which crew ids exist.
  if (!crew || crew.secretHash !== (await deps.hash(secret))) return json({ error: 'no such crew' }, 404);
  return true;
}

/**
 * Whether this request may write to a row.
 *
 * The token is the usual proof, but it only ever proved a device. A second
 * device claiming the row rebinds the token, which used to lock the first one
 * out for good: its posts failed silently and it could not even leave. The
 * passcode is the person, so it stands in for the token here and both phones
 * keep working.
 */
async function ownsRow(request: Request, deps: Deps, row: { tokenHash: string; passcodeHash: string }, tokenHash: string): Promise<boolean> {
  if (row.tokenHash === tokenHash) return true;

  const passcode = request.headers.get('x-member-passcode') ?? '';
  if (!passcode || !row.passcodeHash) return false;
  return row.passcodeHash === (await deps.hash(passcode));
}

async function holdsAdminToken(request: Request, deps: Deps, crewId: string): Promise<boolean> {
  const token = request.headers.get('x-admin-token') ?? '';
  if (!token) return false;

  const crew = await deps.store.getCrew(crewId);
  if (!crew?.adminTokenHash) return false;
  return crew.adminTokenHash === (await deps.hash(token));
}

async function requireAdmin(request: Request, deps: Deps, crewId: string): Promise<true | Response> {
  const crew = await authorise(request, deps, crewId);
  if (crew instanceof Response) return crew;
  if (!(await holdsAdminToken(request, deps, crewId))) {
    return json({ error: 'only whoever started the crew can do that' }, 403);
  }
  return true;
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
