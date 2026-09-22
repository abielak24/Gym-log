import { describe, expect, it } from 'vitest';
import { buildTemplates } from '../src/core/templates';
import { buildGrid, strayExercises } from '../src/core/grid';
import { createSamples } from '../src/core/sample';
import type { Session } from '../src/core/types';

const TODAY = new Date(2026, 8, 22);
const SAMPLES = createSamples(TODAY);

function page(date: string, text: string): Session {
  return { id: date, date, text, updatedAt: 0 };
}

describe('splits read out of the log', () => {
  it('finds one per page title, with no setting up', () => {
    const templates = buildTemplates(SAMPLES);
    expect(templates.map((t) => t.name)).toEqual(['Back/Bis/Shoulders', 'Chest/Tris']);
  });

  it('lists the exercises in the order they were done', () => {
    const chest = buildTemplates(SAMPLES).find((t) => t.name === 'Chest/Tris')!;
    expect(chest.exercises.map((e) => e.name)).toEqual([
      'Dumbbell Incline Press',
      'Chest Fly',
      'Iso Chest Press',
      'Dips',
    ]);
  });

  it('treats differently spelled titles as one split', () => {
    const templates = buildTemplates([
      page('2026-09-01', 'Chest/Tris 9/1\nBench\n135x8'),
      page('2026-09-08', 'chest / tris 9/8\nBench\n145x8'),
    ]);
    expect(templates).toHaveLength(1);
    expect(templates[0].sessionIds).toHaveLength(2);
  });

  it('absorbs an exercise added to the most recent session', () => {
    const templates = buildTemplates([
      page('2026-09-01', 'Chest 9/1\nBench\n135x8'),
      page('2026-09-08', 'Chest 9/8\nBench\n145x8\n\nFace Pulls\n50x15'),
    ]);
    expect(templates[0].exercises.map((e) => e.name)).toEqual(['Bench', 'Face Pulls']);
  });

  it('lets an exercise fall out of the split once it stops being done', () => {
    const sessions = [page('2026-01-01', 'Chest 1/1\nBench\n135x8\n\nFlys\n30x12')];
    for (let i = 1; i <= 5; i++) sessions.push(page(`2026-02-0${i}`, `Chest 2/${i}\nBench\n135x8`));

    const templates = buildTemplates(sessions);
    expect(templates[0].exercises.map((e) => e.name)).toEqual(['Bench']);
  });

  it('ignores a page with no split name', () => {
    expect(buildTemplates([page('2026-09-01', '9/1\nBench\n135x8')])).toEqual([]);
  });

  it('puts the most recently trained split first', () => {
    const templates = buildTemplates(SAMPLES);
    expect(templates[0].lastDate).toBe('2026-09-16');
  });
});

describe('editing a split by hand', () => {
  const sessions = [page('2026-09-08', 'Chest 9/8\nBench\n135x8\n\nFly\n30x12\n\nDips\n10')];

  it('renames it without touching the pages', () => {
    const templates = buildTemplates(sessions, [{ key: 'chest', name: 'Push Day' }]);
    expect(templates[0].name).toBe('Push Day');
    expect(templates[0].sessionIds).toEqual(['2026-09-08']);
  });

  it('removes an exercise from the split, keeping its history', () => {
    const templates = buildTemplates(sessions, [{ key: 'chest', hidden: ['fly'] }]);
    expect(templates[0].exercises.map((e) => e.name)).toEqual(['Bench', 'Dips']);
  });

  it('adds one that has never been logged', () => {
    const templates = buildTemplates(sessions, [
      { key: 'chest', extra: [{ key: 'face pull', name: 'Face Pulls' }] },
    ]);
    expect(templates[0].exercises.map((e) => e.name)).toEqual(['Bench', 'Fly', 'Dips', 'Face Pulls']);
  });

  it('reorders them', () => {
    const templates = buildTemplates(sessions, [{ key: 'chest', order: ['dip', 'bench', 'fly'] }]);
    expect(templates[0].exercises.map((e) => e.name)).toEqual(['Dips', 'Bench', 'Fly']);
  });

  it('keeps a split created before anything is logged under it', () => {
    const templates = buildTemplates([], [
      { key: 'leg', name: 'Legs', created: true, extra: [{ key: 'squat', name: 'Squat' }] },
    ]);
    expect(templates[0].name).toBe('Legs');
    expect(templates[0].exercises.map((e) => e.name)).toEqual(['Squat']);
    expect(templates[0].sessionIds).toEqual([]);
  });
});

