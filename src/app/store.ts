/**
 * Where the log lives: this device, and nowhere else.
 *
 * There is no account and no server. That is the point — it works in a
 * basement gym with no signal — but it also means the export in `backup.ts`
 * is the only copy that survives a lost phone, so the app nags about it.
 */

import type { Session, Template, TemplateOverride } from '../core/types';
import { buildHistory, type History } from '../core/history';
import { parsePage } from '../core/parse';
import { isoToday, newSessionId } from '../core/serialize';
import { createSampleDaily, createSamples } from '../core/sample';
import { buildTemplates } from '../core/templates';
import { entriesFor, pruneLog, seedFor, type DailyEntry, type DailyLog } from '../core/daily';
import { writeCell } from '../core/edit';
import { normalizeName } from '../core/normalize';

const KEY = 'gym-notebook:v1';

interface Stored {
  version: 1;
  sessions: Session[];
  lastBackupAt: number | null;
  samplesCleared: boolean;
  /** Deliberate edits to the splits the log derives on its own. */
  overrides: TemplateOverride[];
  /** Exercise keys pinned to the summary. */
  starred: string[];
  /** The daily tracker, by ISO date. A date absent here was not tracked. */
  daily: DailyLog;
  /** Tracker days that came from the sample data, so they can be cleared. */
  sampleDaily: string[];
}

const EMPTY: Stored = {
  version: 1,
  sessions: [],
  lastBackupAt: null,
  samplesCleared: false,
  overrides: [],
  starred: [],
  daily: {},
  sampleDaily: [],
};

let state: Stored = EMPTY;
let history: History | null = null;
let templates: Template[] | null = null;
let storageWorks = true;
const listeners = new Set<() => void>();

export function load(today = new Date()): void {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...EMPTY, ...(JSON.parse(raw) as Stored) } : EMPTY;
  } catch {
    // Private browsing, or storage disabled. Run from memory and say so.
    storageWorks = false;
    state = EMPTY;
  }

  if (state.sessions.length === 0 && !state.samplesCleared) {
    addSamples(today);
  }
  history = null;
  templates = null;
}

/** False when the browser refused us storage — the UI warns instead of pretending. */
export function isDurable(): boolean {
  return storageWorks;
}

