import { describe, expect, it } from 'vitest';
import { exportJson, exportText, importJson, importText, mergeSessions, newSessionId } from '../src/core/serialize';
import { notebookPages } from './fixtures';
import type { Session } from '../src/core/types';
import { makeEntry } from '../src/core/daily';

const TODAY = new Date(2026, 8, 22);
const SAMPLES = notebookPages(TODAY);

describe('the text file you keep in iCloud', () => {
  it('is the notebook, unchanged', () => {
    const text = exportText(SAMPLES);
    expect(text).toContain('Chest/Tris 9/15');
    expect(text).toContain('95x7');
    expect(text).toContain('25x10 | 20x10');
    expect(text).not.toContain('{');
  });

  it('puts the oldest page first, the way a notebook reads', () => {
    const text = exportText(SAMPLES);
    expect(text.indexOf('Chest/Tris')).toBeLessThan(text.indexOf('Back/Bis/Shoulders'));
  });

  it('comes back in as the same pages', () => {
    const { sessions: restored } = importText(exportText(SAMPLES), TODAY);
    expect(restored).toHaveLength(2);
    expect(restored.map((s) => s.date)).toEqual(['2026-09-15', '2026-09-16']);
    expect(restored[0].text).toBe(SAMPLES[0].text);
    expect(restored[1].text).toBe(SAMPLES[1].text);
  });

  it('survives a second round trip unchanged', () => {
    const { sessions: once } = importText(exportText(SAMPLES), TODAY);
    const { sessions: twice } = importText(exportText(once), TODAY);
    expect(twice.map((s) => s.text)).toEqual(once.map((s) => s.text));
  });

  it('accepts a file split with --- as well', () => {
    const { sessions: pages } = importText('Chest 9/15\nBench\n135x8\n---\nBack 9/16\nRow\n100x8', TODAY);
    expect(pages).toHaveLength(2);
    expect(pages[1].date).toBe('2026-09-16');
  });

  it('keeps a page whose header lost its date, dating it today', () => {
    const { sessions: pages } = importText('Bench\n135x8', TODAY);
    expect(pages).toHaveLength(1);
    expect(pages[0].date).toBe('2026-09-22');
  });

  it('ignores blank space between pages', () => {
    const { sessions: pages } = importText('\n\nChest 9/15\nBench\n135x8\n\n\n\nBack 9/16\nRow\n100x8\n\n', TODAY);
    expect(pages).toHaveLength(2);
  });
});

describe('the json backup', () => {
  it('round trips exactly, samples marked as samples', () => {
    const { sessions: restored } = importJson(exportJson(SAMPLES));
    expect(restored).toEqual(SAMPLES);
  });

  it('refuses a file that is not a backup', () => {
    expect(() => importJson('{"hello":"world"}')).toThrow(/not a gym-notebook backup/);
    expect(() => importJson('[]')).toThrow();
  });
});

describe('merging a restore into what is already here', () => {
  const existing: Session[] = [
    { id: '2026-09-15', date: '2026-09-15', text: 'Chest 9/15\nBench\n135x8', updatedAt: 1 },
  ];

  it('adds pages it has never seen', () => {
    const incoming: Session[] = [{ id: '2026-09-16', date: '2026-09-16', text: 'Back 9/16\nRow\n100x8', updatedAt: 2 }];
    const result = mergeSessions(existing, incoming);
    expect(result.added).toBe(1);
    expect(result.replaced).toBe(0);
    expect(result.sessions).toHaveLength(2);
  });

  it('replaces a page of the same date with the restored one', () => {
    const incoming: Session[] = [{ id: '2026-09-15', date: '2026-09-15', text: 'Chest 9/15\nBench\n135x8\n135x8', updatedAt: 3 }];
    const result = mergeSessions(existing, incoming);
    expect(result.replaced).toBe(1);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].text).toContain('135x8\n135x8');
  });

  it('does nothing when the page is identical', () => {
    const result = mergeSessions(existing, [{ ...existing[0], updatedAt: 99 }]);
    expect(result).toMatchObject({ added: 0, replaced: 0 });
  });

  it('newest page first, for the log screen', () => {
    const incoming: Session[] = [{ id: '2026-09-20', date: '2026-09-20', text: 'Legs 9/20\nSquat\n225x5', updatedAt: 2 }];
    expect(mergeSessions(existing, incoming).sessions.map((s) => s.date)).toEqual(['2026-09-20', '2026-09-15']);
  });
});

