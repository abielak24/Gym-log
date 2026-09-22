import { describe, expect, it } from 'vitest';
import { makeEntry, metGoal, parseAmount, progress, pruneLog, seedFor, summarise, type DailyLog } from '../src/core/daily';

describe('reading an amount the way it is written', () => {
  it('reads a plain count', () => {
    expect(parseAmount('100')).toEqual({ amount: 100, unit: '' });
  });

  it('reads thousands', () => {
    expect(parseAmount('10k')).toEqual({ amount: 10000, unit: '' });
    expect(parseAmount('7.5k')).toEqual({ amount: 7500, unit: '' });
  });

  it('reads minutes however they are spelled', () => {
    for (const text of ['30min', '30 min', '30m', '30mins', '30 minutes']) {
      expect(parseAmount(text), text).toEqual({ amount: 30, unit: 'min' });
    }
  });

  it('reads hours as minutes', () => {
    expect(parseAmount('1h')).toEqual({ amount: 60, unit: 'min' });
    expect(parseAmount('1.5hr')).toEqual({ amount: 90, unit: 'min' });
  });

  it('reads distances', () => {
    expect(parseAmount('5mi')).toEqual({ amount: 5, unit: 'mi' });
    expect(parseAmount('5km')).toEqual({ amount: 5, unit: 'km' });
  });

  it('keeps an unfamiliar unit rather than guessing', () => {
    expect(parseAmount('12laps')).toEqual({ amount: 12, unit: 'laps' });
  });

  it('refuses what is not an amount', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('lots')).toBeNull();
    expect(parseAmount('10 x 8')).toBeNull();
  });
});

describe('whether a goal was met', () => {
  it('counts an exact hit', () => {
    expect(metGoal(makeEntry('Pushups', '100', '100'))).toBe(true);
  });

  it('counts a miss', () => {
    expect(metGoal(makeEntry('Steps', '10k', '7.5k'))).toBe(false);
    expect(progress(makeEntry('Steps', '10k', '7.5k'))).toBeCloseTo(0.75);
  });

  it('counts going over', () => {
    expect(metGoal(makeEntry('Steps', '10k', '12k'))).toBe(true);
  });

  it('compares across spellings of the same unit', () => {
    expect(metGoal(makeEntry('Cardio', '30min', '0.5h'))).toBe(true);
  });

  it('takes a bare number as the goal’s unit', () => {
    expect(metGoal(makeEntry('Cardio', '30min', '25'))).toBe(false);
    expect(metGoal(makeEntry('Cardio', '30min', '45'))).toBe(true);
  });

  it('will not compare different kinds of thing', () => {
    expect(metGoal(makeEntry('Cardio', '30min', '5mi'))).toBeNull();
  });

  it('says nothing about a day not filled in', () => {
    expect(metGoal(makeEntry('Pushups', '100', ''))).toBeNull();
  });
});

describe('a day’s summary', () => {
  const entries = [
    makeEntry('Pushups', '100', '100'),
    makeEntry('Cardio', '30min', '30min'),
    makeEntry('Steps', '10k', '7.5k'),
  ];

  it('counts what was tracked and what was met', () => {
    expect(summarise(entries)).toEqual({ tracked: 3, met: 2 });
  });

  it('does not count a row left blank', () => {
    expect(summarise([...entries, makeEntry('Water', '3l', '')])).toEqual({ tracked: 3, met: 2 });
  });

  it('is empty for a day with nothing on it', () => {
    expect(summarise([])).toEqual({ tracked: 0, met: 0 });
  });
});

describe('starting a new day', () => {
  const log: DailyLog = {
    '2026-09-20': [makeEntry('Pushups', '100', '100'), makeEntry('Steps', '10k', '9k')],
    '2026-09-21': [makeEntry('Pushups', '120', '120'), makeEntry('Steps', '10k', '11k')],
  };

  it('takes the last tracked day’s goals, with the values cleared', () => {
    expect(seedFor(log, '2026-09-22')).toEqual([
      makeEntry('Pushups', '120', ''),
      makeEntry('Steps', '10k', ''),
    ]);
  });

  it('prefers the day before, so an old day does not borrow from a later one', () => {
    expect(seedFor(log, '2026-09-21')).toEqual([
      makeEntry('Pushups', '100', ''),
      makeEntry('Steps', '10k', ''),
    ]);
  });

  it('starts empty when nothing has ever been tracked', () => {
    expect(seedFor({}, '2026-09-22')).toEqual([]);
  });
});

describe('keeping untracked days untracked', () => {
  it('drops a day whose rows were never filled in', () => {
    const log: DailyLog = {
      '2026-09-21': [makeEntry('Pushups', '100', '100')],
      '2026-09-22': [makeEntry('Pushups', '', '')],
    };
    expect(Object.keys(pruneLog(log))).toEqual(['2026-09-21']);
  });

  it('keeps a day where only a goal was set', () => {
    expect(Object.keys(pruneLog({ '2026-09-22': [makeEntry('Pushups', '100', '')] }))).toEqual(['2026-09-22']);
  });
});

describe('filling in a day from before tracking started', () => {
  const log: DailyLog = {
    '2026-09-22': [makeEntry('Pushups', '100', '100')],
  };

  it('borrows the names from the nearest later day rather than nothing', () => {
    expect(seedFor(log, '2026-09-15')).toEqual([makeEntry('Pushups', '100', '')]);
  });

  it('but still prefers an earlier day when there is one', () => {
    const both = { ...log, '2026-09-10': [makeEntry('Steps', '8k', '8k')] };
    expect(seedFor(both, '2026-09-15')).toEqual([makeEntry('Steps', '8k', '')]);
  });
});
