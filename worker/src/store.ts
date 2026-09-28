/**
 * Storage, behind an interface.
 *
 * The request handler is written against this rather than against D1, so
 * every rule in it can be tested in an ordinary test run with nothing
 * deployed anywhere.
 */

export interface AccountRow {
  id: string;
  /** What you type to log in, folded for lookup. */
  handleKey: string;
  handle: string;
  /** What friends see on a board. Starts as the handle. */
  displayName: string;
  /** Public. The phone needs it before it can derive anything. */
  salt: string;
  /** A fast hash of the key the phone derived. Never the password. */
  keyHash: string;
  /** The same, for the one-time code shown at sign-up. */
  recoveryHash: string;
  createdAt: number;
}

export interface SessionRow {
  tokenHash: string;
  accountId: string;
  createdAt: number;
}

export interface CrewRow {
  id: string;
  secretHash: string;
  /** Whoever created it. They can remove members and change the link. */
  ownerAccountId: string;
}

export interface MemberRow {
  accountId: string;
  name: string;
  nameKey: string;
  summary: string;
  updatedAt: number;
}

/** How many failed attempts a handle has made lately. */
export interface AttemptRow {
  handleKey: string;
  count: number;
  windowStart: number;
}

export interface Store {
  createAccount(row: AccountRow): Promise<void>;
  getAccountByHandle(handleKey: string): Promise<AccountRow | null>;
  getAccount(id: string): Promise<AccountRow | null>;
  updateAccount(id: string, patch: Partial<AccountRow>): Promise<void>;

  createSession(row: SessionRow): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRow | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Signing out everywhere, and what recovery does to old devices. */
  deleteSessionsFor(accountId: string): Promise<void>;

  getAttempts(handleKey: string): Promise<AttemptRow | null>;
  putAttempts(row: AttemptRow): Promise<void>;
  clearAttempts(handleKey: string): Promise<void>;

  /** A value the server keeps to itself, made once and reused. */
  getSetting(key: string): Promise<string | null>;
  putSetting(key: string, value: string): Promise<void>;

  createCrew(row: CrewRow, now: number): Promise<void>;
  getCrew(id: string): Promise<CrewRow | null>;
  setCrewSecret(id: string, secretHash: string): Promise<void>;

  getMember(crewId: string, accountId: string): Promise<MemberRow | null>;
  findMemberByName(crewId: string, nameKey: string): Promise<MemberRow | null>;
  countMembers(crewId: string): Promise<number>;
  putMember(crewId: string, row: MemberRow): Promise<void>;
  listMembers(crewId: string): Promise<MemberRow[]>;
  deleteMember(crewId: string, accountId: string): Promise<void>;
}

