/**
 * Where the log lives: this device, and nowhere else.
 *
 * There is no account and no server. That is the point — it works in a
 * basement gym with no signal — but it also means the export in `backup.ts`
 * is the only copy that survives a lost phone, so the app nags about it.
 */

import type { Session } from '../core/types';
import { buildHistory, type History } from '../core/history';
import { parsePage } from '../core/parse';
import { isoToday, newSessionId } from '../core/serialize';
import { createSamples } from '../core/sample';

const KEY = 'gym-notebook:v1';

interface Stored {
  version: 1;
  sessions: Session[];
  lastBackupAt: number | null;
  samplesCleared: boolean;
}

const EMPTY: Stored = { version: 1, sessions: [], lastBackupAt: null, samplesCleared: false };

let state: Stored = EMPTY;
let history: History | null = null;
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
    state = { ...state, sessions: createSamples(today) };
    persist();
  }
  history = null;
}

/** False when the browser refused us storage — the UI warns instead of pretending. */
export function isDurable(): boolean {
  return storageWorks;
}

function persist(): void {
  history = null;
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

export function hasSamples(): boolean {
  return state.sessions.some((s) => s.sample);
}

/** Today's page, created on first keystroke rather than on every app open. */
export function todaySession(today = new Date()): Session | null {
  const date = isoToday(today);
  return state.sessions.find((s) => s.date === date && !s.id.includes('#')) ?? null;
}

export function startToday(today = new Date()): Session {
  const existing = todaySession(today);
  if (existing) return existing;

  const date = isoToday(today);
  const created: Session = {
    id: newSessionId(date, state.sessions),
    date,
    // Date first and a trailing space, so the cursor lands where the day's
    // name goes: `9/22 Chest/Tris`.
    text: `${today.getMonth() + 1}/${today.getDate()} `,
    updatedAt: Date.now(),
  };
  state = { ...state, sessions: [created, ...state.sessions] };
  persist();
  emit();
  return created;
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
  state = { ...state, sessions: state.sessions.filter((s) => !s.sample), samplesCleared: true };
  persist();
  emit();
}

export function replaceAll(sessions: Session[]): void {
  state = { ...state, sessions, samplesCleared: true };
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
