/**
 * Getting your log out, and back in.
 *
 * The text export is the real one: it is the notebook, as plain text, in the
 * same format you typed. It opens in any editor on any machine in twenty
 * years' time. The JSON export exists only so a restore is byte-exact.
 */

import type { Session } from './types';
import { parsePage } from './parse';

const PAGE_BREAK = /^-{3,}$/;
const HEADER_WITH_DATE = /(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*$/;

/** One page per day; a second page on the same date gets a suffix. */
export function newSessionId(date: string, existing: Session[]): string {
  const taken = new Set(existing.map((s) => s.id));
  if (!taken.has(date)) return date;
  for (let n = 2; ; n++) {
    const candidate = `${date}#${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function exportText(sessions: Session[]): string {
  return [...sessions]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((s) => s.text.trimEnd())
    .join('\n\n\n')
    .concat('\n');
}

/**
 * Split an exported file back into pages.
 *
 * A page starts at a `---` break, or at a line ending in a date that follows
 * a blank line — which is exactly what the app writes at the top of every page.
 */
export function importText(text: string, today = new Date()): Session[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks: string[][] = [];
  let currentChunk: string[] | null = null;
  let previousBlank = true;

  for (const line of lines) {
    const trimmed = line.trim();

    if (PAGE_BREAK.test(trimmed)) {
      currentChunk = null;
      previousBlank = true;
      continue;
    }

    const startsPage = previousBlank && trimmed !== '' && HEADER_WITH_DATE.test(trimmed);
    if (startsPage || currentChunk === null) {
      if (trimmed === '') continue;
      currentChunk = [];
      chunks.push(currentChunk);
    }
    currentChunk.push(line);
    previousBlank = trimmed === '';
  }

  const sessions: Session[] = [];
  for (const chunk of chunks) {
    const pageText = chunk.join('\n').trimEnd();
    if (!pageText.trim()) continue;
    const page = parsePage(pageText, today);
    const date = page.date ?? isoToday(today);
    sessions.push({ id: newSessionId(date, sessions), date, text: pageText, updatedAt: Date.now() });
  }
  return sessions;
}

export function exportJson(sessions: Session[]): string {
  return JSON.stringify({ format: 'gym-notebook', version: 1, sessions }, null, 2);
}

export function importJson(text: string): Session[] {
  const parsed = JSON.parse(text) as { sessions?: unknown };
  if (!parsed || !Array.isArray(parsed.sessions)) throw new Error('not a gym-notebook backup');

  return parsed.sessions.map((raw) => {
    const s = raw as Partial<Session>;
    if (typeof s.text !== 'string' || typeof s.date !== 'string') throw new Error('a page in this backup is missing its text or date');
    return {
      id: typeof s.id === 'string' ? s.id : s.date,
      date: s.date,
      text: s.text,
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
      sample: s.sample === true ? true : undefined,
    };
  });
}

/**
 * Fold imported pages into the ones already on the device.
 *
 * A restore should put back what you saved, so an incoming page replaces the
 * one it shares an id with. Pages that only exist on one side are kept.
 */
export function mergeSessions(existing: Session[], incoming: Session[]): { sessions: Session[]; added: number; replaced: number } {
  const byId = new Map(existing.map((s) => [s.id, s]));
  let added = 0;
  let replaced = 0;

  for (const session of incoming) {
    const current = byId.get(session.id);
    if (!current) {
      byId.set(session.id, session);
      added += 1;
    } else if (current.text.trimEnd() !== session.text.trimEnd()) {
      byId.set(session.id, { ...session, sample: undefined });
      replaced += 1;
    }
  }

  const sessions = [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { sessions, added, replaced };
}

export function isoToday(today = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}
