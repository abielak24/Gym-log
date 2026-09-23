/**
 * Talking to a crew.
 *
 * Every call here is allowed to fail. Logging a workout never waits on the
 * network, posting is best-effort and retried later, and the board keeps its
 * last good copy so the tab still says something useful on a train.
 */

import { buildSummary, type MemberSummary } from '../core/summary';
import * as store from './store';

/**
 * The deployed crew worker. Empty would mean sharing is not set up, and the
 * Friends tab would say so rather than pretending to work.
 */
const DEFAULT_API = 'https://gym-log-crew.abielak24.workers.dev';

/** An override, so a deploy can be pointed at without rebuilding the app. */
const API_OVERRIDE = 'gym-notebook:crew-api';

export interface BoardMember {
  memberId: string;
  name: string;
  updatedAt: number;
  summary: MemberSummary | null;
}

export function apiBase(): string {
  try {
    return (localStorage.getItem(API_OVERRIDE) || DEFAULT_API).replace(/\/+$/, '');
  } catch {
    return DEFAULT_API;
  }
}

export function isConfigured(): boolean {
  return apiBase() !== '';
}

/** What this phone would post right now. */
export function mySummary(): MemberSummary {
  return buildSummary({
    name: store.crew()?.name ?? '',
    sessions: store.sessions(),
    daily: store.dailyLog(),
    hidden: store.hiddenFromCrew(),
  });
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${apiBase()}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((body as { error?: string }).error ?? `request failed (${response.status})`);
  }
  return response;
}

export async function createCrew(name: string): Promise<void> {
  const response = await send('/crew', { method: 'POST' });
  const { crewId, secret } = await response.json() as { crewId: string; secret: string };

  store.setCrew({ id: crewId, secret, memberId: randomId(), token: randomId(), name });
  await postSummary(true);
}

export async function joinCrew(crewId: string, secret: string, name: string): Promise<void> {
  const existing = store.crew();
  // Rejoining the same crew keeps this phone's identity, so its row updates
  // rather than a second one appearing under the same person.
  const identity = existing && existing.id === crewId
    ? { memberId: existing.memberId, token: existing.token }
    : { memberId: randomId(), token: randomId() };

  store.setCrew({ id: crewId, secret, name, ...identity });
  await postSummary(true);
}

export type PostResult = 'posted' | 'unchanged' | 'paused' | 'no-crew' | 'not-configured' | 'failed';

export async function postSummary(force = false): Promise<PostResult> {
  if (!isConfigured()) return 'not-configured';

  const crew = store.crew();
  if (!crew) return 'no-crew';
  if (store.crewPaused() && !force) return 'paused';

  const summary = mySummary();
  const body = JSON.stringify(summary);
  if (!force && body === store.lastPosted()) return 'unchanged';

  try {
    await send(`/crew/${encodeURIComponent(crew.id)}/member/${encodeURIComponent(crew.memberId)}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-crew-secret': crew.secret,
        'x-member-token': crew.token,
      },
      body,
    });
    store.rememberPosted(body);
    return 'posted';
  } catch {
    // Nothing to tell the user: it will go out with the next change.
    return 'failed';
  }
}

export async function fetchBoard(): Promise<'ok' | 'failed' | 'no-crew' | 'not-configured'> {
  if (!isConfigured()) return 'not-configured';

  const crew = store.crew();
  if (!crew) return 'no-crew';

  try {
    const response = await send(`/crew/${encodeURIComponent(crew.id)}`, {
      headers: { 'x-crew-secret': crew.secret },
    });
    const { members } = await response.json() as { members: BoardMember[] };
    store.setBoard(members);
    return 'ok';
  } catch {
    return 'failed';
  }
}

export async function leaveCrew(): Promise<void> {
  const crew = store.crew();
  if (crew && isConfigured()) {
    try {
      await send(`/crew/${encodeURIComponent(crew.id)}/member/${encodeURIComponent(crew.memberId)}`, {
        method: 'DELETE',
        headers: { 'x-crew-secret': crew.secret, 'x-member-token': crew.token },
      });
    } catch {
      // Leaving locally matters more than the row disappearing promptly.
    }
  }
  store.clearCrew();
}

/** The link that both gives someone the app and puts them in the crew. */
export function joinLink(): string {
  const crew = store.crew();
  if (!crew) return '';
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/join/${crew.id}-${crew.secret}`;
}

export function parseJoinLink(rest: string): { crewId: string; secret: string } | null {
  const match = /^([A-Za-z0-9_-]+)-([A-Za-z0-9_-]+)$/.exec(rest.trim());
  return match ? { crewId: match[1], secret: match[2] } : null;
}
