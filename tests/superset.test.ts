import { describe, expect, it } from 'vitest';
import { parsePage } from '../src/core/parse';
import { addExercise, writeCell } from '../src/core/edit';

describe('naming a superset', () => {
  it('reads a heading that names both sides', () => {
    const page = parsePage('Back 9/22\nRows | Cable Rows\n25x10 | 20x10');
    expect(page.exercises.map((e) => e.name)).toEqual(['Rows | Cable Rows']);
    expect(page.flagged).toEqual([]);
  });

  it('gives each side its own name and history', () => {
    const page = parsePage('Back 9/22\nRows | Cable Rows\n25x10 | 20x10');
    expect(page.exercises[0].columnNames).toEqual(['Rows', 'Cable Rows']);
    expect(page.exercises[0].columnKeys[0]).not.toBe(page.exercises[0].columnKeys[1]);
  });

  it('still flags a set line that is broken on one side', () => {
    const page = parsePage('Back 9/22\nRows\n25x10 | 20x');
    expect(page.flagged).toHaveLength(1);
  });
});

describe('adding a superset from the grid', () => {
  const PAGE = 'Back 9/22\nPull Ups\n8';

  it('adds a heading naming both sides', () => {
    const page = parsePage(addExercise(PAGE, 'Rows | Cable Rows'));
    expect(page.exercises.map((e) => e.name)).toEqual(['Pull Ups', 'Rows | Cable Rows']);
    expect(page.flagged).toEqual([]);
  });

  it('writes its sets into the row it belongs to, not a second copy', () => {
    let text = addExercise(PAGE, 'Rows | Cable Rows');
    text = writeCell(text, 'Rows | Cable Rows', ['25x10 | 20x10', '25x10 | 20x10']);
    text = writeCell(text, 'Rows | Cable Rows', ['25x10 | 20x10', '25x10 | 20x10', '25x10 | 20x10']);

    const page = parsePage(text);
    expect(page.exercises).toHaveLength(2);
    expect(page.exercises[1].sets).toHaveLength(3);
  });

  it('does not add the same superset twice', () => {
    const once = addExercise(PAGE, 'Rows | Cable Rows');
    expect(addExercise(once, 'Rows | Cable Rows')).toBe(once);
  });

  it('matches a plain Rows row to the superset that starts with it', () => {
    const text = writeCell('Back 9/22\nRows | Cable Rows\n25x10 | 20x10', 'Rows | Cable Rows', ['30x10 | 25x10']);
    expect(parsePage(text).exercises).toHaveLength(1);
  });
});
