/**
 * Exercise names are typed fresh every session, so the same lift arrives
 * spelled a dozen ways. Normalising them is what keeps six months of
 * `DB Incline Press` and `Dumbbell incline press` from becoming two
 * half-empty histories.
 */

/** Word-level substitutions applied after punctuation is stripped. */
const ALIASES: Record<string, string> = {
  db: 'dumbbell',
  dbs: 'dumbbell',
  dumbell: 'dumbbell',
  dumbells: 'dumbbell',
  dumbbells: 'dumbbell',
  bb: 'barbell',
  bw: 'bodyweight',
  ohp: 'overhead press',
  rdl: 'romanian deadlift',
  bp: 'bench press',
  lat: 'lat',
  lats: 'lat',
  pulldown: 'pull down',
  pulldowns: 'pull down',
  pullup: 'pull up',
  pullups: 'pull up',
  pushup: 'push up',
  pushups: 'push up',
  chinup: 'chin up',
  chinups: 'chin up',
  tri: 'tricep',
  tris: 'tricep',
  triceps: 'tricep',
  bi: 'bicep',
  bis: 'bicep',
  biceps: 'bicep',
  iso: 'iso',
  machine: 'machine',
};

/** Words that describe how a block is *organised*, not which lift it is. */
const STRUCTURAL = new Set(['superset', 'superssets', 'supersets', 'ss', 'dropset', 'dropsets']);

/**
 * Reduce a written name to a stable identity.
 *
 * `Rows (superset)` and `rows` both become `row`; `47.5 Chest Fly` keeps its
 * digits, since a number in a name is usually a machine setting worth keeping.
 */
export function normalizeName(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ALIASES[w] ?? w)
    .filter((w) => !STRUCTURAL.has(w));

  // Singularise the common plural-by-`s` case so `curls` and `curl` agree.
  // The threshold is three characters rather than four because `ups` is a
  // word that matters here: `Pull Ups` and `Pull Up` are one exercise.
  const singular = words.map((w) => (w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  return singular.join(' ').trim();
}

/**
 * The identity of an exercise heading, which may name both sides of a
 * superset: `Rows | Cable Rows` is the `Rows` row of the grid, with `Cable
 * Rows` as its second column.
 *
 * Everything that looks an exercise up by name must use this rather than
 * `normalizeName`, or a superset row will not find its own block.
 */
export function headingKey(heading: string): string {
  return normalizeName(heading.split('|')[0]);
}

/** How close two names are, 0..1, for "did you mean" suggestions. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}
