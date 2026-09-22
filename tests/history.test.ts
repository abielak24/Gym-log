import { describe, expect, it } from 'vitest';
import { buildHistory, ghostLines, heaviestSet, lastTime, pageVolume, suggestNames } from '../src/core/history';
import { parsePage } from '../src/core/parse';
import { createSamples } from '../src/core/sample';
import { normalizeName } from '../src/core/normalize';
import type { Session } from '../src/core/types';

const TODAY = new Date(2026, 8, 22);
const SAMPLES = createSamples(TODAY);

describe('names that mean the same lift', () => {
  it('folds abbreviations and plurals together', () => {
    expect(normalizeName('DB Incline Press')).toBe(normalizeName('Dumbbell Incline Press'));
    expect(normalizeName('Curls')).toBe(normalizeName('curl'));
    expect(normalizeName('Lat Pulldown')).toBe(normalizeName('Lat Pull Down'));
    expect(normalizeName('  Dips  ')).toBe(normalizeName('dip'));
  });

  it('keeps genuinely different lifts apart', () => {
    expect(normalizeName('Incline Press')).not.toBe(normalizeName('Chest Press'));
    expect(normalizeName('Pull Ups')).not.toBe(normalizeName('Push Ups'));
  });
});

describe('last time', () => {
  const history = buildHistory(SAMPLES);

  it('finds the most recent session for a lift', () => {
    const entry = lastTime(history, 'Dumbbell Incline Press');
    expect(entry?.date).toBe('2026-09-15');
    expect(entry?.lines).toEqual(['45x8', '45x8', '70x8', '80x8', '90x8', '95x7', '70x8']);
  });

  it('finds it through a different spelling', () => {
    expect(lastTime(history, 'DB incline press')?.lines).toHaveLength(7);
  });

  it('returns nothing for a lift never done', () => {
    expect(lastTime(history, 'Zercher Squat')).toBeNull();
  });

  it('ignores the page currently being written', () => {
    expect(lastTime(history, 'Curls', SAMPLES[1].id)).toBeNull();
  });

  it('prefers the newer of two sessions', () => {
    const extra: Session = {
      id: '2026-09-20', date: '2026-09-20',
      text: 'Chest 9/20\nDumbbell Incline Press\n100x8', updatedAt: 0,
    };
    const entry = lastTime(buildHistory([...SAMPLES, extra]), 'Dumbbell Incline Press');
    expect(entry?.lines).toEqual(['100x8']);
  });
});

describe('ghost text', () => {
  const history = buildHistory(SAMPLES);

  it('offers the whole set of lines before you have typed any', () => {
    expect(ghostLines(history, 'Curls', 0)).toEqual(['40x12', '40x12', '40x12']);
  });

  it('peels away as you write your own', () => {
    expect(ghostLines(history, 'Curls', 1)).toEqual(['40x12', '40x12']);
    expect(ghostLines(history, 'Curls', 3)).toEqual([]);
  });

  it('does not run past the end when you do more sets than last time', () => {
    expect(ghostLines(history, 'Curls', 9)).toEqual([]);
  });

  it('offers superset lines whole', () => {
    expect(ghostLines(history, 'Rows (superset)', 0)).toEqual(['25x10 | 20x10', '25x10 | 20x10', '25x10 | 20x10']);
  });
});

describe('suggestions', () => {
  const history = buildHistory(SAMPLES);

  it('completes from a prefix', () => {
    expect(suggestNames(history, 'lat')).toContain('Lat Pull Down');
  });

  it('survives a typo', () => {
    expect(suggestNames(history, 'Dumbell Incline Pres')).toContain('Dumbbell Incline Press');
  });

  it('stays quiet when nothing is close', () => {
    expect(suggestNames(history, 'qqqq')).toEqual([]);
  });
});

describe('summaries', () => {
  it('finds the heaviest set of an exercise', () => {
    const history = buildHistory(SAMPLES);
    const best = heaviestSet(history.byExercise.get(normalizeName('Dumbbell Incline Press'))!);
    expect(best).toMatchObject({ weight: 95, reps: 7, date: '2026-09-15' });
  });

  it('ignores bodyweight sets when looking for the heaviest', () => {
    const history = buildHistory(SAMPLES);
    const best = heaviestSet(history.byExercise.get(normalizeName('Pull Ups'))!);
    expect(best).toMatchObject({ weight: 10, reps: 8 });
  });

  it('counts sets and volume across a page, both sides of a superset included', () => {
    const page = parsePage(SAMPLES[1].text, TODAY);
    const { sets, volume } = pageVolume(page);
    // 3 pull-ups + 3 pulldowns + 6 superset columns + 3 curls
    expect(sets).toBe(15);
    expect(volume).toBeGreaterThan(0);
  });
});

describe('singular and plural spellings of the same lift', () => {
  it('folds the short ones too', () => {
    expect(normalizeName('Pull Ups')).toBe(normalizeName('Pull Up'));
    expect(normalizeName('Dips')).toBe(normalizeName('Dip'));
    expect(normalizeName('Rows')).toBe(normalizeName('Row'));
  });

  it('still keeps words that merely end in s', () => {
    expect(normalizeName('Press')).toBe('press');
    expect(normalizeName('Leg Press')).not.toBe(normalizeName('Leg Pres'));
  });
});
