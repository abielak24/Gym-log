import { describe, expect, it } from 'vitest';
import { createSampleDaily, createSamples } from '../src/core/sample';
import { buildTemplates } from '../src/core/templates';
import { buildGrid } from '../src/core/grid';
import { parsePage } from '../src/core/parse';
import { summarise } from '../src/core/daily';

const TODAY = new Date(2026, 8, 22);
const SAMPLES = createSamples(TODAY);

describe('the sample history', () => {
  it('is five sessions of each split', () => {
    const templates = buildTemplates(SAMPLES);
    expect(templates).toHaveLength(2);
    expect(templates.every((t) => t.sessionIds.length === 5)).toBe(true);
  });

  it('is all in the recent past', () => {
    const dates = SAMPLES.map((s) => s.date);
    expect(Math.max(...dates.map((d) => Date.parse(d)))).toBeLessThan(Date.parse('2026-09-22'));
    expect(Math.min(...dates.map((d) => Date.parse(d)))).toBeGreaterThan(Date.parse('2026-08-31'));
  });

  it('is marked as sample data so it can be cleared', () => {
    expect(SAMPLES.every((s) => s.sample)).toBe(true);
  });

  it('contains nothing the parser cannot read', () => {
    for (const session of SAMPLES) {
      const page = parsePage(session.text, TODAY);
      expect(page.flagged, session.text).toEqual([]);
      expect(page.emptyExercises, session.text).toEqual([]);
    }
  });

  it('shows the incline press going up over the five sessions', () => {
    const chest = buildTemplates(SAMPLES).find((t) => t.name === 'Chest/Tris')!;
    const grid = buildGrid(chest, SAMPLES);
    const press = grid.rows.find((r) => r.name === 'Dumbbell Incline Press')!;

    const heaviest = press.cells.map((cell) =>
      Math.max(...cell.lines.map((line) => Number(line.split('x')[0]))),
    );
    expect(heaviest).toEqual([85, 90, 95, 95, 100]);
  });

  it('leaves one session unfinished, so a blank cell can be seen', () => {
    const back = buildTemplates(SAMPLES).find((t) => t.name === 'Back/Bis/Shoulders')!;
    const grid = buildGrid(back, SAMPLES);
    const curls = grid.rows.find((r) => r.name === 'Curls')!;
    expect(curls.cells.filter((cell) => cell.lines.length === 0)).toHaveLength(1);
  });

  it('includes a superset that names both sides', () => {
    const back = buildTemplates(SAMPLES).find((t) => t.name === 'Back/Bis/Shoulders')!;
    const rows = back.exercises.find((e) => e.name.startsWith('Rows'))!;
    expect(rows.name).toBe('Rows | Cable Rows');
  });
});

describe('the sample daily tracker', () => {
  const daily = createSampleDaily(TODAY);

  it('covers the last fortnight', () => {
    expect(Object.keys(daily)).toHaveLength(12);
    expect(Object.keys(daily).sort().pop()).toBe('2026-09-21');
  });

  it('has days met and days missed, so the dots differ', () => {
    const met = Object.values(daily).map((entries) => summarise(entries).met);
    expect(new Set(met).size).toBeGreaterThan(1);
    expect(Math.max(...met)).toBe(3);
    expect(Math.min(...met)).toBeLessThan(3);
  });

  it('leaves a row blank on one day, which is not a zero', () => {
    const blanks = Object.values(daily).flat().filter((entry) => entry.value === '');
    expect(blanks).toHaveLength(1);
  });
});