describe('two pages on one day', () => {
  it('gives the second one its own id', () => {
    const existing: Session[] = [{ id: '2026-09-22', date: '2026-09-22', text: 'AM 9/22', updatedAt: 1 }];
    expect(newSessionId('2026-09-22', existing)).toBe('2026-09-22#2');
  });
});

describe('the daily tracker in a backup', () => {
  const DAILY = {
    '2026-09-15': [makeEntry('Pushups', '100', '100'), makeEntry('Steps', '10k', '7.5k')],
    '2026-09-18': [makeEntry('Cardio', '30min', '30min')],
  };

  it('rides along in the text file, marked as not being sets', () => {
    const text = exportText(SAMPLES, DAILY);
    expect(text).toContain('@ Pushups 100/100');
    expect(text).toContain('@ Steps 7.5k/10k');
  });

  it('sits under the day it belongs to', () => {
    const text = exportText(SAMPLES, DAILY);
    const chest = text.indexOf('Chest/Tris 9/15');
    const pushups = text.indexOf('@ Pushups');
    const back = text.indexOf('Back/Bis/Shoulders');
    expect(chest).toBeLessThan(pushups);
    expect(pushups).toBeLessThan(back);
  });

  it('gives a tracked day with no workout a header of its own', () => {
    const text = exportText([], { '2026-09-18': DAILY['2026-09-18'] });
    expect(text).toContain('9/18');
    expect(text).toContain('@ Cardio 30min/30min');
  });

  it('comes back as the tracker, not as exercises', () => {
    const { sessions, daily } = importText(exportText(SAMPLES, DAILY), TODAY);
    expect(daily['2026-09-15'].map((e) => e.name)).toEqual(['Pushups', 'Steps']);
    expect(daily['2026-09-15'][1]).toMatchObject({ goal: '10k', value: '7.5k' });
    expect(sessions).toHaveLength(2);
    expect(sessions[0].text).toBe(SAMPLES[0].text);
  });

  it('does not leave a phantom workout on a tracked rest day', () => {
    const { sessions, daily } = importText(exportText([], DAILY), TODAY);
    expect(sessions).toEqual([]);
    expect(Object.keys(daily).sort()).toEqual(['2026-09-15', '2026-09-18']);
  });

  it('survives a second round trip unchanged', () => {
    const once = importText(exportText(SAMPLES, DAILY), TODAY);
    const twice = importText(exportText(once.sessions, once.daily), TODAY);
    expect(twice.daily).toEqual(once.daily);
    expect(twice.sessions.map((s) => s.text)).toEqual(once.sessions.map((s) => s.text));
  });

  it('keeps a row whose value was never filled in', () => {
    const partial = { '2026-09-15': [makeEntry('Pushups', '100', '')] };
    const { daily } = importText(exportText([], partial), TODAY);
    expect(daily['2026-09-15'][0]).toMatchObject({ goal: '100', value: '' });
  });

  it('round trips exactly through json', () => {
    const { sessions, daily } = importJson(exportJson(SAMPLES, DAILY));
    expect(sessions).toEqual(SAMPLES);
    expect(daily).toEqual(DAILY);
  });

  it('reads a version 1 backup that predates the tracker', () => {
    const old = JSON.stringify({ format: 'gym-notebook', version: 1, sessions: SAMPLES });
    const { sessions, daily } = importJson(old);
    expect(sessions).toEqual(SAMPLES);
    expect(daily).toEqual({});
  });
});
