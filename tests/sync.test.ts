import { describe, expect, it } from 'vitest';
import { adopt, collect, merge, pruneTombstones, stampKey, type Syncable, type SyncRecord } from '../src/core/sync';
import type { Session } from '../src/core/types';

function empty(): Syncable {
  return { sessions: [], daily: {}, overrides: [], starred: [], hiddenFromCrew: [], touched: {}, tombstones: {} };
}

function session(id: string, updatedAt: number, text = `9/22 Legs\nSquat\n225x5`): Session {
  return { id, date: '2025-09-22', text, updatedAt };
}

describe('collecting what has changed', () => {
  it('sends a session written since the last sync', () => {
    const state = { ...empty(), sessions: [session('a', 200)] };
    expect(collect(state, 100).map((r) => r.id)).toEqual(['a']);
  });

  it('and leaves one that has not', () => {
    const state = { ...empty(), sessions: [session('a', 50)] };
    expect(collect(state, 100)).toEqual([]);
  });

  // Demo data is scaffolding. Syncing it would put it on a real phone.
  it('never sends the sample pages', () => {
    const state = { ...empty(), sessions: [{ ...session('a', 200), sample: true }] };
    expect(collect(state, 100)).toEqual([]);
  });

  it('sends a deletion as a record of its own', () => {
    const state = { ...empty(), tombstones: { 'session:a': 300 } };
    const sent = collect(state, 100);
    expect(sent).toEqual([{ kind: 'session', id: 'a', updatedAt: 300, deleted: true }]);
  });

  it('sends tracked days, splits, stars and held-back lifts', () => {
    const state: Syncable = {
      ...empty(),
      daily: { '2025-09-22': [{ name: 'Steps', key: 'steps', goal: '10k', value: '8k' }] },
      overrides: [{ key: 'legs', name: 'Leg Day' }],
      starred: ['squat'],
      hiddenFromCrew: ['deadlift'],
      touched: {
        'daily:2025-09-22': 200, 'override:legs': 200, 'starred:squat': 200, 'hidden:deadlift': 200,
      },
    };
    expect(collect(state, 100).map((r) => r.kind).sort())
      .toEqual(['daily', 'hidden', 'override', 'starred']);
  });

  it('keeps an id containing a colon in one piece', () => {
    const state = { ...empty(), tombstones: { 'starred:bench:press': 300 } };
    expect(collect(state, 100)[0].id).toBe('bench:press');
  });
});

