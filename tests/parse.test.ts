import { describe, expect, it } from 'vitest';
import { parseDate, parsePage, parseSetLine } from '../src/core/parse';
import { createSamples } from '../src/core/sample';

const TODAY = new Date(2026, 8, 22); // 22 September 2026

describe('set lines', () => {
  it('reads weight x reps', () => {
    expect(parseSetLine('95x7')).toEqual({ ok: true, columns: [{ weight: 95, reps: 7, note: undefined }] });
  });

  it('accepts the ways a hand actually writes it', () => {
    for (const line of ['45 x 8', '45X8', '45x8', '45 lbs x 8', '45×8']) {
      const result = parseSetLine(line);
      expect(result.ok, line).toBe(true);
      if (result.ok) expect(result.columns[0]).toMatchObject({ weight: 45, reps: 8 });
    }
  });

  it('keeps decimal weights', () => {
    const result = parseSetLine('47.5x12');
    expect(result.ok && result.columns[0]).toMatchObject({ weight: 47.5, reps: 12 });
  });

  it('reads a bare number as reps at bodyweight', () => {
    const result = parseSetLine('10');
    expect(result.ok && result.columns[0]).toMatchObject({ weight: null, reps: 10 });
  });

  it('keeps a trailing parenthetical', () => {
    const result = parseSetLine('95x7 (felt heavy)');
    expect(result.ok && result.columns[0]).toMatchObject({ weight: 95, reps: 7, note: 'felt heavy' });
  });

  it('splits a superset on the pipe', () => {
    const result = parseSetLine('25x10 | 20x10');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.columns).toHaveLength(2);
      expect(result.columns[1]).toMatchObject({ weight: 20, reps: 10 });
    }
  });

  it('refuses to guess at a half-written set', () => {
    for (const line of ['95x', 'x8', '45xx8', '95 x 8 heavy']) {
      expect(parseSetLine(line).ok, line).toBe(false);
    }
  });

  it('flags a big bare number as a weight missing its reps', () => {
    const result = parseSetLine('230');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/did you mean 230x/);
  });

  it('does not mistake an exercise name for a broken set', () => {
    const result = parseSetLine('Dumbbell Incline Press');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeNull();
  });
});

describe('dates in a header', () => {
  it('reads a bare month/day as this year', () => {
    expect(parseDate('9/22', TODAY)).toBe('2026-09-22');
  });

  it('reads a page written in December from January as last year', () => {
    expect(parseDate('12/28', new Date(2027, 0, 3))).toBe('2026-12-28');
  });

  it('reads explicit years and ISO dates', () => {
    expect(parseDate('9/22/25', TODAY)).toBe('2025-09-22');
    expect(parseDate('2024-01-05', TODAY)).toBe('2024-01-05');
  });

  it('rejects something that is not a date', () => {
    expect(parseDate('13/45', TODAY)).toBeNull();
  });
});

describe('the chest page from the notebook', () => {
  const [chest] = createSamples(TODAY);
  const page = parsePage(chest.text, TODAY);

  it('reads the header as a name and a date', () => {
    expect(page.title).toBe('Chest/Tris');
    expect(page.date).toBe('2026-09-15');
  });

  it('finds every exercise in order', () => {
    expect(page.exercises.map((e) => e.name)).toEqual([
      'Dumbbell Incline Press',
      'Chest Fly',
      'Iso Chest Press',
      'Dips',
    ]);
  });

  it('reads the full ramp of the first exercise', () => {
    const sets = page.exercises[0].sets.flatMap((s) => s.columns!);
    expect(sets.map((s) => `${s.weight}x${s.reps}`)).toEqual([
      '45x8', '45x8', '70x8', '80x8', '90x8', '95x7', '70x8',
    ]);
  });

  it('reads bodyweight dips and the weight added afterwards', () => {
    const dips = page.exercises[3].sets.flatMap((s) => s.columns!);
    expect(dips[0]).toMatchObject({ weight: null, reps: 10 });
    expect(dips[4]).toMatchObject({ weight: 50, reps: 10 });
  });

  it('flags nothing on a clean page', () => {
    expect(page.flagged).toEqual([]);
  });
});

