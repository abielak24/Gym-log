/**
 * A split as a grid: exercises down the left, one column per session.
 *
 * The columns run oldest to newest, the way the pages of a notebook do, so
 * today's session is the rightmost column and comparing it to last time is a
 * glance sideways rather than a flip back.
 *
 * Nothing here is stored. The grid is read out of the same page text the
 * editor writes, which keeps one source of truth and keeps the plain-text
 * export honest.
 */

import type { Session, Template } from './types';
import { parsePage } from './parse';

export interface GridColumn {
  sessionId: string;
  date: string;
  /** The column being written today, if there is one. */
  editable: boolean;
}

export interface GridCell {
  /**
   * Every line under the exercise heading, exactly as written — sets, notes
   * and lines the parser could not read alike. A cell that showed only what
   * parsed would hide the rest from the one person able to fix it, and the
   * write-back would then duplicate those lines on every save.
   */
  lines: string[];
  /** True when something in this cell is not readable as a set. */
  unreadable: boolean;
}

export interface GridRow {
  key: string;
  name: string;
  cells: GridCell[];
}

export interface Grid {
  template: Template;
  columns: GridColumn[];
  rows: GridRow[];
}

/** How many sessions of history a grid shows before it stops widening. */
const MAX_COLUMNS = 8;

export function buildGrid(
  template: Template,
  sessions: Session[],
  options: { editableSessionId?: string; maxColumns?: number } = {},
): Grid {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const limit = options.maxColumns ?? MAX_COLUMNS;

  // sessionIds arrive newest first; take the most recent, then flip to
  // chronological so the newest ends up on the right.
  const chosen = template.sessionIds
    .map((id) => byId.get(id))
    .filter((s): s is Session => Boolean(s))
    .slice(0, limit)
    .reverse();

  const columns: GridColumn[] = chosen.map((session) => ({
    sessionId: session.id,
    date: session.date,
    editable: session.id === options.editableSessionId,
  }));

  // One parse per column, not one per cell.
  const pages = chosen.map((session) => parsePage(session.text));

  // Anything written into today's page gets a row even if the split has
  // never seen it and it has no sets yet - otherwise an exercise you just
  // added would have nowhere to be typed.
  const editable = chosen.find((session) => session.id === options.editableSessionId);
  const exercises = [...template.exercises];
  if (editable) {
    for (const stray of strayExercises(template, editable)) exercises.push(stray);
  }

  const rows: GridRow[] = exercises.map((exercise) => ({
    key: exercise.key,
    name: exercise.name,
    cells: pages.map((page) => {
      const blocks = page.exercises.filter((block) => block.key === exercise.key);
      const lines = blocks
        .flatMap((block) => [...block.sets, ...block.notes, ...block.flagged])
        .sort((a, b) => a.index - b.index);

      return {
        lines: lines.map((line) => line.text.trim()),
        unreadable: lines.some((line) => line.kind === 'flagged'),
      };
    }),
  }));

  return { template, columns, rows };
}

/** Exercises written in a session that the template does not list. */
export function strayExercises(template: Template, session: Session): Array<{ key: string; name: string }> {
  const known = new Set(template.exercises.map((e) => e.key));
  const stray: Array<{ key: string; name: string }> = [];

  for (const block of parsePage(session.text).exercises) {
    if (!block.key || known.has(block.key) || stray.some((s) => s.key === block.key)) continue;
    stray.push({ key: block.key, name: block.name });
  }
  return stray;
}
