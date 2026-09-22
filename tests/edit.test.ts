import { describe, expect, it } from 'vitest';
import { addExercise, writeCell } from '../src/core/edit';
import { parsePage } from '../src/core/parse';

const PAGE = `Back/Bis/Shoulders 9/16
Pull Ups
8
10x8
10x8

Lat Pull Down
170x6
170x8

Curls
40x12
40x12`;

describe('writing one cell', () => {
  it('replaces the sets under one exercise and leaves the rest alone', () => {
    const next = writeCell(PAGE, 'Pull Ups', ['10', '12x8', '13x8']);
    const page = parsePage(next);

    expect(page.exercises[0].sets.map((s) => s.text)).toEqual(['10', '12x8', '13x8']);
    expect(page.exercises.map((e) => e.name)).toEqual(['Pull Ups', 'Lat Pull Down', 'Curls']);
    expect(next).toContain('170x6');
    expect(next).toContain('40x12\n40x12');
  });

  it('leaves the header line untouched', () => {
    expect(writeCell(PAGE, 'Curls', ['45x10']).split('\n')[0]).toBe('Back/Bis/Shoulders 9/16');
  });

  it('appends an exercise the page does not have yet', () => {
    const next = writeCell(PAGE, 'Face Pulls', ['50x15', '50x15']);
    const page = parsePage(next);

    expect(page.exercises.map((e) => e.name)).toEqual(['Pull Ups', 'Lat Pull Down', 'Curls', 'Face Pulls']);
    expect(page.exercises[3].sets).toHaveLength(2);
    expect(page.flagged).toEqual([]);
  });

  it('finds the exercise through a different spelling, keeping the written one', () => {
    const next = writeCell(PAGE, 'lat pulldown', ['180x5']);
    const page = parsePage(next);

    expect(page.exercises).toHaveLength(3);
    expect(page.exercises[1].name).toBe('Lat Pull Down');
    expect(page.exercises[1].sets.map((s) => s.text)).toEqual(['180x5']);
  });

  it('removes the exercise when the cell is cleared', () => {
    const page = parsePage(writeCell(PAGE, 'Lat Pull Down', []));
    expect(page.exercises.map((e) => e.name)).toEqual(['Pull Ups', 'Curls']);
    expect(page.flagged).toEqual([]);
  });

  it('does nothing when clearing an exercise that was never there', () => {
    expect(writeCell(PAGE, 'Squat', [])).toBe(PAGE);
  });

  it('writes the cell\u2019s whole body, notes and all', () => {
    const withNote = `Chest 9/22\nBench\n135x8\n// left shoulder tight`;
    const next = writeCell(withNote, 'Bench', ['135x8', '145x6', '// left shoulder tight']);

    expect(next).toContain('// left shoulder tight');
    expect(parsePage(next).exercises[0].sets).toHaveLength(2);
  });

  it('does not duplicate an unreadable line on every save', () => {
    // The cell shows the whole block, so what comes back replaces it whole.
    // Rescuing lines the cell also contains is what duplicated them.
    let text = `Chest 9/22\nBench\n135x8\n135x`;
    for (let i = 0; i < 5; i++) text = writeCell(text, 'Bench', ['135x8', '135x']);

    expect(text.split('\n').filter((line) => line.trim() === '135x')).toHaveLength(1);
    expect(parsePage(text).flagged).toHaveLength(1);
  });

  it('lets an unreadable line be corrected from the cell', () => {
    const withJunk = `Chest 9/22\nBench\n135x8\n135x`;
    const next = writeCell(withJunk, 'Bench', ['135x8', '135x6']);

    expect(next).not.toContain('135x\n');
    expect(parsePage(next).flagged).toEqual([]);
    expect(parsePage(next).exercises[0].sets).toHaveLength(2);
  });

  it('lets a note be deleted from the cell', () => {
    const withNote = `Chest 9/22\nBench\n135x8\n// left shoulder tight`;
    expect(writeCell(withNote, 'Bench', ['135x8'])).not.toContain('shoulder');
  });

  it('writes superset lines whole', () => {
    const next = writeCell(PAGE, 'Rows', ['25x10 | 20x10', '25x10 | 20x10']);
    const rows = parsePage(next).exercises.find((e) => e.name === 'Rows')!;
    expect(rows.sets[0].columns).toHaveLength(2);
  });

  it('throws away blank lines rather than writing them into the page', () => {
    const next = writeCell(PAGE, 'Curls', ['40x12', '', '  ', '45x10', '']);
    expect(parsePage(next).exercises[2].sets.map((s) => s.text)).toEqual(['40x12', '45x10']);
    expect(next).not.toMatch(/\n\n\n/);
  });

  it('never leaves a run of blank lines behind', () => {
    let text = PAGE;
    for (const name of ['Pull Ups', 'Lat Pull Down', 'Curls']) text = writeCell(text, name, []);
    expect(text).not.toMatch(/\n\n\n/);
    expect(text.trim()).toBe('Back/Bis/Shoulders 9/16');
  });

  it('survives being written over and over', () => {
    let text = PAGE;
    for (let i = 0; i < 12; i++) {
      text = writeCell(text, 'Pull Ups', ['8', `${10 + i}x8`]);
      text = writeCell(text, 'Curls', [`${40 + i}x12`]);
    }
    const page = parsePage(text);
    expect(page.exercises.map((e) => e.name)).toEqual(['Pull Ups', 'Lat Pull Down', 'Curls']);
    expect(page.flagged).toEqual([]);
    expect(text).not.toMatch(/\n\n\n/);
  });

  it('writes into an empty page that has only a header', () => {
    const next = writeCell('9/22 Chest/Tris', 'Bench', ['135x8']);
    const page = parsePage(next);
    expect(page.title).toBe('Chest/Tris');
    expect(page.exercises[0].sets).toHaveLength(1);
  });
});

describe('adding an exercise with no sets yet', () => {
  it('grows a row the grid can show', () => {
    const page = parsePage(addExercise(PAGE, 'Face Pulls'));
    expect(page.exercises.map((e) => e.name)).toContain('Face Pulls');
  });

  it('does not add one that is already there under another spelling', () => {
    expect(addExercise(PAGE, 'pull up')).toBe(PAGE);
  });
});
