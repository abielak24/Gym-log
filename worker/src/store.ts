/**
 * Storage, behind an interface.
 *
 * The request handler is written against this rather than against D1, so
 * every rule in it can be tested in an ordinary test run with nothing
 * deployed anywhere.
 */

export interface CrewRow {
  id: string;
  secretHash: string;
  /** Held only by the phone that made the crew. */
  adminTokenHash: string;
}

export interface MemberRow {
  memberId: string;
  tokenHash: string;
  /** Lets this row be claimed from another device. Empty when none was set. */
  passcodeHash: string;
  name: string;
  /** The name, folded, so a row can be found by it without matching case. */
  nameKey: string;
  summary: string;
  updatedAt: number;
}

export interface Store {
  createCrew(id: string, secretHash: string, adminTokenHash: string, now: number): Promise<void>;
  getCrew(id: string): Promise<CrewRow | null>;
  /** Changing the secret is what makes removing somebody stick. */
  setCrewSecret(id: string, secretHash: string): Promise<void>;
  getMember(crewId: string, memberId: string): Promise<MemberRow | null>;
  findMemberByName(crewId: string, nameKey: string): Promise<MemberRow | null>;
  setMemberToken(crewId: string, memberId: string, tokenHash: string): Promise<void>;
  countMembers(crewId: string): Promise<number>;
  putMember(crewId: string, row: MemberRow): Promise<void>;
  listMembers(crewId: string): Promise<MemberRow[]>;
  deleteMember(crewId: string, memberId: string): Promise<void>;
}

/** Fold a display name so it can be looked up without matching case. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The D1 implementation. Nothing here has rules in it; the handler has those. */
export function d1Store(db: D1Database): Store {
  return {
    async createCrew(id, secretHash, adminTokenHash, now) {
      await db.prepare('INSERT INTO crews (id, secret_hash, admin_token_hash, created_at) VALUES (?, ?, ?, ?)')
        .bind(id, secretHash, adminTokenHash, now).run();
    },

    async getCrew(id) {
      const row = await db.prepare('SELECT id, secret_hash, admin_token_hash FROM crews WHERE id = ?').bind(id).first();
      return row
        ? {
            id: row.id as string,
            secretHash: row.secret_hash as string,
            adminTokenHash: (row.admin_token_hash as string) ?? '',
          }
        : null;
    },

    async setCrewSecret(id, secretHash) {
      await db.prepare('UPDATE crews SET secret_hash = ? WHERE id = ?').bind(secretHash, id).run();
    },

    async findMemberByName(crewId, key) {
      const row = await db.prepare(
        `SELECT member_id, token_hash, passcode_hash, name, name_key, summary, updated_at
         FROM members WHERE crew_id = ? AND name_key = ?`,
      ).bind(crewId, key).first();
      return row ? toMember(row) : null;
    },

    async setMemberToken(crewId, memberId, tokenHash) {
      await db.prepare('UPDATE members SET token_hash = ? WHERE crew_id = ? AND member_id = ?')
        .bind(tokenHash, crewId, memberId).run();
    },

    async getMember(crewId, memberId) {
      const row = await db.prepare(
        `SELECT member_id, token_hash, passcode_hash, name, name_key, summary, updated_at
         FROM members WHERE crew_id = ? AND member_id = ?`,
      ).bind(crewId, memberId).first();
      return row ? toMember(row) : null;
    },

    async countMembers(crewId) {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM members WHERE crew_id = ?').bind(crewId).first();
      return Number(row?.n ?? 0);
    },

    async putMember(crewId, row) {
      await db.prepare(
        `INSERT INTO members (crew_id, member_id, token_hash, passcode_hash, name, name_key, summary, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (crew_id, member_id) DO UPDATE SET name = excluded.name,
           name_key = excluded.name_key, summary = excluded.summary,
           updated_at = excluded.updated_at,
           passcode_hash = CASE WHEN excluded.passcode_hash = '' THEN members.passcode_hash
                                ELSE excluded.passcode_hash END`,
      ).bind(crewId, row.memberId, row.tokenHash, row.passcodeHash, row.name, row.nameKey, row.summary, row.updatedAt).run();
    },

    async listMembers(crewId) {
      const result = await db.prepare(
        `SELECT member_id, token_hash, passcode_hash, name, name_key, summary, updated_at
         FROM members WHERE crew_id = ? ORDER BY updated_at DESC`,
      ).bind(crewId).all();
      return (result.results ?? []).map(toMember);
    },

    async deleteMember(crewId, memberId) {
      await db.prepare('DELETE FROM members WHERE crew_id = ? AND member_id = ?').bind(crewId, memberId).run();
    },
  };
}

function toMember(row: Record<string, unknown>): MemberRow {
  return {
    memberId: row.member_id as string,
    tokenHash: row.token_hash as string,
    passcodeHash: (row.passcode_hash as string) ?? '',
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
