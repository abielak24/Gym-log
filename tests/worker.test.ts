import { beforeEach, describe, expect, it } from 'vitest';
import { handle, type Deps } from '../worker/src/handler';
import { nameKey, type MemberRow, type Store } from '../worker/src/store';

/** An in-memory Store, so every rule can be tested with nothing deployed. */
function memoryStore(): Store {
  const crews = new Map<string, { id: string; secretHash: string; adminTokenHash: string }>();
  const members = new Map<string, Map<string, MemberRow>>();

  return {
    async createCrew(id, secretHash, adminTokenHash) {
      crews.set(id, { id, secretHash, adminTokenHash });
    },
    async getCrew(id) {
      return crews.get(id) ?? null;
    },
    async setCrewSecret(id, secretHash) {
      const crew = crews.get(id);
      if (crew) crews.set(id, { ...crew, secretHash });
    },
    async getMember(crewId, memberId) {
      return members.get(crewId)?.get(memberId) ?? null;
    },
    async findMemberByName(crewId, key) {
      return [...(members.get(crewId)?.values() ?? [])].find((m) => m.nameKey === key) ?? null;
    },
    async setMemberToken(crewId, memberId, tokenHash) {
      const row = members.get(crewId)?.get(memberId);
      if (row) members.get(crewId)!.set(memberId, { ...row, tokenHash });
    },
    async countMembers(crewId) {
      return members.get(crewId)?.size ?? 0;
    },
    async putMember(crewId, row) {
      const crew = members.get(crewId) ?? new Map<string, MemberRow>();
      const before = crew.get(row.memberId);
      // Mirrors the SQL: an empty passcode leaves the stored one alone, and a
      // put never rebinds the token — only a claim does.
      crew.set(row.memberId, {
        ...row,
        tokenHash: before?.tokenHash ?? row.tokenHash,
        passcodeHash: row.passcodeHash || before?.passcodeHash || '',
      });
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

function call(
  method: string,
  path: string,
  options: { secret?: string; token?: string; body?: unknown; admin?: string; passcode?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.secret) headers['x-crew-secret'] = options.secret;
  if (options.token) headers['x-member-token'] = options.token;
  if (options.admin) headers['x-admin-token'] = options.admin;
  if (options.passcode) headers['x-member-passcode'] = options.passcode;

  return handle(new Request(`${API}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), deps);
}

async function newCrew() {
  const response = await call('POST', '/crew');
  return (await response.json()) as { crewId: string; secret: string; adminToken: string };
}

const SUMMARY = { name: 'Alex', daysTrained7: 3, lifts: [{ key: 'bench', name: 'Bench', best: { weight: 225, reps: 5 } }] };

describe('starting a crew', () => {
  it('hands back an id, a secret and an admin token', async () => {
    const response = await call('POST', '/crew');
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ crewId: 'id1', secret: 'id2', adminToken: 'id3' });
  });

  it('never stores the admin token itself either', async () => {
    const { crewId, adminToken } = await newCrew();
    const stored = await deps.store.getCrew(crewId);
    expect(stored?.adminTokenHash).toBe(`hash(${adminToken})`);
    expect(stored?.adminTokenHash).not.toBe(adminToken);
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

describe('whoever started the crew', () => {
  const SUMMARY_FOR = (name: string) => ({ ...SUMMARY, name });

  it('can remove somebody else', async () => {
    const { crewId, secret, adminToken } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: SUMMARY_FOR('Sam') });

    const response = await call('DELETE', `/crew/${crewId}/member/m1`, { secret, admin: adminToken });
    expect(response.status).toBe(200);
    expect(await deps.store.listMembers(crewId)).toEqual([]);
  });

  it('and nobody else can', async () => {
    const { crewId, secret } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: SUMMARY_FOR('Sam') });

    const response = await call('DELETE', `/crew/${crewId}/member/m1`, { secret, admin: 'guess' });
    expect(response.status).toBe(403);
    expect(await deps.store.listMembers(crewId)).toHaveLength(1);
  });

  it('can rotate the link, which is what makes removing somebody stick', async () => {
    const { crewId, secret, adminToken } = await newCrew();
    const rotated = await call('POST', `/crew/${crewId}/rotate`, { secret, admin: adminToken });
    expect(rotated.status).toBe(200);

    const { secret: fresh } = await rotated.json() as { secret: string };
    expect(fresh).not.toBe(secret);

    // The old link stops opening the crew; the new one works.
    expect((await call('GET', `/crew/${crewId}`, { secret })).status).toBe(404);
    expect((await call('GET', `/crew/${crewId}`, { secret: fresh })).status).toBe(200);
  });

  it('is the only one who can rotate it', async () => {
    const { crewId, secret } = await newCrew();
    expect((await call('POST', `/crew/${crewId}/rotate`, { secret })).status).toBe(403);
    expect((await call('POST', `/crew/${crewId}/rotate`, { secret, admin: 'guess' })).status).toBe(403);
    expect((await call('GET', `/crew/${crewId}`, { secret })).status).toBe(200);
  });

  it('keeps everyone on the board through a rotation', async () => {
    const { crewId, secret, adminToken } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: SUMMARY_FOR('Sam') });

    const { secret: fresh } = await (await call('POST', `/crew/${crewId}/rotate`, { secret, admin: adminToken })).json() as { secret: string };
    const board = await (await call('GET', `/crew/${crewId}`, { secret: fresh })).json() as { members: unknown[] };
    expect(board.members).toHaveLength(1);
  });
});

describe('claiming your row from another device', () => {
  async function crewWithAlex() {
    const crew = await newCrew();
    await call('PUT', `/crew/${crew.crewId}/member/phone`, {
      secret: crew.secret, token: 'phone-token', passcode: 'hunter2', body: { ...SUMMARY, name: 'Alex' },
    });
    return crew;
  }

  it('lets a second device take over with the name and passcode', async () => {
    const { crewId, secret } = await crewWithAlex();

    const response = await call('POST', `/crew/${crewId}/claim`, {
      secret, token: 'laptop-token', body: { name: 'Alex', passcode: 'hunter2' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ memberId: 'phone' });

    // The new device can post; the old token no longer can.
    expect((await call('PUT', `/crew/${crewId}/member/phone`, { secret, token: 'laptop-token', body: { ...SUMMARY, name: 'Alex' } })).status).toBe(200);
    expect((await call('PUT', `/crew/${crewId}/member/phone`, { secret, token: 'phone-token', body: { ...SUMMARY, name: 'Alex' } })).status).toBe(403);
  });

  it('ignores case and stray spaces in the name', async () => {
    const { crewId, secret } = await crewWithAlex();
    const response = await call('POST', `/crew/${crewId}/claim`, {
      secret, token: 'laptop', body: { name: '  alex ', passcode: 'hunter2' },
    });
    expect(response.status).toBe(200);
  });

  it('refuses a wrong passcode', async () => {
    const { crewId, secret } = await crewWithAlex();
    const response = await call('POST', `/crew/${crewId}/claim`, {
      secret, token: 'laptop', body: { name: 'Alex', passcode: 'guess' },
    });
    expect(response.status).toBe(403);
  });

  it('answers a name nobody has exactly as it answers a wrong passcode', async () => {
    const { crewId, secret } = await crewWithAlex();
    const wrongCode = await call('POST', `/crew/${crewId}/claim`, { secret, token: 'l', body: { name: 'Alex', passcode: 'guess' } });
    const noSuchName = await call('POST', `/crew/${crewId}/claim`, { secret, token: 'l', body: { name: 'Nobody', passcode: 'guess' } });

    expect(wrongCode.status).toBe(noSuchName.status);
    expect(await wrongCode.text()).toBe(await noSuchName.text());
  });

  it('refuses when no passcode was ever set', async () => {
    const { crewId, secret } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 't1', body: { ...SUMMARY, name: 'Nopass' } });

    const response = await call('POST', `/crew/${crewId}/claim`, {
      secret, token: 'laptop', body: { name: 'Nopass', passcode: '' },
    });
    expect(response.status).toBe(400);
  });

  it('keeps the passcode when an ordinary post carries none', async () => {
    const { crewId, secret } = await crewWithAlex();
    await call('PUT', `/crew/${crewId}/member/phone`, { secret, token: 'phone-token', body: { ...SUMMARY, name: 'Alex' } });

    const response = await call('POST', `/crew/${crewId}/claim`, {
      secret, token: 'laptop', body: { name: 'Alex', passcode: 'hunter2' },
    });
    expect(response.status).toBe(200);
  });

  it('never lets a name be taken twice, or claiming would be ambiguous', async () => {
    const { crewId, secret } = await crewWithAlex();
    const response = await call('PUT', `/crew/${crewId}/member/other`, {
      secret, token: 'other-token', body: { ...SUMMARY, name: 'ALEX' },
    });
    expect(response.status).toBe(409);
  });

  it('still lets you keep your own name when you post again', async () => {
    const { crewId, secret } = await crewWithAlex();
    const response = await call('PUT', `/crew/${crewId}/member/phone`, {
      secret, token: 'phone-token', body: { ...SUMMARY, name: 'Alex' },
    });
    expect(response.status).toBe(200);
  });

  it('folds a name the same way the store does', () => {
    expect(nameKey('  Alex   Smith ')).toBe('alex smith');
  });

  // A claim rebinds the token to the new device. If that were the only proof
  // a write could offer, the first phone would be locked out of its own row
  // for good — silently, since posting never reports a failure.
  describe('after a claim, the first device', () => {
    async function claimed() {
      const crew = await crewWithAlex();
      await call('POST', `/crew/${crew.crewId}/claim`, {
        secret: crew.secret, token: 'laptop-token', body: { name: 'Alex', passcode: 'hunter2' },
      });
      return crew;
    }

    it('can still post with its passcode', async () => {
      const { crewId, secret } = await claimed();
      const response = await call('PUT', `/crew/${crewId}/member/phone`, {
        secret, token: 'phone-token', passcode: 'hunter2', body: { ...SUMMARY, name: 'Alex' },
      });
      expect(response.status).toBe(200);
    });

    it('cannot post without it', async () => {
      const { crewId, secret } = await claimed();
      const response = await call('PUT', `/crew/${crewId}/member/phone`, {
        secret, token: 'phone-token', body: { ...SUMMARY, name: 'Alex' },
      });
      expect(response.status).toBe(403);
    });

    it('can still leave', async () => {
      const { crewId, secret } = await claimed();
      const response = await call('DELETE', `/crew/${crewId}/member/phone`, {
        secret, token: 'phone-token', passcode: 'hunter2',
      });
      expect(response.status).toBe(200);

      const board = await call('GET', `/crew/${crewId}`, { secret });
      expect((await board.json() as { members: unknown[] }).members).toHaveLength(0);
    });

    it('and the device that claimed it still posts on its token alone', async () => {
      const { crewId, secret } = await claimed();
      const response = await call('PUT', `/crew/${crewId}/member/phone`, {
        secret, token: 'laptop-token', body: { ...SUMMARY, name: 'Alex' },
      });
      expect(response.status).toBe(200);
    });
  });

  it('never lets a passcode stand in for a row that has none', async () => {
    const { crewId, secret } = await newCrew();
    await call('PUT', `/crew/${crewId}/member/m1`, { secret, token: 'mine', body: { ...SUMMARY, name: 'Nopass' } });

    const response = await call('PUT', `/crew/${crewId}/member/m1`, {
      secret, token: 'stranger', passcode: '', body: { ...SUMMARY, name: 'Nopass' },
    });
    expect(response.status).toBe(403);
  });

  it('refuses a wrong passcode from a stranger', async () => {
    const { crewId, secret } = await crewWithAlex();
    const response = await call('PUT', `/crew/${crewId}/member/phone`, {
      secret, token: 'stranger', passcode: 'guess', body: { ...SUMMARY, name: 'Alex' },
    });
    expect(response.status).toBe(403);
  });
});

describe('the browser can actually send what the client sends', () => {
  // A header outside the simple set needs naming in the preflight, or the
  // browser refuses the request before the worker ever sees it. Both of these
  // arrived with the passcode work and neither is exercised by the smoke
  // test, which is same-origin and so never preflights.
  it('allows the passcode and admin headers', async () => {
    const response = await handle(new Request(`${API}/crew`, { method: 'OPTIONS' }), deps);
    const allowed = response.headers.get('access-control-allow-headers') ?? '';

    for (const header of ['content-type', 'x-crew-secret', 'x-member-token', 'x-member-passcode', 'x-admin-token']) {
      expect(allowed).toContain(header);
    }
  });
});