describe('the grid', () => {
  const sessions = [
    page('2026-09-01', 'Back 9/1\nPull Ups\n8\n8\n\nCurls\n35x12'),
    page('2026-09-08', 'Back 9/8\nPull Ups\n9\n9\n\nCurls\n40x12'),
    page('2026-09-15', 'Back 9/15\nPull Ups\n10\n10x8\n\nCurls\n40x12'),
  ];
  const template = buildTemplates(sessions)[0];

  it('runs oldest to newest, so today is the rightmost column', () => {
    const grid = buildGrid(template, sessions);
    expect(grid.columns.map((c) => c.date)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15']);
  });

  it('puts each session’s sets in its own cell', () => {
    const grid = buildGrid(template, sessions);
    const pullUps = grid.rows.find((r) => r.name === 'Pull Ups')!;
    expect(pullUps.cells).toEqual([['8', '8'], ['9', '9'], ['10', '10x8']]);
  });

  it('leaves a cell empty where the exercise was skipped', () => {
    const withGap = [...sessions, page('2026-09-22', 'Back 9/22\nPull Ups\n11')];
    const grid = buildGrid(buildTemplates(withGap)[0], withGap);
    const curls = grid.rows.find((r) => r.name === 'Curls')!;
    expect(curls.cells[3]).toEqual([]);
  });

  it('marks the column being written today', () => {
    const grid = buildGrid(template, sessions, { editableSessionId: '2026-09-15' });
    expect(grid.columns.map((c) => c.editable)).toEqual([false, false, true]);
  });

  it('stops widening past its column limit, keeping the newest', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      page(`2026-03-${String(i + 1).padStart(2, '0')}`, `Back 3/${i + 1}\nPull Ups\n${i}`),
    );
    const grid = buildGrid(buildTemplates(many)[0], many, { maxColumns: 4 });
    expect(grid.columns).toHaveLength(4);
    expect(grid.columns[3].date).toBe('2026-03-12');
  });

  it('notices an exercise written today that the split does not list', () => {
    const stray = strayExercises(template, page('2026-09-22', 'Back 9/22\nPull Ups\n11\n\nShrugs\n60x12'));
    expect(stray.map((s) => s.name)).toEqual(['Shrugs']);
  });
});

describe('an exercise added during today’s session', () => {
  const previous = page('2026-09-15', 'Back 9/15\nPull Ups\n10');
  const today = page('2026-09-22', 'Back 9/22\nPull Ups\n11\n\nFace Pulls');
  const template = buildTemplates([previous, today])[0];

  it('gets a row to be typed into, even with no sets yet', () => {
    const grid = buildGrid(template, [previous, today], { editableSessionId: '2026-09-22' });
    expect(grid.rows.map((r) => r.name)).toEqual(['Pull Ups', 'Face Pulls']);
  });

  it('joins the split for next time once it has sets', () => {
    const logged = page('2026-09-22', 'Back 9/22\nPull Ups\n11\n\nFace Pulls\n50x15');
    expect(buildTemplates([previous, logged])[0].exercises.map((e) => e.name)).toEqual(['Pull Ups', 'Face Pulls']);
  });

  it('does not show a stray row on a session that is not being edited', () => {
    const grid = buildGrid(template, [previous, today]);
    expect(grid.rows.map((r) => r.name)).toEqual(['Pull Ups']);
  });
});
