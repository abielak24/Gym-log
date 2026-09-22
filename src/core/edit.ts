/**
 * Writing one cell of the grid back into a page.
 *
 * The page text stays the source of truth, so editing a cell means editing
 * the lines under one exercise heading and leaving every other character of
 * the page alone — including the lines the parser could not read, which are
 * somebody's notes and are not ours to tidy away.
 */

import { parsePage, parseSetLine } from './parse';
import { headingKey } from './normalize';

/**
 * Keep a cell's lines attached to the exercise they were typed under.
 *
 * On a page, a line with no numbers in it is an exercise heading — which is
 * right when reading a page top to bottom, and wrong inside a grid cell,
 * where the exercise is already known and `shoulder felt tight` would
 * silently become an exercise of its own and steal the sets below it. Such a
 * line is kept as a note on that exercise instead.
 *
 * This is not the parser guessing at meaning: the cell says which exercise
 * the line belongs to. A half-written set like `95x` is left exactly as
 * typed, because there the intent really is a set and the flag is the point.
 */
export function asCellLines(lines: string[]): string[] {
  return lines.map((raw) => {
    const line = raw.trim();
    if (!line || /^(?:\/\/|#)/.test(line)) return line;

    const result = parseSetLine(line);
    if (result.ok) return line;
    return result.reason === null ? `// ${line}` : line;
  });
}

/**
 * Replace everything under `name` with `lines`.
 *
 * The grid cell shows an exercise's whole body — sets, notes and unreadable
 * lines — so this replaces the whole body. Keeping some lines back would
 * re-add them alongside whatever the cell now says, which duplicated them on
 * every save.
 *
 * An exercise the page does not have yet is appended with its heading. Empty
 * `lines` removes the block entirely, so clearing a cell clears the exercise
 * rather than leaving a heading with nothing under it.
 */
export function writeCell(text: string, name: string, lines: string[]): string {
  const page = parsePage(text);
  const key = headingKey(name);
  const all = text.split('\n');
  // A cell holds set lines and notes; blank lines in it are noise.
  const clean = asCellLines(lines).filter(Boolean);

  const index = page.exercises.findIndex((block) => block.key === key);

  if (index === -1) {
    if (clean.length === 0) return text;
    const body = [name.trim(), ...clean];
    const existing = trimTrailingBlanks(all);
    return [...existing, ...(existing.length ? [''] : []), ...body].join('\n');
  }

  const block = page.exercises[index];
  const next = page.exercises[index + 1];
  const end = next ? next.headingLine : all.length;

  const before = all.slice(0, block.headingLine);
  const after = all.slice(end);

  if (clean.length === 0) {
    return tidy([...trimTrailingBlanks(before), ...(after.length ? [''] : []), ...dropLeadingBlanks(after)]);
  }

  const heading = all[block.headingLine];

  return tidy([
    ...before,
    heading,
    ...clean,
    ...(after.length ? [''] : []),
    ...dropLeadingBlanks(after),
  ]);
}

function trimTrailingBlanks(lines: string[]): string[] {
  const copy = [...lines];
  while (copy.length && copy[copy.length - 1].trim() === '') copy.pop();
  return copy;
}

function dropLeadingBlanks(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start += 1;
  return lines.slice(start);
}

/** Collapse any run of blank lines to one. Two blank lines mean nothing extra. */
function tidy(lines: string[]): string {
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && out.length > 0 && out[out.length - 1].trim() === '') continue;
    out.push(line);
  }
  return trimTrailingBlanks(out).join('\n');
}

/** Add an exercise heading with no sets yet, so the grid grows a row for it. */
export function addExercise(text: string, name: string): string {
  const page = parsePage(text);
  if (page.exercises.some((block) => block.key === headingKey(name))) return text;

  const existing = trimTrailingBlanks(text.split('\n'));
  return [...existing, ...(existing.length ? [''] : []), name.trim()].join('\n');
}
