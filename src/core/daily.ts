/**
 * The daily tracker: things counted every day rather than lifted in a split.
 *
 * Each day owns its own goals, so a target can change without rewriting
 * history. A day with nothing written is not a zero — it is a day that was
 * not tracked, and the difference matters when looking back.
 *
 * Values are written the way they are said: `100`, `30min`, `7.5k`. Nothing
 * is converted behind your back; the text you typed is what is stored, and
 * the numbers are only read to work out whether the goal was met.
 */

import { normalizeName } from './normalize';

export interface DailyEntry {
  /** As written: `Pushups`, `Cardio`, `Steps`. */
  name: string;
  key: string;
  /** As written: `100`, `30min`, `10k`. */
  goal: string;
  /** As written, and empty until the day is filled in. */
  value: string;
}

/** Entries by ISO date. A date with no key was not tracked that day. */
export type DailyLog = Record<string, DailyEntry[]>;

export interface Amount {
  amount: number;
  /** `min`, `mi`, `km`, `lb`, `kg`, or empty for a plain count. */
  unit: string;
}

const AMOUNT = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i;

const UNITS: Record<string, { unit: string; factor: number }> = {
  '': { unit: '', factor: 1 },
  k: { unit: '', factor: 1000 },
  // `m` is minutes here, not metres: `30m` of cardio is half an hour.
  m: { unit: 'min', factor: 1 },
  min: { unit: 'min', factor: 1 },
  mins: { unit: 'min', factor: 1 },
  minute: { unit: 'min', factor: 1 },
  minutes: { unit: 'min', factor: 1 },
  h: { unit: 'min', factor: 60 },
  hr: { unit: 'min', factor: 60 },
  hrs: { unit: 'min', factor: 60 },
  hour: { unit: 'min', factor: 60 },
  hours: { unit: 'min', factor: 60 },
  s: { unit: 'min', factor: 1 / 60 },
  sec: { unit: 'min', factor: 1 / 60 },
  secs: { unit: 'min', factor: 1 / 60 },
  mi: { unit: 'mi', factor: 1 },
  mile: { unit: 'mi', factor: 1 },
  miles: { unit: 'mi', factor: 1 },
  km: { unit: 'km', factor: 1 },
  lb: { unit: 'lb', factor: 1 },
  lbs: { unit: 'lb', factor: 1 },
  kg: { unit: 'kg', factor: 1 },
};

export function parseAmount(text: string): Amount | null {
  const match = AMOUNT.exec(text.trim());
  if (!match) return null;

  const suffix = match[2].toLowerCase();
  const known = UNITS[suffix];
  const amount = Number(match[1]);

  // An unrecognised suffix is kept as its own unit rather than guessed at,
  // so `12 laps` still compares against `20 laps`.
  return known ? { amount: amount * known.factor, unit: known.unit } : { amount, unit: suffix };
}

/**
 * Whether two amounts describe the same kind of thing.
 *
 * A bare number takes the other side's unit: a goal of `30min` answered with
 * `25` plainly means twenty-five minutes.
 */
function comparable(a: Amount, b: Amount): boolean {
  return a.unit === b.unit || a.unit === '' || b.unit === '';
}

/** How far through the goal this entry is, or null when it cannot be read. */
export function progress(entry: DailyEntry): number | null {
  const goal = parseAmount(entry.goal);
  const value = parseAmount(entry.value);
  if (!goal || !value || goal.amount <= 0 || !comparable(goal, value)) return null;
  return value.amount / goal.amount;
}

/** True when the goal was met, false when it was not, null when unreadable. */
export function metGoal(entry: DailyEntry): boolean | null {
  const ratio = progress(entry);
  return ratio === null ? null : ratio >= 1;
}

export interface DaySummary {
  tracked: number;
  met: number;
}

export function summarise(entries: DailyEntry[]): DaySummary {
  const filled = entries.filter((entry) => entry.value.trim() !== '');
  return {
    tracked: filled.length,
    met: filled.filter((entry) => metGoal(entry) === true).length,
  };
}

export function entriesFor(log: DailyLog, date: string): DailyEntry[] {
  return log[date] ?? [];
}

/**
 * The rows a new day starts with: a nearby tracked day's names and goals,
 * with the values cleared.
 *
 * The day before is the right answer, since goals carry forward. Filling in
 * a day from before you started tracking has no earlier day to copy, so it
 * falls back to the earliest later one rather than making you retype the
 * names. Each day still owns its goals — this only saves the typing — and
 * nothing is stored until something is actually filled in.
 */
export function seedFor(log: DailyLog, date: string): DailyEntry[] {
  const tracked = Object.keys(log).filter((day) => log[day].length > 0).sort();

  const earlier = tracked.filter((day) => day < date).pop();
  const source = earlier ?? tracked.find((day) => day > date);

  if (!source) return [];
  return log[source].map((entry) => ({ ...entry, value: '' }));
}

export function makeEntry(name: string, goal = '', value = ''): DailyEntry {
  return { name: name.trim(), key: normalizeName(name), goal: goal.trim(), value: value.trim() };
}

/** Drop days whose entries are all empty, so an untouched day stays untracked. */
export function pruneLog(log: DailyLog): DailyLog {
  const kept: DailyLog = {};
  for (const [date, entries] of Object.entries(log)) {
    const real = entries.filter((entry) => entry.name.trim() !== '' && (entry.value.trim() !== '' || entry.goal.trim() !== ''));
    if (real.length > 0) kept[date] = real;
  }
  return kept;
}
