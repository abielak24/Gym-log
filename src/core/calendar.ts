/**
 * A month of training, as a calendar.
 *
 * Nothing new is stored: the days are filled in from the pages themselves,
 * so a workout appears on the calendar because it was written, not because
 * anything was scheduled.
 */

import type { Session } from './types';
import { parsePage } from './parse';
import { normalizeName } from './normalize';
import { summarise, type DailyLog, type DaySummary } from './daily';

export interface DaySession {
  id: string;
  title: string;
  /** A few characters that fit in a calendar square: `Back/Bis/Shoulders` -> `B/B/S`. */
  short: string;
  /** The split key, empty when the page has no name. */
  key: string;
  sets: number;
}

export interface CalendarDay {
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
  sessions: DaySession[];
  /** Null when the day was not tracked at all. */
  tracker: DaySummary | null;
}

export interface CalendarMonth {
  key: string;
  label: string;
  /** Six rows of seven days, Sunday first. */
  weeks: CalendarDay[][];
  previous: string;
  next: string;
  /** Days trained within this month. */
  trained: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(key: string, by: number): string {
  const [year, month] = key.split('-').map(Number);
  const shifted = new Date(year, month - 1 + by, 1);
  return monthKey(shifted);
}

export function buildMonth(key: string, sessions: Session[], today = new Date(), daily: DailyLog = {}): CalendarMonth {
  const [year, month] = key.split('-').map(Number);
  const byDate = groupByDate(sessions);

  const todayIso = iso(today);
  const first = new Date(year, month - 1, 1);

  // Back up to the Sunday on or before the 1st.
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  const weeks: CalendarDay[][] = [];
  let trained = 0;

  for (let week = 0; week < 6; week++) {
    const days: CalendarDay[] = [];
    for (let day = 0; day < 7; day++) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);

      const dateIso = iso(date);
      const inMonth = date.getMonth() === month - 1 && date.getFullYear() === year;
      const daySessions = byDate.get(dateIso) ?? [];
      if (inMonth && daySessions.length > 0) trained += 1;

      const rows = daily[dateIso];
      const tracker = rows && rows.length > 0 ? summarise(rows) : null;

      days.push({
        date: dateIso,
        dayOfMonth: date.getDate(),
        inMonth,
        isToday: dateIso === todayIso,
        isFuture: dateIso > todayIso,
        sessions: daySessions,
        tracker: tracker && tracker.tracked > 0 ? tracker : null,
      });
    }
    weeks.push(days);
  }

  return {
    key,
    label: `${MONTHS[month - 1]} ${year}`,
    weeks,
    previous: shiftMonth(key, -1),
    next: shiftMonth(key, 1),
    trained,
  };
}

function groupByDate(sessions: Session[]): Map<string, DaySession[]> {
  const byDate = new Map<string, DaySession[]>();

  for (const session of sessions) {
    const page = parsePage(session.text);
    const sets = page.exercises.reduce((total, block) => total + block.sets.length, 0);

    const entry: DaySession = {
      id: session.id,
      title: page.title.trim(),
      short: shortLabel(page.title.trim()),
      key: normalizeName(page.title),
      sets,
    };

    const list = byDate.get(session.date);
    if (list) list.push(entry);
    else byDate.set(session.date, [entry]);
  }

  return byDate;
}

/**
 * Squeeze a split name into a calendar square.
 *
 * A square is about six characters wide, which `Back/Bis/Shoulders` is not.
 * Initials keep it recognisable where truncation would not — the full name
 * is still read out to a screen reader and shown when the day is tapped.
 */
export function shortLabel(title: string): string {
  const name = title.trim();
  if (!name) return '\u2014';
  if (name.length <= 6) return name;

  const parts = name.split(/[\s/,&+-]+/).filter(Boolean);
  if (parts.length > 1) return parts.map((part) => part[0].toUpperCase()).join('/');

  return `${name.slice(0, 5)}\u2026`;
}

function iso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
