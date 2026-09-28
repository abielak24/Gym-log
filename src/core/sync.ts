/**
 * Merging one log into another.
 *
 * Two phones both hold the whole log and both write to it, so a sync cannot
 * be "send mine" or "take theirs" — either loses a workout. Everything is
 * broken into records instead, each stamped with when it last changed, and a
 * merge takes the newer of each pair. A record nobody has changed is left
 * alone, which is almost all of them almost always.
 *
 * Deleting is a record too. Without that, a workout deleted on one phone
 * comes back from the other on the next sync, forever — the other phone
 * still has it and has no way to know it was ever meant to go.
 *
 * Last write wins, by the clock of whichever phone wrote it. Two phones
 * editing the same day between syncs means the later edit stands and the
 * earlier is gone; two phones with badly wrong clocks can get that backwards.
 * Both are the accepted cost of never asking somebody to resolve a conflict
 * between two versions of Tuesday.
 */

import type { DailyEntry, DailyLog } from './daily';
import type { Session, TemplateOverride } from './types';

export type RecordKind = 'session' | 'daily' | 'override' | 'starred' | 'hidden';

export interface SyncRecord {
  kind: RecordKind;
  id: string;
  updatedAt: number;
  /** A tombstone. Its body is empty and its job is to stay. */
  deleted?: boolean;
  body?: unknown;
}

/** The parts of the stored state that travel, and the stamps that order them. */
export interface Syncable {
  sessions: Session[];
  daily: DailyLog;
  overrides: TemplateOverride[];
  starred: string[];
  hiddenFromCrew: string[];
  /** `kind:id` to when it last changed here. */
  touched: Record<string, number>;
  /** `kind:id` to when it was deleted here. */
  tombstones: Record<string, number>;
}

