# Gym Notebook

A workout log that reads the format a paper notebook already uses: one page
per day, typed as free text, parsed into structure. It runs entirely on the
phone — no account, no server, no network.

## Commands

```sh
npm install
npm test                 # 65 unit tests: parser, history, export round trips
npm run dev              # dev server
npm run build            # production build into dist/
node scripts/smoke.mjs   # needs a build first; drives the built app in
                         # Chromium at iPhone size, writes shots/
```

**Run both `npm test` and `scripts/smoke.mjs` before every push.** The smoke
test is what makes pushing straight to main safe — it catches the things unit
tests cannot, like the editor's two layers drifting out of register, or the
app failing to open offline.

## Layout

- `src/core/` — the format, the history index, the export. Plain TypeScript,
  **no browser imports**. This is the part that would move into a native app
  unchanged, so keep DOM code out of it.
- `src/app/` — the only code that touches the DOM.
- `scripts/` — icon generation and the browser smoke test.

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
