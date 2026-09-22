/**
 * What you did last time.
 *
 * The whole reason for typing into a phone instead of a notebook: the page
 * knows what it watched you lift three days ago and can put it back in front
 * of you without being asked.
 */

import type { ExerciseBlock, Page, Session } from './types';
import { parsePage } from './parse';
import { normalizeName, similarity } from './normalize';

export interface HistoryEntry {
  sessionId: string;
  date: string;
  title: string;
  block: ExerciseBlock;
  /** The set lines exactly as they were written that day. */
  lines: string[];
}

export interface History {
  /** Newest first, per normalised exercise key. */
  byExercise: Map<string, HistoryEntry[]>;
  /** The most recently written spelling of each key, for display and autocomplete. */
  displayNames: Map<string, string>;
}

export function buildHistory(sessions: Session[]): History {
  const byExercise = new Map<string, HistoryEntry[]>();
  const displayNames = new Map<string, string>();

  const ordered = [...sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  for (const session of ordered) {
    const page: Page = parsePage(session.text);
    for (const block of page.exercises) {
      if (!block.key || block.sets.length === 0) continue;
      const entry: HistoryEntry = {
        sessionId: session.id,
        date: session.date,
        title: page.title || session.date,
        block,
        lines: block.sets.map((s) => s.text.trim()),
      };
      const list = byExercise.get(block.key);
      if (list) list.push(entry);
      else byExercise.set(block.key, [entry]);
      if (!displayNames.has(block.key)) displayNames.set(block.key, block.name);
    }
  }

  return { byExercise, displayNames };
}

/** The most recent time this exercise was done, ignoring the page being edited. */
export function lastTime(history: History, name: string, excludeSessionId?: string): HistoryEntry | null {
  const entries = history.byExercise.get(normalizeName(name));
  if (!entries) return null;
  for (const entry of entries) {
    if (entry.sessionId !== excludeSessionId) return entry;
  }
  return null;
}

/**
 * The lines to offer as ghost text: last session's sets, minus the ones
 * already typed. Type three of last week's seven and four remain.
 */
export function ghostLines(history: History, name: string, alreadyWritten: number, excludeSessionId?: string): string[] {
  const entry = lastTime(history, name, excludeSessionId);
  if (!entry) return [];
  return entry.lines.slice(alreadyWritten);
}

/** Names close enough to an unknown one to be worth suggesting. */
export function suggestNames(history: History, partial: string, limit = 5): string[] {
  const query = normalizeName(partial);
  if (!query) return [];

  const scored: Array<{ name: string; score: number }> = [];
  for (const [key, display] of history.displayNames) {
    const score = key.startsWith(query) ? 1 + (1 - key.length / 100) : key.includes(query) ? 0.9 : similarity(key, query);
    if (score > 0.55) scored.push({ name: display, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.name);
}

/** The heaviest single set ever recorded for an exercise. */
export function heaviestSet(entries: HistoryEntry[]): { weight: number; reps: number; date: string } | null {
  let best: { weight: number; reps: number; date: string } | null = null;
  for (const entry of entries) {
    for (const set of entry.block.sets) {
      for (const column of set.columns ?? []) {
        if (column.weight === null) continue;
        if (!best || column.weight > best.weight || (column.weight === best.weight && column.reps > best.reps)) {
          best = { weight: column.weight, reps: column.reps, date: entry.date };
        }
      }
    }
  }
  return best;
}

/** Total weight moved on a page, for the one-line summary under each log entry. */
export function pageVolume(page: Page): { sets: number; volume: number } {
  let sets = 0;
  let volume = 0;
  for (const block of page.exercises) {
    for (const set of block.sets) {
      for (const column of set.columns ?? []) {
        sets += 1;
        if (column.weight !== null) volume += column.weight * column.reps;
      }
    }
  }
  return { sets, volume };
}