export function stampKey(kind: RecordKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Everything that has changed here since a moment.
 *
 * A session carries its own `updatedAt` and needs no stamp; everything else
 * is stamped as it is written, because a starred lift has nowhere of its own
 * to record when it was starred.
 */
export function collect(state: Syncable, since: number): SyncRecord[] {
  const out: SyncRecord[] = [];

  const stamp = (kind: RecordKind, id: string, fallback = 0): number =>
    state.touched[stampKey(kind, id)] ?? fallback;

  const push = (kind: RecordKind, id: string, updatedAt: number, body: unknown) => {
    if (updatedAt > since) out.push({ kind, id, updatedAt, body });
  };

  for (const session of state.sessions) {
    // Sample pages are scaffolding, not training. Syncing them would put
    // somebody else's demo data on a real phone.
    if (session.sample) continue;
    push('session', session.id, Math.max(session.updatedAt, stamp('session', session.id)), session);
  }

  for (const [date, entries] of Object.entries(state.daily)) {
    push('daily', date, stamp('daily', date), entries);
  }

  for (const override of state.overrides) {
    push('override', override.key, stamp('override', override.key), override);
  }

  for (const key of state.starred) push('starred', key, stamp('starred', key), true);
  for (const key of state.hiddenFromCrew) push('hidden', key, stamp('hidden', key), true);

  for (const [key, deletedAt] of Object.entries(state.tombstones)) {
    if (deletedAt <= since) continue;
    const [kind, ...rest] = key.split(':');
    out.push({ kind: kind as RecordKind, id: rest.join(':'), updatedAt: deletedAt, deleted: true });
  }

  return out;
}

/** When a record is already here, as far as this device knows. */
function localStamp(state: Syncable, record: SyncRecord): number {
  const tomb = state.tombstones[stampKey(record.kind, record.id)] ?? 0;
  const touched = state.touched[stampKey(record.kind, record.id)] ?? 0;

  if (record.kind === 'session') {
    const session = state.sessions.find((s) => s.id === record.id);
    return Math.max(tomb, touched, session?.updatedAt ?? 0);
  }
  return Math.max(tomb, touched);
}

/**
 * Take in what another device wrote.
 *
 * Nothing is applied unless it is strictly newer than what is here, so a
 * merge can be run twice, or against records this device sent itself,
 * without moving anything.
 */
export function merge(state: Syncable, incoming: SyncRecord[]): Syncable {
  let next = state;
  let changed = false;

  for (const record of incoming) {
    if (record.updatedAt <= localStamp(next, record)) continue;
    next = record.deleted ? remove(next, record) : write(next, record);
    changed = true;
  }

  // The same object back when nothing applied, so a caller can tell at a
  // glance whether a redraw is owed. A pull hands back the records the
  // device itself just pushed, and almost every sync is exactly that.
  if (!changed) return state;

  // Newest first, the order the rest of the app expects.
  const sessions = [...next.sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { ...next, sessions };
}

function write(state: Syncable, record: SyncRecord): Syncable {
  const key = stampKey(record.kind, record.id);
  const touched = { ...state.touched, [key]: record.updatedAt };
  // Arriving again undoes a delete, which is what a later edit means.
  const tombstones = { ...state.tombstones };
  delete tombstones[key];

  switch (record.kind) {
    case 'session': {
      const session = record.body as Session;
      const sessions = state.sessions.filter((s) => s.id !== record.id);
      // `sample` is a local notion: a page that arrives from another device
      // is real training there, so it must not be clearable as demo data.
      sessions.push({ ...session, id: record.id, sample: undefined, updatedAt: record.updatedAt });
      return { ...state, sessions, touched, tombstones };
    }
    case 'daily':
      return {
        ...state,
        daily: { ...state.daily, [record.id]: record.body as DailyEntry[] },
        touched,
        tombstones,
      };
    case 'override': {
      const override = record.body as TemplateOverride;
      const overrides = state.overrides.filter((o) => o.key !== record.id);
      overrides.push({ ...override, key: record.id });
      return { ...state, overrides, touched, tombstones };
    }
    case 'starred':
      return {
        ...state,
        starred: state.starred.includes(record.id) ? state.starred : [...state.starred, record.id],
        touched,
        tombstones,
      };
    case 'hidden':
      return {
        ...state,
        hiddenFromCrew: state.hiddenFromCrew.includes(record.id)
          ? state.hiddenFromCrew
          : [...state.hiddenFromCrew, record.id],
        touched,
        tombstones,
      };
    default:
      return state;
  }
}

function remove(state: Syncable, record: SyncRecord): Syncable {
  const key = stampKey(record.kind, record.id);
  const tombstones = { ...state.tombstones, [key]: record.updatedAt };
  const touched = { ...state.touched };
  delete touched[key];

  switch (record.kind) {
    case 'session':
      return { ...state, sessions: state.sessions.filter((s) => s.id !== record.id), touched, tombstones };
    case 'daily': {
      const daily = { ...state.daily };
      delete daily[record.id];
      return { ...state, daily, touched, tombstones };
    }
    case 'override':
      return { ...state, overrides: state.overrides.filter((o) => o.key !== record.id), touched, tombstones };
    case 'starred':
      return { ...state, starred: state.starred.filter((k) => k !== record.id), touched, tombstones };
    case 'hidden':
      return { ...state, hiddenFromCrew: state.hiddenFromCrew.filter((k) => k !== record.id), touched, tombstones };
    default:
      return state;
  }
}

/**
 * Stamp everything as changed now.
 *
 * What the first sign-in does: a phone that has been logging without an
 * account has a whole log with no stamps on it, and all of it is new to the
 * account it is about to belong to.
 */
export function adopt(state: Syncable, now: number): Syncable {
  const touched = { ...state.touched };

  for (const session of state.sessions) if (!session.sample) touched[stampKey('session', session.id)] = now;
  for (const date of Object.keys(state.daily)) touched[stampKey('daily', date)] = now;
  for (const override of state.overrides) touched[stampKey('override', override.key)] = now;
  for (const key of state.starred) touched[stampKey('starred', key)] = now;
  for (const key of state.hiddenFromCrew) touched[stampKey('hidden', key)] = now;

  return { ...state, touched };
}

/**
 * Forget tombstones nobody needs any more.
 *
 * A tombstone only has to outlive the last device that still holds the
 * record it buries. A year is far past the point where a phone that has not
 * synced is coming back with anything worth keeping.
 */
export const TOMBSTONE_LIFE = 365 * 24 * 60 * 60 * 1000;

export function pruneTombstones(state: Syncable, now: number): Syncable {
  const tombstones: Record<string, number> = {};
  for (const [key, at] of Object.entries(state.tombstones)) {
    if (now - at < TOMBSTONE_LIFE) tombstones[key] = at;
  }
  return { ...state, tombstones };
}
