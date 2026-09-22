# Gym Notebook

A workout log that reads the format a paper notebook already uses. Each day
is a plain-text page; each split is a grid built by reading those pages back,
with one column per session. It runs entirely on the phone — no account, no
server, no network.

## Commands

```sh
npm install
npm test                 # unit tests: parser, splits, grid, cell writes, export
npm run dev              # dev server
npm run build            # production build into dist/
node scripts/smoke.mjs   # needs a build first; drives the built app in
                         # Chromium at iPhone size, writes shots/
BASE_PATH=/Gym-log/ node scripts/smoke.mjs   # as Pages actually serves it
```

**Run both `npm test` and `scripts/smoke.mjs` before every push.** The smoke
test is what makes pushing straight to main safe — it catches the things unit
tests cannot, like the editor's two layers drifting out of register, or the
app failing to open offline.

## Layout

- `src/core/` — the format (`parse`), splits (`templates`), the grid
  (`grid`), writing a cell back into a page (`edit`), the history index and
  the export. Plain TypeScript, **no browser imports**. This is the part that
  would move into a native app unchanged, so keep DOM code out of it.
- `src/app/` — the only code that touches the DOM. `grid-view` is the main
  screen, `home-view` the splits and key lifts, `editor` the text page.
- `scripts/` — icon generation and the browser smoke test.

## One source of truth

Pages are the only stored workout data. Splits, the grid, history and the
summary are all **derived by parsing page text**, and every grid cell edit
goes back through `writeCell` into that text. Nothing about a workout is
stored twice. Keep it that way: the plain-text export is only honest because
there is nowhere else for a set to hide.

The two things that genuinely are stored separately are deliberate choices a
page cannot express — `overrides` (a renamed or reordered split) and
`starred` (which lifts show in the summary).

## Settled decisions — don't reopen these without being asked

- **Free text, not forms.** No exercise picker, no set-builder UI, no modals.
  If a change adds a tap between the user and writing a set, it is wrong.
- **Flag, don't guess.** A line that looks like a set but isn't quite one is
  flagged with the reason and stored verbatim. Never silently reinterpret
  input into a number the user did not write. `45x8` is a set; `95x` is a
  flag; `230` alone is a flag saying it looks like a weight missing its reps.
- **Not in scope:** charts, estimated 1RM, rest timers, plate calculators,
  streaks, sync, accounts. Each is a reason to look at a phone for longer
  between sets.
- **Supersets** parse from `|` into separate tracked columns, but are shown
  as text. The parsing is deliberate — the format must not be lossy — and the
  two-column display is deliberately deferred.
- **Splits are derived, not configured.** An exercise written into today's
  page joins that split silently; one that stops being done falls out after
  `RECENT_WINDOW` sessions. Do not add a setup step for this.
- **Only today's column is editable.** Past sessions are read-only in the
  grid; to change one, open its page from the Log.
- **lb only.** No unit conversion. Numbers are whatever was typed.

## Constraints that will bite you

- **The editor's two layers must agree on every metric.** `src/styles.css`
  paints line backgrounds in a backdrop that mirrors the textarea. A `.ln-*`
  rule may set background, color and text-decoration — **never** font-weight,
  font-size, padding or margin. Change one and the highlight bands slide out
  of line with the text.
- **`teardown()` nulls `openEditor` before destroying it.** Destroying saves,
  which notifies the store, which can re-run the route and land back in
  `teardown` — that recursed infinitely once already.
- **Ghost text only renders when the cursor's block is the last on the page**,
  because there is nothing below it to collide with. The hint bar covers the
  mid-page case.
- **`overflow-x: auto` makes a container scroll on BOTH axes.** `.grid-scroll`
  is therefore a scroll container vertically too, so `position: sticky; top:`
  inside it is measured from the grid's own top, not the viewport's — which
  parked the date header permanently on top of the first row. Only the
  horizontal stickiness of the exercise column is real.
- **Never re-render a screen that owns focus.** The store's subscriber
  redraws only the Log. The grid's cells and the page editor save on a
  debounce, and rebuilding them mid-keystroke throws away the cursor.
- **`writeCell` keeps what it did not write.** Notes and unreadable lines
  under an exercise survive a cell edit (they collect below the sets). Tests
  in `tests/edit.test.ts` pin this down — it is somebody's log, not ours to
  tidy.
- **Storage is per-origin `localStorage`.** Moving the app to a different
  host strands the log; export/import is the only migration path. This is
  also why the backup nudge exists.
- **A line with no digits is read as an exercise name.** So prose becomes a
  heading, and sets after it attach to it. The parser reports headings with
  no sets under them (`page.emptyExercises`); it cannot detect the case where
  prose is followed by sets. Documented in the README under Known limits.

## The format

| Written | Read as |
| --- | --- |
| `Chest/Tris 9/22` or `9/22 Chest/Tris` | header: a name and a date |
| `Dumbbell Incline Press` | an exercise — any line that isn't a set |
| `95x7` | 95 lb for 7 reps (`X`, spaces and decimals all fine) |
| `10` | a set at bodyweight: 10 reps |
| `25x10 \| 20x10` | a superset, split into columns |
| `95x7 (felt heavy)` | a set with a note |
| `// slept badly` | a note, ignored by history |

The two pages from the original notebook photo live in `src/core/sample.ts`
and are the fixture the parser tests run against. If you change the format,
those tests are the contract you are changing.
