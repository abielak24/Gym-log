import { describe, expect, it } from 'vitest';
import { bestEffort, buildSummary } from '../src/core/summary';
import { buildHistory } from '../src/core/history';
import { makeEntry } from '../src/core/daily';
import { notebookPages } from './fixtures';
import type { Session } from '../src/core/types';

const TODAY = new Date(2026, 8, 22);
const PAGES = notebookPages(TODAY);

function page(date: string, text: string): Session {
  return { id: date, date, text, updatedAt: 0 };
}

describe('the best a lift has been', () => {
  it('is the heaviest set, with its reps', () => {
    const history = buildHistory(PAGES);
    expect(bestEffort(history.byExercise.get('dumbbell incline press')!))
      .toMatchObject({ weight: 95, reps: 7 });
  });

  it('prefers more reps when the weight ties', () => {
    const sessions = [page('2026-09-20', 'Chest 9/20\nBench\n225x3\n225x5\n200x8')];
    expect(bestEffort(buildHistory(sessions).byExercise.get('bench')!))
      .toMatchObject({ weight: 225, reps: 5 });
  });

  it('ranks a lift with no weight on reps instead', () => {
    const sessions = [page('2026-09-20', 'Back 9/20\nPull Ups\n8\n12\n10')];
    expect(bestEffort(buildHistory(sessions).byExercise.get('pull up')!))
      .toMatchObject({ weight: null, reps: 12 });
  });

  it('prefers a weighted set over a bodyweight one', () => {
    const sessions = [page('2026-09-20', 'Back 9/20\nPull Ups\n20\n10x8')];
    expect(bestEffort(buildHistory(sessions).byExercise.get('pull up')!))
      .toMatchObject({ weight: 10, reps: 8 });
  });

  it('says nothing about a lift with no sets', () => {
    expect(bestEffort([])).toBeNull();
  });
});

describe('what gets sent to a crew', () => {
  const daily = {
    '2026-09-21': [makeEntry('Pushups', '100', '100'), makeEntry('Steps', '10k', '7k')],
    '2026-09-20': [makeEntry('Pushups', '100', '100')],
    '2026-08-01': [makeEntry('Pushups', '100', '100')],
  };

  const summary = buildSummary({ name: 'Alex', sessions: PAGES, daily, today: TODAY });

  it('carries a name and nothing that identifies a person', () => {
    expect(summary.name).toBe('Alex');
    expect(JSON.stringify(summary)).not.toContain('45x8');
  });

  it('counts the days actually trained', () => {
    // The window is the last seven days including today, so the page from
    // exactly seven days back sits just outside it.
    expect(summary.daysTrained7).toBe(1);
    expect(summary.daysTrained30).toBe(2);
  });

  it('takes in today and six days back, and no further', () => {
    const recent = [
      page('2026-09-22', 'Chest 9/22\nBench\n225x5'), // today
      page('2026-09-16', 'Chest 9/16\nBench\n225x5'), // six days back: in
      page('2026-09-15', 'Chest 9/15\nBench\n225x5'), // seven days back: out
    ];
    const counted = buildSummary({ name: 'Alex', sessions: recent, daily: {}, today: TODAY });
    expect(counted.daysTrained7).toBe(2);
    expect(counted.daysTrained30).toBe(3);
  });

  it('does not count a page that was opened and never written on', () => {
    const empty = [page('2026-09-22', '9/22 Chest/Tris')];
    expect(buildSummary({ name: 'Alex', sessions: empty, daily: {}, today: TODAY }).daysTrained7).toBe(0);
  });

  it('counts this week’s daily goals, and leaves older weeks out', () => {
    expect(summary.goalsTracked7).toBe(3);
    expect(summary.goalsMet7).toBe(2);
  });

  it('lists every lift with its best set and when it was last done', () => {
    const press = summary.lifts.find((l) => l.name === 'Dumbbell Incline Press')!;
    expect(press.best).toMatchObject({ weight: 95, reps: 7 });
    expect(press.lastDone).toBe('2026-09-15');
  });

  it('puts the most recently trained lifts first', () => {
    expect(summary.lifts[0].lastDone >= summary.lifts[summary.lifts.length - 1].lastDone).toBe(true);
  });

  it('holds back a lift marked as private', () => {
    const held = buildSummary({ name: 'Alex', sessions: PAGES, daily, hidden: ['curl'], today: TODAY });
    expect(held.lifts.some((l) => l.key === 'curl')).toBe(false);
    expect(held.lifts.length).toBe(summary.lifts.length - 1);
  });

  it('never carries page text, notes or session detail', () => {
    const noted = [page('2026-09-21', 'Chest 9/21\nBench\n225x5\n// shoulder felt tight')];
    const json = JSON.stringify(buildSummary({ name: 'Alex', sessions: noted, daily: {}, today: TODAY }));
    expect(json).not.toContain('shoulder');
    expect(json).not.toContain('//');
  });

  it('falls back to a name rather than sending an empty one', () => {
    expect(buildSummary({ name: '   ', sessions: [], daily: {}, today: TODAY }).name).toBe('Anonymous');
  });

  it('is small enough to post from a phone', () => {
    expect(JSON.stringify(summary).length).toBeLessThan(4000);
  });
});
