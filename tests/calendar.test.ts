import { describe, expect, it } from 'vitest';
import { buildMonth, monthKey, shiftMonth, shortLabel } from '../src/core/calendar';
import { notebookPages } from './fixtures';
import type { Session } from '../src/core/types';

const TODAY = new Date(2026, 8, 22); // Tuesday 22 September 2026

function page(date: string, text: string): Session {
  return { id: date, date, text, updatedAt: 0 };
}

describe('moving between months', () => {
  it('names a month from a date', () => {
    expect(monthKey(TODAY)).toBe('2026-09');
  });

  it('steps back over a year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});

describe('a month of training', () => {
  const month = buildMonth('2026-09', notebookPages(TODAY), TODAY);

  it('is six weeks of seven days, starting on a Sunday', () => {
    expect(month.weeks).toHaveLength(6);
    expect(month.weeks.every((w) => w.length === 7)).toBe(true);
    expect(new Date(month.weeks[0][0].date + 'T12:00').getDay()).toBe(0);
  });

  it('is labelled in full', () => {
    expect(month.label).toBe('September 2026');
  });

  it('knows which day is today', () => {
    const today = month.weeks.flat().find((d) => d.isToday);
    expect(today?.date).toBe('2026-09-22');
  });

  it('fills in the days that were trained, from the pages themselves', () => {
    const trained = month.weeks.flat().filter((d) => d.sessions.length > 0);
    expect(trained.map((d) => d.date)).toEqual(['2026-09-15', '2026-09-16']);
    expect(trained[0].sessions[0].title).toBe('Chest/Tris');
    expect(trained[0].sessions[0].sets).toBe(21);
  });

  it('counts the days trained this month', () => {
    expect(month.trained).toBe(2);
  });

  it('marks days that have not happened yet', () => {
    const future = month.weeks.flat().filter((d) => d.isFuture);
    expect(future.every((d) => d.date > '2026-09-22')).toBe(true);
    expect(future.length).toBeGreaterThan(0);
  });

  it('shows the neighbouring months’ days, marked as outside', () => {
    const outside = month.weeks.flat().filter((d) => !d.inMonth);
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.every((d) => !d.date.startsWith('2026-09'))).toBe(true);
  });

  it('does not count a neighbouring month’s workout as this month’s', () => {
    const august = buildMonth('2026-09', [page('2026-08-31', 'Legs 8/31\nSquat\n225x5')], TODAY);
    const day = august.weeks.flat().find((d) => d.date === '2026-08-31')!;
    expect(day.sessions).toHaveLength(1);
    expect(day.inMonth).toBe(false);
    expect(august.trained).toBe(0);
  });

  it('holds two workouts on one day', () => {
    const twice = buildMonth('2026-09', [
      page('2026-09-10', 'Chest 9/10\nBench\n135x8'),
      { ...page('2026-09-10', 'Legs 9/10\nSquat\n225x5'), id: '2026-09-10#2' },
    ], TODAY);
    const day = twice.weeks.flat().find((d) => d.date === '2026-09-10')!;
    expect(day.sessions.map((s) => s.title)).toEqual(['Chest', 'Legs']);
  });

  it('keeps a page with no split name on the calendar', () => {
    const untitled = buildMonth('2026-09', [page('2026-09-09', '9/9\nBench\n135x8')], TODAY);
    const day = untitled.weeks.flat().find((d) => d.date === '2026-09-09')!;
    expect(day.sessions[0].title).toBe('');
    expect(day.sessions[0].sets).toBe(1);
  });

  it('spans a month that needs six weeks to draw', () => {
    const may = buildMonth('2026-05', [], new Date(2026, 4, 15));
    expect(may.weeks).toHaveLength(6);
    expect(may.weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });
});

describe('fitting a split name into a square', () => {
  it('leaves a short name alone', () => {
    expect(shortLabel('Legs')).toBe('Legs');
    expect(shortLabel('Push')).toBe('Push');
  });

  it('turns a multi-part name into initials', () => {
    expect(shortLabel('Back/Bis/Shoulders')).toBe('B/B/S');
    expect(shortLabel('Chest/Tris')).toBe('C/T');
    expect(shortLabel('Upper Body')).toBe('U/B');
  });

  it('truncates a single long word', () => {
    expect(shortLabel('Conditioning')).toBe('Condi…');
  });

  it('marks a page with no split name', () => {
    expect(shortLabel('')).toBe('—');
  });
});
