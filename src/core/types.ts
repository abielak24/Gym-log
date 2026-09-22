/**
 * The vocabulary of a notebook page.
 *
 * Everything in this folder is plain TypeScript with no browser imports, so
 * the format survives a change of UI — or a move to a native app — untouched.
 */

/** One set, as written: `95x7`, `10`, `47.5x12 (left side felt off)`. */
export interface SetEntry {
  /** Whatever number you wrote before the `x`. `null` when you wrote reps alone. */
  weight: number | null;
  reps: number;
  /** A trailing parenthetical, kept verbatim. */
  note?: string;
}

export type LineKind = 'blank' | 'header' | 'exercise' | 'set' | 'note' | 'flagged';

/** Every line of the page gets one of these, in order. The editor highlights from it. */
export interface LineInfo {
  index: number;
  kind: LineKind;
  text: string;
  /** Which exercise block the line belongs to, if any. */
  exercise?: number;
  /** For `set` lines: one entry per superset column. */
  columns?: SetEntry[];
  /** For `flagged` lines: why the parser could not read it. */
  reason?: string;
}

export interface ExerciseBlock {
  /** The name exactly as written on the page. */
  name: string;
  /** Normalised identity, so `DB Incline Press` and `Dumbbell Incline Press` are one exercise. */
  key: string;
  /** One name per superset column. A normal exercise has exactly one. */
  columnNames: string[];
  columnKeys: string[];
  headingLine: number;
  sets: LineInfo[];
  notes: LineInfo[];
  flagged: LineInfo[];
}

export interface Page {
  /** The day's name, with the date removed: `Chest/Tris`. */
  title: string;
  /** ISO date parsed out of the header line, or null if it had none. */
  date: string | null;
  headerLine: number | null;
  exercises: ExerciseBlock[];
  /**
   * Headings with no sets under them, excluding the last one on the page
   * (which is just where you are mid-workout). Usually a sentence of prose
   * that should have been a `//` note, which matters because the sets below
   * it attach to it instead of to the lift above.
   */
  emptyExercises: ExerciseBlock[];
  notes: LineInfo[];
  flagged: LineInfo[];
  lines: LineInfo[];
}

/** A page plus the storage metadata the app wraps around it. */
export interface Session {
  id: string;
  /** ISO date. The header line is the source of truth; this is kept in sync with it. */
  date: string;
  text: string;
  updatedAt: number;
  /** Seeded example pages, which can be cleared in one tap. */
  sample?: boolean;
}