function persist(): void {
  history = null;
  templates = null;
  if (!storageWorks) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    storageWorks = false;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Newest page first. */
export function sessions(): Session[] {
  return state.sessions;
}

export function session(id: string): Session | undefined {
  return state.sessions.find((s) => s.id === id);
}

export function getHistory(): History {
  if (!history) history = buildHistory(state.sessions);
  return history;
}

export function getTemplates(): Template[] {
  if (!templates) templates = buildTemplates(state.sessions, state.overrides);
  return templates;
}

export function getTemplate(key: string): Template | undefined {
  return getTemplates().find((t) => t.key === key);
}

/**
 * A page for a split on a given day, started if it does not exist.
 *
 * The page title is what puts a session in a split, so writing the split's
 * name into the header is all the bookkeeping there is. The date is a
 * parameter because a workout you forgot to log is still a workout.
 */
export function startTemplateSession(name: string, on = new Date()): Session {
  const date = isoToday(on);
  const key = normalizeName(name);

  const existing = state.sessions.find((s) => s.date === date && normalizeName(parsePage(s.text).title) === key);
  if (existing) return existing;

  const created: Session = {
    id: newSessionId(date, state.sessions),
    date,
    text: `${on.getMonth() + 1}/${on.getDate()} ${name}`,
    updatedAt: Date.now(),
  };
  state = { ...state, sessions: [created, ...state.sessions] };
  persist();
  emit();
  return created;
}

/** Write one cell of the grid back into its page. */
export function saveCell(sessionId: string, exercise: string, lines: string[]): void {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  const text = writeCell(session.text, exercise, lines);
  if (text === session.text) return;
  saveText(sessionId, text, parsePage(text).date);
}

/** Parse an ISO date back into a local Date, for starting a session on it. */
export function dateFromIso(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function overrideFor(key: string): TemplateOverride | undefined {
  return state.overrides.find((o) => o.key === key);
}

export function saveOverride(key: string, patch: Partial<TemplateOverride>): void {
  const existing = overrideFor(key);
  const merged: TemplateOverride = { ...(existing ?? { key }), ...patch, key };
  state = {
    ...state,
    overrides: [...state.overrides.filter((o) => o.key !== key), merged],
  };
  persist();
  emit();
}

export function dailyLog(): DailyLog {
  return state.daily;
}

/** A day's rows: what was written, or the last tracked day's goals to start from. */
export function dailyFor(date: string): { entries: DailyEntry[]; seeded: boolean } {
  const stored = entriesFor(state.daily, date);
  if (stored.length > 0) return { entries: stored, seeded: false };
  return { entries: seedFor(state.daily, date), seeded: true };
}

export function saveDaily(date: string, entries: DailyEntry[]): void {
  state = {
    ...state,
    daily: pruneLog({ ...state.daily, [date]: entries }),
    // Once a sample day is written over, it is the user's day.
    sampleDaily: state.sampleDaily.filter((day) => day !== date),
  };
  persist();
  emit();
}

export function starredKeys(): string[] {
  return state.starred;
}

export function isStarred(key: string): boolean {
  return state.starred.includes(key);
}

export function toggleStar(key: string): void {
  const starred = state.starred.includes(key)
    ? state.starred.filter((k) => k !== key)
    : [...state.starred, key];
  state = { ...state, starred };
  persist();
  emit();
}

export function hasSamples(): boolean {
  return state.sessions.some((s) => s.sample) || state.sampleDaily.length > 0;
}

/**
 * Put the sample history in alongside whatever is already here.
 *
 * Days that already hold something real are left alone, so loading the
 * samples to see how a full log reads can never overwrite an actual workout.
 */
export function addSamples(today = new Date()): void {
  const takenDates = new Set(state.sessions.map((s) => s.date));
  const sessions = createSamples(today).filter((s) => !takenDates.has(s.date));

  const sampleDaily = createSampleDaily(today);
  const daily = { ...state.daily };
  const addedDays: string[] = [];

  for (const [date, entries] of Object.entries(sampleDaily)) {
    if (daily[date]?.length) continue;
    daily[date] = entries;
    addedDays.push(date);
  }

  state = {
    ...state,
    sessions: [...sessions, ...state.sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    daily,
    sampleDaily: [...new Set([...state.sampleDaily, ...addedDays])],
    samplesCleared: false,
  };
  persist();
  emit();
}

/** Today's page, created on first keystroke rather than on every app open. */
export function todaySession(today = new Date()): Session | null {
  const date = isoToday(today);
  return state.sessions.find((s) => s.date === date && !s.id.includes('#')) ?? null;
}

/**
 * Save a page's text.
 *
 * The date written in the header wins: retitling a page `Chest 9/19` moves it
 * to the 19th in the log, because that is plainly what you meant.
 */
export function saveText(id: string, text: string, date: string | null): void {
  const current = state.sessions.find((s) => s.id === id);
  if (!current) return;
  // Saving on every blur and every route change is normal; only tell anyone
  // when something actually changed.
  if (current.text === text && (date === null || current.date === date) && !current.sample) return;

  const sessions = state.sessions.map((s) =>
    s.id === id ? { ...s, text, date: date ?? s.date, updatedAt: Date.now(), sample: undefined } : s,
  );
  sessions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  state = { ...state, sessions };
  persist();
  emit();
}

export function deleteSession(id: string): void {
  state = { ...state, sessions: state.sessions.filter((s) => s.id !== id) };
  persist();
  emit();
}

export function clearSamples(): void {
  const daily = { ...state.daily };
  for (const date of state.sampleDaily) delete daily[date];

  state = {
    ...state,
    sessions: state.sessions.filter((s) => !s.sample),
    daily,
    sampleDaily: [],
    samplesCleared: true,
  };
  persist();
  emit();
}

export function replaceAll(sessions: Session[], daily?: DailyLog): void {
  state = { ...state, sessions, samplesCleared: true, daily: daily ?? state.daily };
  persist();
  emit();
}

/**
 * Drop pages that were opened and never written on.
 *
 * Today's page is created the moment you look at it, which would otherwise
 * litter the log with empty days every time the app is opened out of habit.
 */
export function pruneEmpty(keepId?: string): void {
  const kept = state.sessions.filter((s) => {
    if (s.id === keepId || s.sample) return true;
    const page = parsePage(s.text);
    return page.exercises.length > 0 || page.flagged.length > 0 || page.notes.length > 0;
  });
  if (kept.length === state.sessions.length) return;
  state = { ...state, sessions: kept };
  persist();
}

/**
 * Erase everything on this device: pages, splits, stars and tracked days.
 *
 * `samplesCleared` stays set so the sample history does not quietly
 * reappear on the next open — starting fresh means starting empty, and the
 * samples are one tap away for anyone who wants them back.
 */
export function clearEverything(): void {
  state = { ...EMPTY, samplesCleared: true };
  persist();
  emit();
}

export function isEmpty(): boolean {
  return state.sessions.length === 0 && Object.keys(state.daily).length === 0;
}

export function lastBackupAt(): number | null {
  return state.lastBackupAt;
}

export function markBackedUp(): void {
  state = { ...state, lastBackupAt: Date.now() };
  persist();
  emit();
}

/** True once a week has passed with real pages written and nothing exported. */
export function backupOverdue(now = Date.now()): boolean {
  const real = state.sessions.filter((s) => !s.sample);
  if (real.length === 0) return false;
  const since = state.lastBackupAt ?? Math.min(...real.map((s) => s.updatedAt));
  return now - since > 7 * 86400000;
}
