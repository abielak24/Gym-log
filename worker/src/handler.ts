/**
 * The crew API: three routes and the rules around them.
 *
 * There are no accounts. A crew is a secret in a link, and a member is a
 * token generated on a phone. That is enough for a handful of friends and
 * keeps every password problem out of the project — the trade being that
 * anyone holding the link is in the crew, which the app says plainly before
 * anyone posts anything.
 */

import type { Store } from './store';

/** A crew nobody can meaningfully grow beyond a group of friends. */
const MAX_MEMBERS = 30;
/** A summary is a few kB; anything far past that is not one. */
const MAX_SUMMARY_BYTES = 64 * 1024;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,x-crew-secret,x-member-token',
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
  await deps.store.createCrew(id, await deps.hash(secret), deps.now());
  return json({ crewId: id, secret }, 201);
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

  // A member id is claimed by the first token to use it, and only that token
  // can post as it again. Nobody can overwrite somebody else's row.
  if (existing && existing.tokenHash !== tokenHash) return json({ error: 'not your member id' }, 403);
  if (!existing && (await deps.store.countMembers(crewId)) >= MAX_MEMBERS) {
    return json({ error: 'crew is full' }, 409);
  }

  await deps.store.putMember(crewId, {
    memberId,
    tokenHash,
    name: String(parsed.name).slice(0, 40),
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

  const tokenHash = await deps.hash(request.headers.get('x-member-token') ?? '');
  if (existing.tokenHash !== tokenHash) return json({ error: 'not your member id' }, 403);

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
