import { beforeEach, describe, expect, it } from 'vitest';
import { handle, type Deps } from '../worker/src/handler';
import type { MemberRow, Store } from '../worker/src/store';

/** An in-memory Store, so every rule can be tested with nothing deployed. */
function memoryStore(): Store {
  const crews = new Map<string, { id: string; secretHash: string }>();
  const members = new Map<string, Map<string, MemberRow>>();

  return {
    async createCrew(id, secretHash) {
      crews.set(id, { id, secretHash });
    },
    async getCrew(id) {
      return crews.get(id) ?? null;
    },
    async getMember(crewId, memberId) {
      return members.get(crewId)?.get(memberId) ?? null;
    },
    async countMembers(crewId) {
      return members.get(crewId)?.size ?? 0;
    },
    async putMember(crewId, row) {
      const crew = members.get(crewId) ?? new Map<string, MemberRow>();
      crew.set(row.memberId, row);
      members.set(crewId, crew);
    },
    async listMembers(crewId) {
      return [...(members.get(crewId)?.values() ?? [])];
    },
    async deleteMember(crewId, memberId) {
      members.get(crewId)?.delete(memberId);
    },
  };
}

let ids = 0;
let deps: Deps;

beforeEach(() => {
  ids = 0;
  deps = {
    store: memoryStore(),
    now: () => 1_700_000_000_000,
    randomId: () => `id${++ids}`,
    // Not a real digest, but it is one-way enough to prove the rules.
    hash: async (value: string) => `hash(${value})`,
  };
});

const API = 'https://crew.example';

