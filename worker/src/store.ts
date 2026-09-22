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
}

export interface MemberRow {
  memberId: string;
  tokenHash: string;
  name: string;
  summary: string;
  updatedAt: number;
}

export interface Store {
  createCrew(id: string, secretHash: string, now: number): Promise<void>;
  getCrew(id: string): Promise<CrewRow | null>;
  getMember(crewId: string, memberId: string): Promise<MemberRow | null>;
  countMembers(crewId: string): Promise<number>;
  putMember(crewId: string, row: MemberRow): Promise<void>;
  listMembers(crewId: string): Promise<MemberRow[]>;
  deleteMember(crewId: string, memberId: string): Promise<void>;
}

/** The D1 implementation. Nothing here has rules in it; the handler has those. */
export function d1Store(db: D1Database): Store {
  return {
    async createCrew(id, secretHash, now) {
      await db.prepare('INSERT INTO crews (id, secret_hash, created_at) VALUES (?, ?, ?)')
        .bind(id, secretHash, now).run();
    },

    async getCrew(id) {
      const row = await db.prepare('SELECT id, secret_hash FROM crews WHERE id = ?').bind(id).first();
      return row ? { id: row.id as string, secretHash: row.secret_hash as string } : null;
    },

    async getMember(crewId, memberId) {
      const row = await db.prepare(
        'SELECT member_id, token_hash, name, summary, updated_at FROM members WHERE crew_id = ? AND member_id = ?',
      ).bind(crewId, memberId).first();
      return row ? toMember(row) : null;
    },

    async countMembers(crewId) {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM members WHERE crew_id = ?').bind(crewId).first();
      return Number(row?.n ?? 0);
    },

    async putMember(crewId, row) {
      await db.prepare(
        `INSERT INTO members (crew_id, member_id, token_hash, name, summary, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (crew_id, member_id) DO UPDATE SET name = excluded.name,
           summary = excluded.summary, updated_at = excluded.updated_at`,
      ).bind(crewId, row.memberId, row.tokenHash, row.name, row.summary, row.updatedAt).run();
    },

    async listMembers(crewId) {
      const result = await db.prepare(
        'SELECT member_id, token_hash, name, summary, updated_at FROM members WHERE crew_id = ? ORDER BY updated_at DESC',
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
    name: row.name as string,
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