describe('merging what arrived', () => {
  it('takes a session this phone has never seen', () => {
    const next = merge(empty(), [{ kind: 'session', id: 'a', updatedAt: 200, body: session('a', 200) }]);
    expect(next.sessions).toHaveLength(1);
  });

  it('takes a newer version of one it has', () => {
    const state = { ...empty(), sessions: [session('a', 100, 'old')] };
    const next = merge(state, [{ kind: 'session', id: 'a', updatedAt: 200, body: session('a', 200, 'new') }]);
    expect(next.sessions[0].text).toBe('new');
  });

  it('and refuses an older one', () => {
    const state = { ...empty(), sessions: [session('a', 300, 'mine')] };
    const next = merge(state, [{ kind: 'session', id: 'a', updatedAt: 200, body: session('a', 200, 'theirs') }]);
    expect(next.sessions[0].text).toBe('mine');
  });

  it('applies the same records twice without changing anything', () => {
    const incoming: SyncRecord[] = [{ kind: 'session', id: 'a', updatedAt: 200, body: session('a', 200) }];
    const once = merge(empty(), incoming);
    expect(merge(once, incoming)).toEqual(once);
  });

  it('marks an arriving page as real training, not demo data', () => {
    const next = merge(empty(), [
      { kind: 'session', id: 'a', updatedAt: 200, body: { ...session('a', 200), sample: true } },
    ]);
    expect(next.sessions[0].sample).toBeUndefined();
  });

  it('never ends up with two rows for one id', () => {
    const state = { ...empty(), sessions: [session('a', 100)] };
    const next = merge(state, [{ kind: 'session', id: 'a', updatedAt: 200, body: session('a', 200) }]);
    expect(next.sessions).toHaveLength(1);
  });

  it('keeps sessions newest first', () => {
    const next = merge(empty(), [
      { kind: 'session', id: 'a', updatedAt: 200, body: { ...session('a', 200), date: '2025-09-01' } },
      { kind: 'session', id: 'b', updatedAt: 200, body: { ...session('b', 200), date: '2025-09-30' } },
    ]);
    expect(next.sessions.map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('deleting', () => {
  it('removes a session a tombstone buries', () => {
    const state = { ...empty(), sessions: [session('a', 100)] };
    const next = merge(state, [{ kind: 'session', id: 'a', updatedAt: 200, deleted: true }]);
    expect(next.sessions).toEqual([]);
  });

  // The whole reason tombstones exist.
  it('does not let the other phone put it back on the next sync', () => {
    const state = { ...empty(), sessions: [session('a', 100)] };
    const deleted = merge(state, [{ kind: 'session', id: 'a', updatedAt: 200, deleted: true }]);
    const again = merge(deleted, [{ kind: 'session', id: 'a', updatedAt: 100, body: session('a', 100) }]);
    expect(again.sessions).toEqual([]);
  });

  it('but a genuinely later edit undoes the delete', () => {
    const state = { ...empty(), sessions: [session('a', 100)] };
    const deleted = merge(state, [{ kind: 'session', id: 'a', updatedAt: 200, deleted: true }]);
    const rewritten = merge(deleted, [{ kind: 'session', id: 'a', updatedAt: 300, body: session('a', 300, 'back') }]);
    expect(rewritten.sessions[0].text).toBe('back');
    expect(rewritten.tombstones[stampKey('session', 'a')]).toBeUndefined();
  });

  it('unstars a lift, rather than the star coming back', () => {
    const state = { ...empty(), starred: ['squat'], touched: { 'starred:squat': 100 } };
    const next = merge(state, [{ kind: 'starred', id: 'squat', updatedAt: 200, deleted: true }]);
    expect(next.starred).toEqual([]);
  });

  it('and forgets a tracked day', () => {
    const state = { ...empty(), daily: { '2025-09-22': [] }, touched: { 'daily:2025-09-22': 100 } };
    const next = merge(state, [{ kind: 'daily', id: '2025-09-22', updatedAt: 200, deleted: true }]);
    expect(next.daily['2025-09-22']).toBeUndefined();
  });
});

describe('two phones, round trip', () => {
  it('ends with both holding everything', () => {
    const phone = { ...empty(), sessions: [session('mon', 100)] };
    const laptop = { ...empty(), sessions: [session('tue', 110)] };

    const fromPhone = collect(phone, 0);
    const fromLaptop = collect(laptop, 0);

    const phoneAfter = merge(phone, fromLaptop);
    const laptopAfter = merge(laptop, fromPhone);

    expect(phoneAfter.sessions.map((s) => s.id).sort()).toEqual(['mon', 'tue']);
    expect(laptopAfter.sessions.map((s) => s.id).sort()).toEqual(['mon', 'tue']);
  });

  it('settles on the later edit when both changed the same day', () => {
    const phone = { ...empty(), sessions: [session('mon', 300, 'phone wrote this')] };
    const laptop = { ...empty(), sessions: [session('mon', 200, 'laptop wrote this')] };

    const phoneAfter = merge(phone, collect(laptop, 0));
    const laptopAfter = merge(laptop, collect(phone, 0));

    expect(phoneAfter.sessions[0].text).toBe('phone wrote this');
    expect(laptopAfter.sessions[0].text).toBe('phone wrote this');
  });

  it('carries a delete across without it bouncing back', () => {
    const phone = { ...empty(), sessions: [session('mon', 100)] };
    const laptop = { ...empty(), sessions: [session('mon', 100)] };

    const afterDelete = merge(phone, [{ kind: 'session', id: 'mon', updatedAt: 200, deleted: true }]);
    const laptopAfter = merge(laptop, collect(afterDelete, 0));
    const phoneAfter = merge(afterDelete, collect(laptopAfter, 0));

    expect(laptopAfter.sessions).toEqual([]);
    expect(phoneAfter.sessions).toEqual([]);
  });
});

describe('the first sign-in', () => {
  it('stamps a log that has never been synced so all of it goes up', () => {
    const state: Syncable = {
      ...empty(),
      sessions: [session('a', 100)],
      daily: { '2025-09-22': [] },
      starred: ['squat'],
    };
    expect(collect(state, 500)).toEqual([]);
    expect(collect(adopt(state, 900), 500)).toHaveLength(3);
  });

  it('leaves the samples out of it', () => {
    const state = { ...empty(), sessions: [{ ...session('a', 100), sample: true }] };
    expect(collect(adopt(state, 900), 0)).toEqual([]);
  });
});

describe('tombstones', () => {
  it('are kept while a phone might still need them', () => {
    const state = { ...empty(), tombstones: { 'session:a': 1_000_000 } };
    expect(pruneTombstones(state, 1_000_000 + 1000).tombstones).toHaveProperty('session:a');
  });

  it('and dropped once nothing can be holding the record', () => {
    const state = { ...empty(), tombstones: { 'session:a': 1_000_000 } };
    const later = 1_000_000 + 400 * 24 * 60 * 60 * 1000;
    expect(pruneTombstones(state, later).tombstones).toEqual({});
  });
});

describe('telling the caller whether anything applied', () => {
  it('hands back the same state when nothing was newer', () => {
    const state = { ...empty(), sessions: [session('a', 300)] };
    const incoming: SyncRecord[] = [{ kind: 'session', id: 'a', updatedAt: 200, body: session('a', 200) }];
    expect(merge(state, incoming)).toBe(state);
  });

  it('and a new one when something was', () => {
    const state = { ...empty(), sessions: [session('a', 100)] };
    const incoming: SyncRecord[] = [{ kind: 'session', id: 'a', updatedAt: 200, body: session('a', 200) }];
    expect(merge(state, incoming)).not.toBe(state);
  });

  it('never writes through to the state it was given', () => {
    const state = { ...empty(), sessions: [session('a', 100)] };
    const before = [...state.sessions];
    merge(state, [{ kind: 'session', id: 'b', updatedAt: 200, body: session('b', 200) }]);
    expect(state.sessions).toEqual(before);
  });
});
