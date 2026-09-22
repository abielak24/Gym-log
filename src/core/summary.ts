/**
 * What this phone tells a crew about itself.
 *
 * Deliberately a summary and not the log: a best set per lift, when it was
 * last done, and how often training happened. No sessions, no notes, no page
 * text. Whatever is not in here cannot leave the device.
 */

import type { Session } from './types';
import type { DailyLog } from './daily';
import { summarise } from './daily';
import { buildHistory, type HistoryEntry } from './history';

export interface BestEffort {
  /** Null for a set written without a weight, which is ranked on reps. */
  weight: number | null;
  reps: number;
  date: string;
}

export interface LiftSummary {
  key: string;
  name: string;
  best: BestEffort | null;
  lastDone: string;
}

export interface MemberSummary {
  name: string;
  daysTrained7: number;
  daysTrained30: number;
  goalsMet7: number;
  goalsTracked7: number;
  lifts: LiftSummary[];
}

/**
 * The heaviest set, or the longest set of a lift that carries no weight.
 *
 * Reps ride along with the weight so `225x5` and `225x1` are visibly
 * different things on a board rather than the same number.
 */
export function bestEffort(entries: HistoryEntry[]): BestEffort | null {
  let weighted: BestEffort | null = null;
  let bodyweight: BestEffort | null = null;

  for (const entry of entries) {
    for (const set of entry.block.sets) {
      for (const column of set.columns ?? []) {
        const candidate: BestEffort = { weight: column.weight, reps: column.reps, date: entry.date };

        if (column.weight === null) {
          if (!bodyweight || candidate.reps > bodyweight.reps) bodyweight = candidate;
          continue;
        }
        if (!weighted
          || column.weight > (weighted.weight ?? 0)
          || (column.weight === weighted.weight && column.reps > weighted.reps)) {
          weighted = candidate;
        }
      }
    }
  }

  return weighted ?? bodyweight;
}

export interface SummaryOptions {
  name: string;
  sessions: Session[];
  daily: DailyLog;
  /** Exercise keys held back from the crew. */
  hidden?: string[];
  today?: Date;
}

export function buildSummary({ name, sessions, daily, hidden = [], today = new Date() }: SummaryOptions): MemberSummary {
  const held = new Set(hidden);
  const history = buildHistory(sessions);

  const lifts: LiftSummary[] = [];
  for (const [key, entries] of history.byExercise) {
    if (held.has(key) || entries.length === 0) continue;
    lifts.push({
      key,
      name: history.displayNames.get(key) ?? key,
      best: bestEffort(entries),
      lastDone: entries[0].date,
    });
  }

  lifts.sort((a, b) => (a.lastDone < b.lastDone ? 1 : a.lastDone > b.lastDone ? -1 : 0));

  const weekAgo = isoDaysAgo(today, 7);
  const monthAgo = isoDaysAgo(today, 30);

  // A page with no sets on it was opened, not trained.
  const trained = new Set(
    sessions
      .filter((session) => history.byExercise.size > 0 && hasSets(session, history))
      .map((session) => session.date),
  );

  let goalsMet7 = 0;
  let goalsTracked7 = 0;
  for (const [date, entries] of Object.entries(daily)) {
    if (date < weekAgo) continue;
    const { met, tracked } = summarise(entries);
    goalsMet7 += met;
    goalsTracked7 += tracked;
  }

  return {
    name: name.trim() || 'Anonymous',
    daysTrained7: [...trained].filter((date) => date >= weekAgo).length,
    daysTrained30: [...trained].filter((date) => date >= monthAgo).length,
    goalsMet7,
    goalsTracked7,
    lifts,
  };
}

function hasSets(session: Session, history: ReturnType<typeof buildHistory>): boolean {
  for (const entries of history.byExercise.values()) {
    if (entries.some((entry) => entry.sessionId === session.id)) return true;
  }
  return false;
}

function isoDaysAgo(today: Date, days: number): string {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  date.setDate(date.getDate() - days + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