/** Fold a name or handle so it can be looked up without matching case. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The D1 implementation. Nothing here has rules in it; the handler has those. */
export function d1Store(db: D1Database): Store {
  return {
    async createAccount(row) {
      await db.prepare(
        `INSERT INTO accounts (id, handle_key, handle, display_name, salt, key_hash, recovery_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(row.id, row.handleKey, row.handle, row.displayName, row.salt, row.keyHash, row.recoveryHash, row.createdAt).run();
    },

    async getAccountByHandle(handleKey) {
      const row = await db.prepare(`${ACCOUNT_COLUMNS} WHERE handle_key = ?`).bind(handleKey).first();
      return row ? toAccount(row) : null;
    },

    async getAccount(id) {
      const row = await db.prepare(`${ACCOUNT_COLUMNS} WHERE id = ?`).bind(id).first();
      return row ? toAccount(row) : null;
    },

    async updateAccount(id, patch) {
      const columns: Record<string, string> = {
        displayName: 'display_name', salt: 'salt', keyHash: 'key_hash', recoveryHash: 'recovery_hash',
      };
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [key, column] of Object.entries(columns)) {
        const value = (patch as Record<string, unknown>)[key];
        if (value !== undefined) {
          sets.push(`${column} = ?`);
          values.push(value);
        }
      }
      if (sets.length === 0) return;
      await db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
    },

    async createSession(row) {
      await db.prepare('INSERT INTO sessions (token_hash, account_id, created_at) VALUES (?, ?, ?)')
        .bind(row.tokenHash, row.accountId, row.createdAt).run();
    },

    async getSession(tokenHash) {
      const row = await db.prepare('SELECT token_hash, account_id, created_at FROM sessions WHERE token_hash = ?')
        .bind(tokenHash).first();
      return row
        ? { tokenHash: row.token_hash as string, accountId: row.account_id as string, createdAt: Number(row.created_at) }
        : null;
    },

    async deleteSession(tokenHash) {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    },

    async deleteSessionsFor(accountId) {
      await db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(accountId).run();
    },

    async getAttempts(handleKey) {
      const row = await db.prepare('SELECT handle_key, count, window_start FROM attempts WHERE handle_key = ?')
        .bind(handleKey).first();
      return row
        ? { handleKey: row.handle_key as string, count: Number(row.count), windowStart: Number(row.window_start) }
        : null;
    },

    async putAttempts(row) {
      await db.prepare(
        `INSERT INTO attempts (handle_key, count, window_start) VALUES (?, ?, ?)
         ON CONFLICT (handle_key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start`,
      ).bind(row.handleKey, row.count, row.windowStart).run();
    },

    async clearAttempts(handleKey) {
      await db.prepare('DELETE FROM attempts WHERE handle_key = ?').bind(handleKey).run();
    },

    async getSetting(key) {
      const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
      return row ? (row.value as string) : null;
    },

    async putSetting(key, value) {
      await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
    },

    async createCrew(row, now) {
      await db.prepare('INSERT INTO crews (id, secret_hash, owner_account_id, created_at) VALUES (?, ?, ?, ?)')
        .bind(row.id, row.secretHash, row.ownerAccountId, now).run();
    },

    async getCrew(id) {
      const row = await db.prepare('SELECT id, secret_hash, owner_account_id FROM crews WHERE id = ?').bind(id).first();
      return row
        ? { id: row.id as string, secretHash: row.secret_hash as string, ownerAccountId: row.owner_account_id as string }
        : null;
    },

    async setCrewSecret(id, secretHash) {
      await db.prepare('UPDATE crews SET secret_hash = ? WHERE id = ?').bind(secretHash, id).run();
    },

    async getMember(crewId, accountId) {
      const row = await db.prepare(`${MEMBER_COLUMNS} WHERE crew_id = ? AND account_id = ?`).bind(crewId, accountId).first();
      return row ? toMember(row) : null;
    },

    async findMemberByName(crewId, key) {
      const row = await db.prepare(`${MEMBER_COLUMNS} WHERE crew_id = ? AND name_key = ?`).bind(crewId, key).first();
      return row ? toMember(row) : null;
    },

    async countMembers(crewId) {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM members WHERE crew_id = ?').bind(crewId).first();
      return Number(row?.n ?? 0);
    },

    async putMember(crewId, row) {
      await db.prepare(
        `INSERT INTO members (crew_id, account_id, name, name_key, summary, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (crew_id, account_id) DO UPDATE SET name = excluded.name,
           name_key = excluded.name_key, summary = excluded.summary, updated_at = excluded.updated_at`,
      ).bind(crewId, row.accountId, row.name, row.nameKey, row.summary, row.updatedAt).run();
    },

    async listMembers(crewId) {
      const result = await db.prepare(`${MEMBER_COLUMNS} WHERE crew_id = ? ORDER BY updated_at DESC`).bind(crewId).all();
      return (result.results ?? []).map(toMember);
    },

    async deleteMember(crewId, accountId) {
      await db.prepare('DELETE FROM members WHERE crew_id = ? AND account_id = ?').bind(crewId, accountId).run();
    },
  };
}

const ACCOUNT_COLUMNS =
  'SELECT id, handle_key, handle, display_name, salt, key_hash, recovery_hash, created_at FROM accounts';

const MEMBER_COLUMNS = 'SELECT account_id, name, name_key, summary, updated_at FROM members';

function toAccount(row: Record<string, unknown>): AccountRow {
  return {
    id: row.id as string,
    handleKey: row.handle_key as string,
    handle: row.handle as string,
    displayName: row.display_name as string,
    salt: row.salt as string,
    keyHash: row.key_hash as string,
    recoveryHash: row.recovery_hash as string,
    createdAt: Number(row.created_at),
  };
}

function toMember(row: Record<string, unknown>): MemberRow {
  return {
    accountId: row.account_id as string,
    name: row.name as string,
    nameKey: (row.name_key as string) ?? '',
    summary: row.summary as string,
    updatedAt: Number(row.updated_at),
  };
}

/** Minimal shape of what this worker uses from D1, so no types package is needed. */
export interface D1Database {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first(): Promise<Record<string, unknown> | null>;
      all(): Promise<{ results?: Record<string, unknown>[] }>;
      run(): Promise<unknown>;
    };
  };
}
