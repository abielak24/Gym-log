/**
 * Reading a notebook page.
 *
 * The rules are the ones you already follow on paper, written down:
 *
 *   Chest/Tris 9/22        a header: a name and a date
 *   Dumbbell Incline Press an exercise: a line that isn't a set
 *   95x7                   a set: weight x reps
 *   10                     a set at bodyweight: reps alone
 *   25x10 | 20x10          a superset: columns split by `|`
 *   // felt weak today     a note, ignored by history
 *
 * Nothing is guessed. A line that looks like a set but isn't quite one is
 * flagged with the reason rather than silently reinterpreted, because a
 * wrong number recorded quietly is worse than no number at all.
 */

import type { ExerciseBlock, LineInfo, Page, SetEntry } from './types';
import { normalizeName } from './normalize';

const NOTE_PREFIX = /^(?:\/\/|#)\s?/;
const WEIGHTED = /^(\d+(?:\.\d+)?)\s*(?:lbs?|kgs?)?\s*[xX×]\s*(\d+)\s*(?:\(([^)]*)\))?$/;
const BODYWEIGHT = /^(\d+)\s*(?:\(([^)]*)\))?$/;
const DATE_AT_END = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*$/;
const DATE_AT_START = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?:\s+|$)/;

/** A bare number larger than this is a weight someone forgot to finish, not a rep count. */
const MAX_BARE_REPS = 100;
const MAX_WEIGHT = 2000;

type ColumnResult =
  | { ok: true; entry: SetEntry }
  /** `reason: null` means the text isn't set-shaped at all — it may be an exercise name. */
  | { ok: false; reason: string | null };

function parseColumn(text: string): ColumnResult {
  const weighted = WEIGHTED.exec(text);
  if (weighted) {
    const weight = Number(weighted[1]);
    const reps = Number(weighted[2]);
    if (reps < 1) return { ok: false, reason: 'a set needs at least one rep' };
    if (reps > 999) return { ok: false, reason: `${reps} reps looks like a typo` };
    if (weight > MAX_WEIGHT) return { ok: false, reason: `${weight} looks like a typo` };
    return { ok: true, entry: { weight, reps, note: weighted[3]?.trim() || undefined } };
  }

  const bare = BODYWEIGHT.exec(text);
  if (bare) {
    const reps = Number(bare[1]);
    if (reps < 1) return { ok: false, reason: 'a set needs at least one rep' };
    if (reps > MAX_BARE_REPS) {
      return { ok: false, reason: `a number this big on its own reads as reps — did you mean ${bare[1]}x?` };
    }
    return { ok: true, entry: { weight: null, reps, note: bare[2]?.trim() || undefined } };
  }

  // Set-shaped but broken: `95x`, `x8`, `95 x 8 heavy`, `45xx8`.
  if (/\d/.test(text) && /[xX×]/.test(text)) {
    return { ok: false, reason: 'not readable as weight x reps' };
  }
  return { ok: false, reason: null };
}

type LineResult =
  | { ok: true; columns: SetEntry[] }
  | { ok: false; reason: string | null };

/** Parse one line of set notation, including `|`-separated superset columns. */
export function parseSetLine(text: string): LineResult {
  const parts = text.split('|').map((p) => p.trim());

  if (parts.length > 1) {
    const columns: SetEntry[] = [];
    for (const part of parts) {
      if (!part) return { ok: false, reason: 'a superset column is empty' };
      const result = parseColumn(part);
      if (!result.ok) return { ok: false, reason: result.reason ?? `"${part}" is not a set` };
      columns.push(result.entry);
    }
    return { ok: true, columns };
  }

  const single = parseColumn(parts[0]);
  return single.ok ? { ok: true, columns: [single.entry] } : { ok: false, reason: single.reason };
}

