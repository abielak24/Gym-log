import { beforeEach, describe, expect, it } from 'vitest';
import { handle, type Deps } from '../worker/src/handler';
import { nameKey, type AccountRow, type AttemptRow, type CrewRow, type MemberRow, type SessionRow, type Store } from '../worker/src/store';

/** An in-memory Store, so every rule can be tested with nothing deployed. */
function memoryStore(): Store {
  const accounts = new Map<string, AccountRow>();
  const sessions = new Map<string, SessionRow>();
  const attempts = new Map<string, AttemptRow>();
  const settings = new Map<string, string>();
  const crews = new Map<string, CrewRow>();
  const members = new Map<string, Map<string, MemberRow>>();

  return {
    async createAccount(row) {
      accounts.set(row.id, row);
    },
    async getAccountByHandle(handleKey) {
      return [...accounts.values()].find((a) => a.handleKey === handleKey) ?? null;
    },
    async getAccount(id) {
      return accounts.get(id) ?? null;
    },
    async updateAccount(id, patch) {
      const row = accounts.get(id);
      if (row) accounts.set(id, { ...row, ...patch });
    },

    async createSession(row) {
      sessions.set(row.tokenHash, row);
    },
    async getSession(tokenHash) {
      return sessions.get(tokenHash) ?? null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async deleteSessionsFor(accountId) {
      for (const [key, row] of sessions) if (row.accountId === accountId) sessions.delete(key);
    },

    async getAttempts(handleKey) {
      return attempts.get(handleKey) ?? null;
    },
    async putAttempts(row) {
      attempts.set(row.handleKey, row);
    },
    async clearAttempts(handleKey) {
      attempts.delete(handleKey);
    },

    async getSetting(key) {
      return settings.get(key) ?? null;
    },
    async putSetting(key, value) {
      // Mirrors INSERT OR IGNORE: the first value written is the one kept.
      if (!settings.has(key)) settings.set(key, value);
    },

    async createCrew(row) {
      crews.set(row.id, row);
    },
    async getCrew(id) {
      return crews.get(id) ?? null;
    },
    async setCrewSecret(id, secretHash) {
      const crew = crews.get(id);
      if (crew) crews.set(id, { ...crew, secretHash });
    },

    async getMember(crewId, accountId) {
      return members.get(crewId)?.get(accountId) ?? null;
    },
    async findMemberByName(crewId, key) {
      return [...(members.get(crewId)?.values() ?? [])].find((m) => m.nameKey === key) ?? null;
    },
    async countMembers(crewId) {
      return members.get(crewId)?.size ?? 0;
    },
    async putMember(crewId, row) {
      const crew = members.get(crewId) ?? new Map<string, MemberRow>();
      crew.set(row.accountId, row);
      members.set(crewId, crew);
    },
    async listMembers(crewId) {
      return [...(members.get(crewId)?.values() ?? [])];
    },
    async deleteMember(crewId, accountId) {
      members.get(crewId)?.delete(accountId);
    },
  };
}

let ids = 0;
let clock = 1_700_000_000_000;
let deps: Deps;

beforeEach(() => {
  ids = 0;
  clock = 1_700_000_000_000;
  deps = {
    store: memoryStore(),
    now: () => clock,
    randomId: () => `id${++ids}`,
    // Not a real digest, but it is one-way enough to prove the rules.
    hash: async (value: string) => `hash(${value})`,
  };
});

const API = 'https://crew.example';
const SUMMARY = { name: 'Alex', daysTrained7: 3, daysTrained30: 9, goalsMet7: 2, goalsTracked7: 3, lifts: [] };

function call(
  method: string,
  path: string,
  options: { secret?: string; token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.secret) headers['x-crew-secret'] = options.secret;
  if (options.token) headers['x-account-token'] = options.token;

  return handle(new Request(`${API}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), deps);
}

/** Sign somebody up and keep the token their phone would hold. */
async function signUp(handleName: string, key = `key-${handleName}`, recovery = `recover-${handleName}`) {
  const response = await call('POST', '/account', {
    body: { handle: handleName, salt: `salt-${handleName}`, key, recovery },
  });
  const body = await response.json() as { accountId: string; token: string };
  return { ...body, status: response.status };
}

describe('signing up', () => {
  it('issues a session straight away, so nobody logs in twice', async () => {
    const response = await call('POST', '/account', {
      body: { handle: 'alex', salt: 's', key: 'k', recovery: 'r' },
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { accountId: string; token: string; handle: string };
    expect(body.token).toBeTruthy();
    expect(body.handle).toBe('alex');
  });

  it('takes the handle as the board name when none is given', async () => {
    const { token } = await signUp('alex');
    const me = await call('GET', '/me', { token });
    expect((await me.json() as { displayName: string }).displayName).toBe('alex');
  });

  it('refuses a handle somebody has, whatever the case', async () => {
    await signUp('alex');
    const response = await call('POST', '/account', {
      body: { handle: 'ALEX', salt: 's', key: 'k', recovery: 'r' },
    });
    expect(response.status).toBe(409);
  });

  it('refuses a handle with spaces or punctuation in it', async () => {
    for (const bad of ['al ex', 'al/ex', 'ab', '']) {
      const response = await call('POST', '/account', {
        body: { handle: bad, salt: 's', key: 'k', recovery: 'r' },
      });
      expect(response.status).toBe(400);
    }
  });

  it('never stores the key it was sent, only a hash of it', async () => {
    await signUp('alex', 'derived-key');
    const stored = await deps.store.getAccountByHandle('alex');
    expect(stored?.keyHash).toBe('hash(derived-key)');
    expect(stored?.keyHash).not.toBe('derived-key');
  });
});

describe('logging in', () => {
  it('works with the right key', async () => {
    await signUp('alex', 'derived-key');
    const response = await call('POST', '/session', { body: { handle: 'alex', key: 'derived-key' } });
    expect(response.status).toBe(200);
    expect((await response.json() as { token: string }).token).toBeTruthy();
  });

  it('does not with the wrong one', async () => {
    await signUp('alex', 'derived-key');
    const response = await call('POST', '/session', { body: { handle: 'alex', key: 'guess' } });
    expect(response.status).toBe(403);
  });

  it('answers a handle nobody has exactly as it answers a wrong key', async () => {
    await signUp('alex', 'derived-key');
    const wrongKey = await call('POST', '/session', { body: { handle: 'alex', key: 'guess' } });
    const noSuchHandle = await call('POST', '/session', { body: { handle: 'nobody', key: 'guess' } });

    expect(wrongKey.status).toBe(noSuchHandle.status);
    expect(await wrongKey.text()).toBe(await noSuchHandle.text());
  });

  it('gives a handle nobody has a salt anyway, so it cannot be probed', async () => {
    const unknown = await call('POST', '/account/salt', { body: { handle: 'nobody' } });
    expect(unknown.status).toBe(200);
    expect((await unknown.json() as { salt: string }).salt).toBeTruthy();
  });

  it('gives the same made-up salt every time, or the trick would be obvious', async () => {
    const first = await call('POST', '/account/salt', { body: { handle: 'nobody' } });
    const second = await call('POST', '/account/salt', { body: { handle: 'nobody' } });
    expect(await first.text()).toBe(await second.text());
  });

  it('gives a real account its real salt', async () => {
    await signUp('alex');
    const response = await call('POST', '/account/salt', { body: { handle: 'ALEX' } });
    expect((await response.json() as { salt: string }).salt).toBe('salt-alex');
  });

  it('goes quiet after ten wrong guesses', async () => {
    await signUp('alex', 'derived-key');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await call('POST', '/session', { body: { handle: 'alex', key: 'guess' } });
    }

    const blocked = await call('POST', '/session', { body: { handle: 'alex', key: 'derived-key' } });
    expect(blocked.status).toBe(429);
  });

  it('and starts counting again once the window is past', async () => {
    await signUp('alex', 'derived-key');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await call('POST', '/session', { body: { handle: 'alex', key: 'guess' } });
    }

    clock += 16 * 60 * 1000;
    const response = await call('POST', '/session', { body: { handle: 'alex', key: 'derived-key' } });
    expect(response.status).toBe(200);
  });

  it('forgets the failures as soon as one succeeds', async () => {
    await signUp('alex', 'derived-key');
    await call('POST', '/session', { body: { handle: 'alex', key: 'guess' } });
    await call('POST', '/session', { body: { handle: 'alex', key: 'derived-key' } });
    expect(await deps.store.getAttempts('alex')).toBeNull();
  });

  it('signs out only the device that asked', async () => {
    const first = await signUp('alex', 'derived-key');
    const second = await call('POST', '/session', { body: { handle: 'alex', key: 'derived-key' } });
    const secondToken = (await second.json() as { token: string }).token;

    await call('DELETE', '/session', { token: first.token });
    expect((await call('GET', '/me', { token: first.token })).status).toBe(401);
    expect((await call('GET', '/me', { token: secondToken })).status).toBe(200);
  });
});

describe('the recovery code', () => {
  it('sets a new password and signs you in', async () => {
    await signUp('alex', 'old-key', 'the-code');
    const response = await call('POST', '/account/recover', {
      body: { handle: 'alex', recovery: 'the-code', salt: 's2', key: 'new-key', nextRecovery: 'next-code' },
    });

    expect(response.status).toBe(200);
    const after = await call('POST', '/session', { body: { handle: 'alex', key: 'new-key' } });
    expect(after.status).toBe(200);
  });

  it('retires the old password', async () => {
    await signUp('alex', 'old-key', 'the-code');
    await call('POST', '/account/recover', {
      body: { handle: 'alex', recovery: 'the-code', salt: 's2', key: 'new-key', nextRecovery: 'next-code' },
    });

    expect((await call('POST', '/session', { body: { handle: 'alex', key: 'old-key' } })).status).toBe(403);
  });

  it('cannot be used twice', async () => {
    await signUp('alex', 'old-key', 'the-code');
    await call('POST', '/account/recover', {
      body: { handle: 'alex', recovery: 'the-code', salt: 's2', key: 'new-key', nextRecovery: 'next-code' },
    });

    const again = await call('POST', '/account/recover', {
      body: { handle: 'alex', recovery: 'the-code', salt: 's3', key: 'k3', nextRecovery: 'r3' },
    });
    expect(again.status).toBe(403);
  });

  // Somebody recovering an account may be doing it because a phone is gone.
  it('signs out every device that was already signed in', async () => {
    const before = await signUp('alex', 'old-key', 'the-code');
    await call('POST', '/account/recover', {
      body: { handle: 'alex', recovery: 'the-code', salt: 's2', key: 'new-key', nextRecovery: 'next-code' },
    });

    expect((await call('GET', '/me', { token: before.token })).status).toBe(401);
  });

  it('refuses a wrong code', async () => {
    await signUp('alex', 'old-key', 'the-code');
    const response = await call('POST', '/account/recover', {
      body: { handle: 'alex', recovery: 'guess', salt: 's2', key: 'k2', nextRecovery: 'r2' },
    });
    expect(response.status).toBe(403);
  });

  it('is rate limited the same way a password is', async () => {
    await signUp('alex', 'old-key', 'the-code');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await call('POST', '/account/recover', {
        body: { handle: 'alex', recovery: 'guess', salt: 's', key: 'k', nextRecovery: 'r' },
      });
    }

    const blocked = await call('POST', '/account/recover', {
      body: { handle: 'alex', recovery: 'the-code', salt: 's2', key: 'k2', nextRecovery: 'r2' },
    });
    expect(blocked.status).toBe(429);
  });
});

describe('a crew', () => {
  async function crewFor(token: string) {
    const response = await call('POST', '/crew', { token });
    return await response.json() as { crewId: string; secret: string };
  }

  it('needs an account to start', async () => {
    expect((await call('POST', '/crew')).status).toBe(401);
  });

  it('opens to anyone holding the link', async () => {
    const alex = await signUp('alex');
    const { crewId, secret } = await crewFor(alex.token);
    expect((await call('GET', `/crew/${crewId}`, { secret })).status).toBe(200);
  });

  it('but not to a wrong one', async () => {
    const alex = await signUp('alex');
    const { crewId } = await crewFor(alex.token);
    expect((await call('GET', `/crew/${crewId}`, { secret: 'guess' })).status).toBe(404);
  });

  it('takes a summary from anyone signed in who has the link', async () => {
    const alex = await signUp('alex');
    const { crewId, secret } = await crewFor(alex.token);
    const sam = await signUp('sam');

    const response = await call('PUT', `/crew/${crewId}/member`, {
      token: sam.token, secret, body: { ...SUMMARY, name: 'Sam' },
    });
    expect(response.status).toBe(200);

    const board = await call('GET', `/crew/${crewId}`, { secret });
    expect((await board.json() as { members: unknown[] }).members).toHaveLength(1);
  });

  it('refuses a summary from somebody not signed in', async () => {
    const alex = await signUp('alex');
    const { crewId, secret } = await crewFor(alex.token);

    const response = await call('PUT', `/crew/${crewId}/member`, { secret, body: SUMMARY });
    expect(response.status).toBe(401);
  });

  // The whole point of accounts: your phones are you, not three strangers.
  it('gives one account one row however many devices it posts from', async () => {
    const alex = await signUp('alex', 'k');
    const { crewId, secret } = await crewFor(alex.token);
    const second = await call('POST', '/session', { body: { handle: 'alex', key: 'k' } });
    const laptop = (await second.json() as { token: string }).token;

    await call('PUT', `/crew/${crewId}/member`, { token: alex.token, secret, body: { ...SUMMARY, name: 'Alex' } });
    await call('PUT', `/crew/${crewId}/member`, { token: laptop, secret, body: { ...SUMMARY, name: 'Alex' } });

    const board = await call('GET', `/crew/${crewId}`, { secret });
    expect((await board.json() as { members: unknown[] }).members).toHaveLength(1);
  });

  it('never lets two people share a name on one board', async () => {
    const alex = await signUp('alex');
    const { crewId, secret } = await crewFor(alex.token);
    const sam = await signUp('sam');

    await call('PUT', `/crew/${crewId}/member`, { token: alex.token, secret, body: { ...SUMMARY, name: 'Alex' } });
    const clash = await call('PUT', `/crew/${crewId}/member`, {
      token: sam.token, secret, body: { ...SUMMARY, name: 'ALEX' },
    });
    expect(clash.status).toBe(409);
  });

  it('still lets you keep your own name when you post again', async () => {
    const alex = await signUp('alex');
    const { crewId, secret } = await crewFor(alex.token);

    await call('PUT', `/crew/${crewId}/member`, { token: alex.token, secret, body: { ...SUMMARY, name: 'Alex' } });
    const again = await call('PUT', `/crew/${crewId}/member`, {
      token: alex.token, secret, body: { ...SUMMARY, name: 'Alex' },
    });
    expect(again.status).toBe(200);
  });

  it('refuses a summary far bigger than one', async () => {
    const alex = await signUp('alex');
    const { crewId, secret } = await crewFor(alex.token);

    const response = await call('PUT', `/crew/${crewId}/member`, {
      token: alex.token, secret, body: { ...SUMMARY, padding: 'x'.repeat(70_000) },
    });
    expect(response.status).toBe(413);
  });

  it('never sends a summary to somebody without the link', async () => {
    const alex = await signUp('alex');
    const { crewId } = await crewFor(alex.token);
    expect((await call('GET', `/crew/${crewId}`)).status).toBe(401);
  });

  it('lets anyone leave their own row', async () => {
    const alex = await signUp('alex');
    const { crewId, secret } = await crewFor(alex.token);
    const sam = await signUp('sam');
    await call('PUT', `/crew/${crewId}/member`, { token: sam.token, secret, body: { ...SUMMARY, name: 'Sam' } });

    await call('DELETE', `/crew/${crewId}/member`, { token: sam.token, secret });
    const board = await call('GET', `/crew/${crewId}`, { secret });
    expect((await board.json() as { members: unknown[] }).members).toHaveLength(0);
  });
});

describe('whoever started the crew', () => {
  async function crewWithBoth() {
    const alex = await signUp('alex');
    const response = await call('POST', '/crew', { token: alex.token });
    const { crewId, secret } = await response.json() as { crewId: string; secret: string };
    const sam = await signUp('sam');

    await call('PUT', `/crew/${crewId}/member`, { token: alex.token, secret, body: { ...SUMMARY, name: 'Alex' } });
    await call('PUT', `/crew/${crewId}/member`, { token: sam.token, secret, body: { ...SUMMARY, name: 'Sam' } });
    return { crewId, secret, alex, sam };
  }

  it('can remove somebody else', async () => {
    const { crewId, secret, alex, sam } = await crewWithBoth();
    const response = await call('DELETE', `/crew/${crewId}/member/${sam.accountId}`, { token: alex.token, secret });
    expect(response.status).toBe(200);

    const board = await call('GET', `/crew/${crewId}`, { secret });
    expect((await board.json() as { members: { name: string }[] }).members.map((m) => m.name)).toEqual(['Alex']);
  });

  it('cannot remove themselves by that route', async () => {
    const { crewId, secret, alex } = await crewWithBoth();
    const response = await call('DELETE', `/crew/${crewId}/member/${alex.accountId}`, { token: alex.token, secret });
    expect(response.status).toBe(400);
  });

  it('is the only one who can remove anybody', async () => {
    const { crewId, secret, alex, sam } = await crewWithBoth();
    const response = await call('DELETE', `/crew/${crewId}/member/${alex.accountId}`, { token: sam.token, secret });
    expect(response.status).toBe(403);
  });

  it('can change the link, which is what makes a removal stick', async () => {
    const { crewId, secret, alex } = await crewWithBoth();
    const response = await call('POST', `/crew/${crewId}/rotate`, { token: alex.token, secret });
    expect(response.status).toBe(200);

    const { secret: next } = await response.json() as { secret: string };
    expect((await call('GET', `/crew/${crewId}`, { secret })).status).toBe(404);
    expect((await call('GET', `/crew/${crewId}`, { secret: next })).status).toBe(200);
  });

  it('and nobody else can', async () => {
    const { crewId, secret, sam } = await crewWithBoth();
    expect((await call('POST', `/crew/${crewId}/rotate`, { token: sam.token, secret })).status).toBe(403);
  });

  it('is named on the board, so the app knows who may remove', async () => {
    const { crewId, secret, alex } = await crewWithBoth();
    const board = await call('GET', `/crew/${crewId}`, { secret });
    expect((await board.json() as { ownerAccountId: string }).ownerAccountId).toBe(alex.accountId);
  });
});

describe('the browser can actually send what the client sends', () => {
  // A header outside the simple set needs naming in the preflight, or the
  // browser refuses the request before the worker ever sees it.
  it('allows the crew secret and the account token', async () => {
    const response = await handle(new Request(`${API}/crew`, { method: 'OPTIONS' }), deps);
    const allowed = response.headers.get('access-control-allow-headers') ?? '';

    for (const header of ['content-type', 'x-crew-secret', 'x-account-token']) {
      expect(allowed).toContain(header);
    }
  });

  it('folds a name the same way the store does', () => {
    expect(nameKey('  Alex   Smith ')).toBe('alex smith');
  });
});