function call(method: string, path: string, options: { secret?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.secret) headers['x-crew-secret'] = options.secret;
  if (options.token) headers['x-member-token'] = options.token;

  return handle(new Request(`${API}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), deps);
}

async function newCrew() {
  const response = await call('POST', '/crew');
  return (await response.json()) as { crewId: string; secret: string };
}

const SUMMARY = { name: 'Alex', daysTrained7: 3, lifts: [{ key: 'bench', name: 'Bench', best: { weight: 225, reps: 5 } }] };

describe('starting a crew', () => {
  it('hands back an id and a secret', async () => {
    const response = await call('POST', '/crew');
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ crewId: 'id1', secret: 'id2' });
  });

  it('never stores the secret itself', async () => {
    const { crewId, secret } = await newCrew();
    const stored = await deps.store.getCrew(crewId);
    expect(stored?.secretHash).not.toBe(secret);
    expect(stored?.secretHash).toBe(`hash(${secret})`);
  });
});

describe('posting a summary', () => {
  it('accepts one from a member of the crew', async () => {
    const { crewId, secret } = await newCrew();
    const response = await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: SUMMARY });
    expect(response.status).toBe(200);
  });

  it('refuses without the crew secret', async () => {
    const { crewId } = await newCrew();
    const response = await call('PUT', `/crew/${crewId}/member/m1`, { token: 't1', body: SUMMARY });
    expect(response.status).toBe(401);
  });

  it('refuses with the wrong crew secret', async () => {
    const { crewId } = await newCrew();
    const response = await call('PUT', `/crew/${crewId}/member/m1`, { secret: 'guess', token: 't1', body: SUMMARY });
    expect(response.status).toBe(404);
  });

  it('refuses without a member token', async () => {
    const { crewId, secret } = await newCrew();
    const response = await call('PUT', `/crew/${crewId}/member/m1`, { secret, body: SUMMARY });
    expect(response.status).toBe(401);
  });

  it('will not let one member overwrite another', async () => {
    const { crewId, secret } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 'mine', body: SUMMARY });

    const response = await call('PUT', `/crew/${crewId}/member/m1`, {
      secret, token: 'theirs', body: { ...SUMMARY, name: 'Impostor' },
    });
    expect(response.status).toBe(403);

    const members = await deps.store.listMembers(crewId);
    expect(members[0].name).toBe('Alex');
  });

  it('lets the same member post again', async () => {
    const { crewId, secret } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: SUMMARY });
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: { ...SUMMARY, daysTrained7: 4 } });

    const members = await deps.store.listMembers(crewId);
    expect(members).toHaveLength(1);
    expect(JSON.parse(members[0].summary).daysTrained7).toBe(4);
  });

  it('refuses a body that is not a summary', async () => {
    const { crewId, secret } = await newCrew();
    expect((await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: { lifts: [] } })).status).toBe(400);
  });

  it('refuses a summary far bigger than a summary', async () => {
    const { crewId, secret } = await newCrew();
    const huge = { name: 'Alex', padding: 'x'.repeat(70_000) };
    expect((await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: huge })).status).toBe(413);
  });

  it('trims a name rather than storing an essay', async () => {
    const { crewId, secret } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: { ...SUMMARY, name: 'A'.repeat(200) } });
    expect((await deps.store.listMembers(crewId))[0].name).toHaveLength(40);
  });

  it('stops the crew growing past a group of friends', async () => {
    const { crewId, secret } = await newCrew();
    for (let i = 0; i < 30; i++) {
      await call('PUT', `/crew/${crewId}/member/m${i}`, { secret, token: `t${i}`, body: SUMMARY });
    }
    const response = await call('PUT', `/crew/${crewId}/member/extra`, { secret, token: 'tx', body: SUMMARY });
    expect(response.status).toBe(409);
  });
});

describe('reading the board', () => {
  it('returns what everyone posted', async () => {
    const { crewId, secret } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: SUMMARY });
    await call('PUT', `/crew/${crewId}/member/m2`, { secret, token: 't2', body: { ...SUMMARY, name: 'Sam' } });

    const body = await (await call('GET', `/crew/${crewId}`, { secret })).json() as { members: Array<{ name: string }> };
    expect(body.members.map((m) => m.name).sort()).toEqual(['Alex', 'Sam']);
  });

  it('gives away nothing about how members prove who they are', async () => {
    const { crewId, secret } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 'secret-token', body: SUMMARY });

    const text = await (await call('GET', `/crew/${crewId}`, { secret })).text();
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('tokenHash');
    expect(text).not.toContain('hash(');
  });

  it('refuses without the secret', async () => {
    const { crewId } = await newCrew();
    expect((await call('GET', `/crew/${crewId}`)).status).toBe(401);
  });

  it('answers the same way for a crew that does not exist as one you cannot open', async () => {
    const { crewId } = await newCrew();
    const wrongSecret = await call('GET', `/crew/${crewId}`, { secret: 'guess' });
    const noSuchCrew = await call('GET', '/crew/nothinghere', { secret: 'guess' });

    expect(wrongSecret.status).toBe(noSuchCrew.status);
    expect(await wrongSecret.text()).toBe(await noSuchCrew.text());
  });
});

describe('leaving a crew', () => {
  it('removes your row', async () => {
    const { crewId, secret } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: SUMMARY });
    await call('DELETE', `/crew/${crewId}/member/m1`, { secret, token: 't1' });
    expect(await deps.store.listMembers(crewId)).toEqual([]);
  });

  it('cannot remove somebody else', async () => {
    const { crewId, secret } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: SUMMARY });
    expect((await call('DELETE', `/crew/${crewId}/member/m1`, { secret, token: 'other' })).status).toBe(403);
    expect(await deps.store.listMembers(crewId)).toHaveLength(1);
  });
});

describe('the shape of the api', () => {
  it('answers a browser preflight', async () => {
    const response = await call('OPTIONS', '/crew');
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('x-crew-secret');
  });

  it('allows the app to call it from another origin', async () => {
    expect((await call('POST', '/crew')).headers.get('access-control-allow-origin')).toBe('*');
  });

  it('has nothing at any other path', async () => {
    expect((await call('GET', '/')).status).toBe(404);
    expect((await call('GET', '/crew')).status).toBe(404);
    expect((await call('POST', '/crew/x/member/y')).status).toBe(404);
  });

  it('ignores a trailing slash', async () => {
    expect((await call('POST', '/crew/')).status).toBe(201);
  });
});