/** Pull an ISO date out of a header line, resolving a bare `9/22` against today. */
export function parseDate(token: string, today = new Date()): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(token);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(token);
  if (!slash) return null;

  const month = Number(slash[1]);
  const day = Number(slash[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  if (slash[3]) {
    const raw = Number(slash[3]);
    return toIso(raw < 100 ? 2000 + raw : raw, month, day);
  }

  // No year written. Assume the most recent occurrence: a page dated 12/28
  // written on January 3rd belongs to last year, not next year.
  const year = today.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const aMonthAhead = new Date(today.getTime() + 31 * 86400000);
  return toIso(candidate > aMonthAhead ? year - 1 : year, month, day);
}

function toIso(year: number, month: number, day: number): string {
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Decide whether an unreadable line is an exercise name or a broken set.
 *
 * A line with no digits is always a name. A line with digits is a name only
 * when it starts a fresh block — `Cable Row 2` after a blank line is an
 * exercise, while `95x` in the middle of a run of sets is a typo.
 */
function looksLikeExerciseName(text: string, startsBlock: boolean): boolean {
  return !/\d/.test(text) || startsBlock;
}

export function parsePage(text: string, today = new Date()): Page {
  const rawLines = text.split('\n');
  const lines: LineInfo[] = [];
  const exercises: ExerciseBlock[] = [];
  const pageNotes: LineInfo[] = [];
  const pageFlagged: LineInfo[] = [];

  let title = '';
  let date: string | null = null;
  let headerLine: number | null = null;
  let current: ExerciseBlock | null = null;
  let startsBlock = true;

  rawLines.forEach((raw, index) => {
    const trimmed = raw.trim();
    const add = (info: LineInfo) => {
      lines.push(info);
      if (info.kind === 'flagged') {
        pageFlagged.push(info);
        if (current) current.flagged.push(info);
      }
    };

    if (!trimmed) {
      add({ index, kind: 'blank', text: raw });
      startsBlock = true;
      return;
    }

    if (NOTE_PREFIX.test(trimmed)) {
      const info: LineInfo = { index, kind: 'note', text: raw, exercise: current ? exercises.length - 1 : undefined };
      add(info);
      if (current) current.notes.push(info);
      else pageNotes.push(info);
      startsBlock = false;
      return;
    }

    const set = parseSetLine(trimmed);

    // The first line that isn't a set is the page header.
    if (headerLine === null && !set.ok) {
      headerLine = index;
      // `Chest/Tris 9/22` is how the notebook reads; `9/22 Chest/Tris` is what
      // you get by typing after the date the app pre-fills. Both are a header.
      const trailing = DATE_AT_END.exec(trimmed);
      const leading = DATE_AT_START.exec(trimmed);
      if (trailing) {
        date = parseDate(trailing[1], today) || null;
        title = trimmed.slice(0, trailing.index).trim();
      } else if (leading) {
        date = parseDate(leading[1], today) || null;
        title = trimmed.slice(leading[0].length).trim();
      } else {
        title = trimmed;
      }
      add({ index, kind: 'header', text: raw });
      startsBlock = true;
      return;
    }

    if (set.ok) {
      if (!current) {
        add({ index, kind: 'flagged', text: raw, reason: 'a set with no exercise above it' });
        startsBlock = false;
        return;
      }
      const info: LineInfo = { index, kind: 'set', text: raw, columns: set.columns, exercise: exercises.length - 1 };
      add(info);
      current.sets.push(info);
      widenColumns(current, set.columns.length);
      startsBlock = false;
      return;
    }

    if (set.reason === null && looksLikeExerciseName(trimmed, startsBlock)) {
      current = newBlock(trimmed, index);
      exercises.push(current);
      add({ index, kind: 'exercise', text: raw, exercise: exercises.length - 1 });
      startsBlock = false;
      return;
    }

    add({
      index,
      kind: 'flagged',
      text: raw,
      reason: set.reason ?? 'not a set and not an exercise name',
      exercise: current ? exercises.length - 1 : undefined,
    });
    startsBlock = false;
  });

  const emptyExercises = exercises.filter((block, i) => block.sets.length === 0 && i < exercises.length - 1);

  return { title, date, headerLine, exercises, emptyExercises, notes: pageNotes, flagged: pageFlagged, lines };
}

function newBlock(heading: string, headingLine: number): ExerciseBlock {
  const names = heading.includes('|')
    ? heading.split('|').map((n) => n.trim()).filter(Boolean)
    : [heading.trim()];

  return {
    name: heading.trim(),
    key: normalizeName(names[0]),
    columnNames: names,
    columnKeys: names.map(normalizeName),
    headingLine,
    sets: [],
    notes: [],
    flagged: [],
  };
}

/**
 * A superset heading is often written once (`Rows (superset)`) while the sets
 * below it carry two columns. Name the extra columns from the heading so each
 * side still gets its own history.
 */
function widenColumns(block: ExerciseBlock, count: number): void {
  while (block.columnNames.length < count) {
    const suffix = String.fromCharCode(65 + block.columnNames.length); // A, B, C
    block.columnNames.push(`${block.name} (${suffix})`);
    block.columnKeys.push(normalizeName(`${block.name} ${suffix}`));
  }
  if (count > 1 && block.columnNames.length >= 1 && !block.name.includes('|') && block.columnNames[0] === block.name) {
    block.columnNames[0] = `${block.name} (A)`;
    block.columnKeys[0] = normalizeName(`${block.name} A`);
  }
}
