/**
 * Getting your log out, and back in.
 *
 * The text export is the real one: it is the notebook, as plain text, in the
 * same format you typed. It opens in any editor on any machine in twenty
 * years' time. The JSON export exists only so a restore is byte-exact.
 */

import type { Session } from './types';
import { parsePage } from './parse';
import { makeEntry, pruneLog, type DailyEntry, type DailyLog } from './daily';

const PAGE_BREAK = /^-{3,}$/;
/** `@ Steps 7.5k/10k` — a daily tracker row, kept out of the notebook proper. */
const DAILY_LINE = /^@\s*(.+?)\s+([^\s/]+)\s*\/\s*([^\s/]+)\s*$/;
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

/**
 * The notebook as plain text, with each day's tracker rows beneath it.
 *
 * Tracker rows are prefixed with `@` so they are unmistakably not sets, and
 * a day that was tracked without a workout still gets a dated header — it
 * happened, and the file is meant to hold everything.
 */
export function exportText(sessions: Session[], daily: DailyLog = {}): string {
  const byDate = new Map<string, string[]>();

  for (const session of sessions) {
    const list = byDate.get(session.date) ?? [];
    list.push(session.text.trimEnd());
    byDate.set(session.date, list);
  }

  for (const date of Object.keys(daily)) {
    if (!byDate.has(date)) byDate.set(date, [headerFor(date)]);
  }

  const dates = [...byDate.keys()].sort();

  const chunks = dates.map((date) => {
    const pages = byDate.get(date) ?? [];
    const rows = (daily[date] ?? []).map((entry) => `@ ${entry.name} ${entry.value || '-'}/${entry.goal || '-'}`);
    // The tracker belongs to the day, so it follows that day's last page.
    const body = [...pages];
    if (rows.length) body[body.length - 1] = `${body[body.length - 1]}\n\n${rows.join('\n')}`;
    return body.join('\n\n\n');
  });

  return chunks.join('\n\n\n').concat('\n');
}

function headerFor(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}/${day}`;
}

/**
 * Split an exported file back into pages.
 *
 * A page starts at a `---` break, or at a line ending in a date that follows
 * a blank line — which is exactly what the app writes at the top of every page.
 */
export function importText(text: string, today = new Date()): { sessions: Session[]; daily: DailyLog } {
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
  const daily: DailyLog = {};

  for (const chunk of chunks) {
    // Pull the tracker rows out before the rest is read as a notebook page.
    const rows: DailyEntry[] = [];
    const pageLines: string[] = [];

    for (const line of chunk) {
      const match = DAILY_LINE.exec(line.trim());
      if (match) {
        const [, name, value, goal] = match;
        rows.push(makeEntry(name, goal === '-' ? '' : goal, value === '-' ? '' : value));
      } else {
        pageLines.push(line);
      }
    }

    const pageText = pageLines.join('\n').trimEnd();
    if (!pageText.trim() && rows.length === 0) continue;

    const page = parsePage(pageText, today);
    const date = page.date ?? isoToday(today);

    if (rows.length > 0) daily[date] = [...(daily[date] ?? []), ...rows];
    // A day that was only tracked leaves a header and nothing else; there is
    // no workout to keep.
    if (page.exercises.length > 0 || page.flagged.length > 0 || page.notes.length > 0) {
      sessions.push({ id: newSessionId(date, sessions), date, text: pageText, updatedAt: Date.now() });
    }
  }

  return { sessions, daily: pruneLog(daily) };
}

export function exportJson(sessions: Session[], daily: DailyLog = {}): string {
  return JSON.stringify({ format: 'gym-notebook', version: 2, sessions, daily }, null, 2);
}

export function importJson(text: string): { sessions: Session[]; daily: DailyLog } {
  const parsed = JSON.parse(text) as { sessions?: unknown; daily?: unknown };
  if (!parsed || !Array.isArray(parsed.sessions)) throw new Error('not a gym-notebook backup');

  // Version 1 backups predate the tracker and simply have none.
  const daily = isDailyLog(parsed.daily) ? pruneLog(parsed.daily) : {};

  const sessions = parsed.sessions.map((raw) => {
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

  return { sessions, daily };
}

function isDailyLog(value: unknown): value is DailyLog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((entries) => Array.isArray(entries));
}

/** Fold a restored tracker into the one on this device, day by day. */
export function mergeDaily(existing: DailyLog, incoming: DailyLog): DailyLog {
  return pruneLog({ ...existing, ...incoming });
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