describe('the back page from the notebook', () => {
  const [, back] = createSamples(TODAY);
  const page = parsePage(back.text, TODAY);

  it('keeps a slashed title intact', () => {
    expect(page.title).toBe('Back/Bis/Shoulders');
    expect(page.date).toBe('2026-09-16');
  });

  it('gives each side of the superset its own name and history', () => {
    const rows = page.exercises.find((e) => e.name.startsWith('Rows'))!;
    expect(rows.sets).toHaveLength(3);
    expect(rows.sets[0].columns).toHaveLength(2);
    expect(rows.columnNames).toEqual(['Rows (superset) (A)', 'Rows (superset) (B)']);
    expect(rows.columnKeys[0]).not.toBe(rows.columnKeys[1]);
  });

  it('drops "superset" from the exercise identity', () => {
    const rows = page.exercises.find((e) => e.name.startsWith('Rows'))!;
    expect(rows.key).toBe('row');
  });
});

describe('lines it cannot read', () => {
  it('flags a broken set in the middle of a block, with a reason', () => {
    const page = parsePage('Chest 9/22\nBench\n135x8\n135x\n135x8', TODAY);
    const flagged = page.flagged;
    expect(flagged).toHaveLength(1);
    expect(flagged[0].text).toBe('135x');
    expect(flagged[0].reason).toBe('not readable as weight x reps');
    expect(page.exercises[0].sets).toHaveLength(2);
  });

  it('treats a name with a number after a blank line as an exercise', () => {
    const page = parsePage('Back 9/22\nRow\n100x8\n\nCable Row 2\n50x10', TODAY);
    expect(page.exercises.map((e) => e.name)).toEqual(['Row', 'Cable Row 2']);
    expect(page.flagged).toEqual([]);
  });

  it('starts a new exercise without a blank line when the name has no digits', () => {
    const page = parsePage('Chest 9/22\nBench\n135x8\nChest Fly\n40x12', TODAY);
    expect(page.exercises.map((e) => e.name)).toEqual(['Bench', 'Chest Fly']);
  });

  it('keeps a note out of the way', () => {
    const page = parsePage('Chest 9/22\nBench\n135x8\n// shoulder felt tight', TODAY);
    expect(page.flagged).toEqual([]);
    expect(page.exercises[0].notes).toHaveLength(1);
  });

  it('flags a set written before any exercise', () => {
    const page = parsePage('Chest 9/22\n135x8', TODAY);
    expect(page.flagged[0].reason).toBe('a set with no exercise above it');
  });

  it('classifies every line exactly once', () => {
    const text = 'Chest 9/22\nBench\n135x8\n\n// note\n135 x bad';
    const page = parsePage(text, TODAY);
    expect(page.lines).toHaveLength(text.split('\n').length);
    expect(page.lines.map((l) => l.kind)).toEqual(['header', 'exercise', 'set', 'blank', 'note', 'flagged']);
  });
});

describe('prose mistaken for an exercise', () => {
  it('notices a heading that never got any sets', () => {
    const page = parsePage('Chest 9/22\nBench\n135x8\nfelt weak today\n135x6\n\nFly\n40x12', TODAY);
    expect(page.exercises.map((e) => e.name)).toEqual(['Bench', 'felt weak today', 'Fly']);
    expect(page.emptyExercises).toEqual([]);
  });

  it('flags one that swallowed no sets at all', () => {
    const page = parsePage('Chest 9/22\nBench\n135x8\nfelt weak today\n\nFly\n40x12', TODAY);
    expect(page.emptyExercises.map((e) => e.name)).toEqual(['felt weak today']);
  });

  it('leaves the exercise you are part-way through alone', () => {
    const page = parsePage('Chest 9/22\nBench\n135x8\n\nChest Fly', TODAY);
    expect(page.emptyExercises).toEqual([]);
  });
});

describe('a header written either way round', () => {
  it('reads the notebook order, name then date', () => {
    const page = parsePage('Chest/Tris 9/22\nBench\n135x8', TODAY);
    expect(page.title).toBe('Chest/Tris');
    expect(page.date).toBe('2026-09-22');
  });

  it('reads the app order, date then name', () => {
    const page = parsePage('9/22 Chest/Tris\nBench\n135x8', TODAY);
    expect(page.title).toBe('Chest/Tris');
    expect(page.date).toBe('2026-09-22');
  });

  it('reads a date on its own, before the day has a name', () => {
    const page = parsePage('9/22 \nBench\n135x8', TODAY);
    expect(page.title).toBe('');
    expect(page.date).toBe('2026-09-22');
  });

  it('leaves a header with no date alone', () => {
    const page = parsePage('Chest day\nBench\n135x8', TODAY);
    expect(page.title).toBe('Chest day');
    expect(page.date).toBeNull();
  });
});
