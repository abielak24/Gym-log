/**
 * Rewrite schema.sql as something the D1 dashboard console will take.
 *
 * The console splits a paste on semicolons and refuses the empty fragments
 * that comments and blank lines leave behind — "Requests without any query
 * are not supported". This strips both and puts each statement on one line,
 * so the file can go in as a block or be fed a line at a time.
 *
 * Run after changing schema.sql; tests/schema.test.ts checks it has not drifted.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const HEADER = [
  '-- Generated from schema.sql by scripts/flatten-schema.mjs. Do not edit.',
  '-- One statement per line, no blank lines, no comments in between: the D1',
  '-- console splits a paste on semicolons and rejects the empty fragments a',
  '-- commented, spaced-out file leaves behind. Each line also stands alone, so',
  '-- a console that takes only one statement at a time can be fed line by line.',
].join('\n');

export function flatten(sql) {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => statement.split(/\s+/).join(' '))
    .join(';\n') + ';\n';
}

const here = new URL('../worker/schema.sql', import.meta.url);
const out = new URL('../worker/schema-paste.sql', import.meta.url);
writeFileSync(out, `${HEADER}\n${flatten(readFileSync(here, 'utf8'))}`);
console.log('wrote worker/schema-paste.sql');
