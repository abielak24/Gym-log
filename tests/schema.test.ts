import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error - a plain .mjs helper, deliberately not part of the app build
import { flatten } from '../scripts/flatten-schema.mjs';

const schema = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8');
const paste = readFileSync(new URL('../worker/schema-paste.sql', import.meta.url), 'utf8');

/**
 * `schema-paste.sql` is a build artifact that ships in the repo, so it can
 * drift from the schema it was flattened out of. This notices.
 */
describe('the schema you paste into the D1 console', () => {
  it('matches the schema it was generated from', () => {
    expect(paste).toContain(flatten(schema).trim());
  });

  // The whole reason it exists: the console rejects empty fragments.
  it('has nothing in it that would split into an empty statement', () => {
    const body = paste.split('\n').filter((line) => !line.startsWith('--')).join('\n');
    for (const piece of body.split(';')) {
      expect(piece.trim() === '' || piece.trim().length > 10).toBe(true);
    }
  });

  it('puts every statement on a line of its own, so it can be fed one at a time', () => {
    const statements = paste.split('\n').filter((line) => line && !line.startsWith('--'));
    for (const line of statements) {
      expect(line.endsWith(';')).toBe(true);
      expect(line.slice(0, -1)).not.toContain(';');
    }
  });

  it('creates every table the worker reads and writes', () => {
    for (const table of ['accounts', 'sessions', 'attempts', 'settings', 'crews', 'members', 'log']) {
      expect(paste).toContain(`CREATE TABLE IF NOT EXISTS ${table} `);
    }
  });
});
