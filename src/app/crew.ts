/**
 * Talking to a crew.
 *
 * Every call here is allowed to fail. Logging a workout never waits on the
 * network, posting is best-effort and retried later, and the board keeps its
 * last good copy so the tab still says something useful on a train.
 */

import { buildSummary, type MemberSummary } from '../core/summary';
import { accountHeaders } from './auth';
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
    name: store.crew()?.name ?? store.account()?.displayName ?? '',
    sessions: store.sessions(),
    daily: store.dailyLog(),
    hidden: store.hiddenFromCrew(),
  });
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${apiBase()}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError((body as { error?: string }).error ?? `request failed (${response.status})`, response.status);
  }
  return response;
}

/** An error that still knows what the server said, so callers can tell cases apart. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The headers a crew call needs: the link, and who is signed in. */
function identity(crew: NonNullable<ReturnType<typeof store.crew>>): Record<string, string> {
  return { 'x-crew-secret': crew.secret, ...accountHeaders() };
}

export async function createCrew(name: string): Promise<void> {
  const response = await send('/crew', { method: 'POST', headers: accountHeaders() });
  const { crewId, secret } = await response.json() as { crewId: string; secret: string };

  store.setCrew({ id: crewId, secret, name, ownerAccountId: store.account()?.id });
  await postSummary(true);
}

/**
 * Join a crew from its link.
 *
 * There is nothing to prove here beyond being signed in: the account is who
 * you are on every board, so opening a link twice updates one row rather
 * than making a second person.
 */
export async function joinCrew(crewId: string, secret: string, name: string): Promise<void> {
  const before = store.crew();
  store.setCrew({ id: crewId, secret, name });

  let result: PostResult;
  try {
    result = await postSummary(true);
  } catch (error) {
    restore(before);
    throw error;
  }

  // Posting swallows failures everywhere else, because logging a set must
  // never wait on a network. Joining is the one time silence is wrong: the
  // whole point of the tap was to reach the board.
  if (result !== 'posted') {
    restore(before);
    throw new Error('could not reach the board');
  }
}

/**
 * Put back whatever crew this phone was in.
 *
 * Joining writes the crew locally before it can know the server will accept
 * it, so a refusal has to undo that. Leaving it half-joined meant a phone
 * that looked like it was on a board it had never reached.
 */
function restore(before: ReturnType<typeof store.crew>): void {
  if (before) store.setCrew(before);
  else store.clearCrew();
}

/** Take somebody off the board. Only whoever started the crew can. */
export async function removeMember(memberId: string): Promise<void> {
  const crew = store.crew();
  if (!crew) throw new Error('not in a crew');

  await send(`/crew/${encodeURIComponent(crew.id)}/member/${encodeURIComponent(memberId)}`, {
    method: 'DELETE',
    headers: identity(crew),
  });
}

/**
 * A new join link, which is what makes a removal stick.
 *
 * Everyone still in the crew needs the new one, so the app says so rather
 * than letting people quietly fall off the board.
 */
export async function rotateLink(): Promise<void> {
  const crew = store.crew();
  if (!crew) throw new Error('not in a crew');

  const response = await send(`/crew/${encodeURIComponent(crew.id)}/rotate`, {
    method: 'POST',
    headers: identity(crew),
  });

  const { secret } = await response.json() as { secret: string };
  store.updateCrew({ secret });
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
    await send(`/crew/${encodeURIComponent(crew.id)}/member`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...identity(crew) },
      body,
    });
    store.rememberPosted(body);
    return 'posted';
  } catch (error) {
    // A name already taken is the caller's to deal with, and only when it
    // asked for this post. Everything else goes out with the next change and
    // needs nothing said now.
    if (force && error instanceof ApiError && error.status === 409) throw error;
    return 'failed';
  }
}

export async function fetchBoard(): Promise<'ok' | 'failed' | 'gone' | 'no-crew' | 'not-configured'> {
  if (!isConfigured()) return 'not-configured';

  const crew = store.crew();
  if (!crew) return 'no-crew';

  try {
    const response = await send(`/crew/${encodeURIComponent(crew.id)}`, {
      headers: { 'x-crew-secret': crew.secret },
    });
    const { members, ownerAccountId } = await response.json() as {
      members: BoardMember[]; ownerAccountId: string;
    };
    // Who owns the crew comes from the board rather than from anything this
    // phone was handed, so a device that signs in later still knows.
    if (crew.ownerAccountId !== ownerAccountId) store.updateCrew({ ownerAccountId });
    store.setBoard(members);
    return 'ok';
  } catch (error) {
    // Reachable but will not open: the link has been rotated and this phone
    // is holding the old one.
    if (error instanceof ApiError && error.status === 404) return 'gone';
    return 'failed';
  }
}

/**
 * Read a board from a link alone.
 *
 * The link is the credential for looking, so this works before joining -
 * which is what lets the join screen show who is already there.
 */
export async function peekBoard(
  crewId: string,
  secret: string,
): Promise<BoardMember[] | 'gone' | 'failed'> {
  if (!isConfigured()) return 'failed';

  try {
    const response = await send(`/crew/${encodeURIComponent(crewId)}`, {
      headers: { 'x-crew-secret': secret },
    });
    const { members } = await response.json() as { members: BoardMember[] };
    return members;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return 'gone';
    return 'failed';
  }
}

export async function leaveCrew(): Promise<void> {
  const crew = store.crew();
  if (crew && isConfigured()) {
    try {
      await send(`/crew/${encodeURIComponent(crew.id)}/member`, {
        method: 'DELETE',
        headers: identity(crew),
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

/**
 * Split a join link into the crew and its secret.
 *
 * The first hyphen is the separator and the rest is all secret. A greedy
 * split looked the same for the ids in use and broke the moment a secret
 * contained a hyphen of its own, which the link format should not depend on.
 */
export function parseJoinLink(rest: string): { crewId: string; secret: string } | null {
  const match = /^([A-Za-z0-9_]+)-(.+)$/.exec(rest.trim());
  return match ? { crewId: match[1], secret: match[2] } : null;
}
