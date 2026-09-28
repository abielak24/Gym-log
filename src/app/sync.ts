/**
 * Keeping one account's log the same on every device it is signed in on.
 *
 * Nothing here is ever in the way. Writing a set is a local write that
 * returns immediately; this runs afterwards, fails quietly, and tries again
 * on the next change or the next time the app is opened. A phone with no
 * signal is a phone whose log still works.
 *
 * The merge itself is in `core/sync.ts`, with no network in it, which is
 * where the rules that could lose a workout are tested.
 */

import { adopt, collect, merge, pruneTombstones, type SyncRecord } from '../core/sync';
import { accountHeaders } from './auth';
import { apiBase, ApiError, isConfigured } from './crew';
import * as store from './store';

/** How long after a change to send it, so a burst of typing is one request. */
const SETTLE = 4000;
/** Records per push, matching what the server will take. */
const BATCH = 400;
/** Pages of history to pull in one go, so a huge log cannot loop forever. */
const MAX_PAGES = 50;

export type SyncResult = 'synced' | 'unchanged' | 'offline' | 'signed-out' | 'not-configured' | 'busy';

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastResult: SyncResult | null = null;
const listeners = new Set<() => void>();

export function onSyncChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(result: SyncResult): SyncResult {
  lastResult = result;
  for (const listener of listeners) listener();
  return result;
}

export function syncState(): { at: number; running: boolean; last: SyncResult | null } {
  return { at: store.syncedAt(), running, last: lastResult };
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...accountHeaders(), ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const failed = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError((failed as { error?: string }).error ?? `request failed (${response.status})`, response.status);
  }
  return response.json();
}

/**
 * Send what changed, then take what changed elsewhere.
 *
 * In that order, so a device that has been offline with real work on it
 * gets that work onto the server before anything can arrive and interleave
 * with it. Both directions are safe to repeat: the merge only ever takes
 * the newer of a pair.
 */
export async function syncNow(): Promise<SyncResult> {
  if (!isConfigured()) return announce('not-configured');

  const account = store.account();
  if (!account) return announce('signed-out');
  if (running) return 'busy';

  running = true;
  announce(lastResult ?? 'unchanged');

  try {
    // A log written before this account signed in has no stamps on it, so
    // none of it would be collected. This is what adopts it.
    if (store.syncScope() !== account.id) {
      store.applySyncable(adopt(store.syncable(), Date.now()));
      store.markSynced(0, account.id);
    }

    const since = store.syncedAt();
    const mine = collect(store.syncable(), since);
    let sent = false;

    for (let at = 0; at < mine.length; at += BATCH) {
      await call('/log', { method: 'PUT', body: JSON.stringify({ records: mine.slice(at, at + BATCH) }) });
      sent = true;
    }

    let cursor = since;
    let took = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await call(`/log?since=${cursor}`) as {
        records: SyncRecord[]; cursor: number; now: number; more: boolean;
      };

      const current = store.syncable();
      const next = merge(current, body.records);
      // Every pull hands back what this device just pushed, so redrawing on
      // "records arrived" would redraw on every single sync.
      if (next !== current) {
        store.applySyncable(pruneTombstones(next, Date.now()));
        took = true;

        // A real log has arrived, so the demo history this device loaded on
        // its first open is in the way: two Chest days, one of them fiction.
        // A device that pulls nothing keeps its samples, which is the whole
        // point of them.
        if (store.hasSamples()) store.clearSamples();
      }

      cursor = body.cursor;
      if (!body.more) break;
    }

    store.markSynced(cursor, account.id);
    return announce(sent || took ? 'synced' : 'unchanged');
  } catch (error) {
    // A token this device is holding has stopped working - recovered from
    // elsewhere, most likely. Nothing to do here but stop pretending.
    if (error instanceof ApiError && error.status === 401) return announce('signed-out');
    return announce('offline');
  } finally {
    running = false;
  }
}

/** Ask for a sync soon, coalescing a burst of changes into one. */
export function syncSoon(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, SETTLE);
}

/** Send now, without waiting, for the moments a phone is about to vanish. */
export function syncBeforeLeaving(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  void syncNow();
}

let started = false;

/**
 * Start syncing, and keep it going.
 *
 * The router calls this on every navigation, because it is the one place
 * that knows somebody is signed in. Subscribing more than once would stack
 * a listener per screen visited, so it happens once.
 */
export function startSyncing(): void {
  if (started) return;
  started = true;

  store.subscribe(syncSoon);

  const leaving = () => {
    if (document.visibilityState === 'hidden') syncBeforeLeaving();
  };
  window.addEventListener('pagehide', syncBeforeLeaving);
  document.addEventListener('visibilitychange', leaving);
  // Coming back to an app that has been open for days, on the other device.
  window.addEventListener('online', () => void syncNow());

  void syncNow();
}
