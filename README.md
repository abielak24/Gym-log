# Gym Notebook

A workout log that works like the paper one, except it remembers what you
lifted last time.

Each split is a grid: exercises down the left, one dated column per session,
oldest to newest. Today's column is the one on the right, and it's the only
one you can type into — so logging a set is a tap and a few characters, with
last week's numbers sitting right beside them.

It runs entirely on your phone. No account, no server, no signal needed.

```
                9/8      9/15     9/22
Pull Ups        8        8        10
                10x8     10x8     12x8
                10x8     10x8     13x8

Lat Pull Down   170x6    170x6    180x5
                170x8    170x8
```

## How it's organised

Two tabs. **Home** is your splits and your key lifts; **Calendar** is the
month, with the workouts written onto it.

**Splits** are not set up — they're read out of what you've written. Every
page title you've used is a split, and its exercises are whatever the recent
sessions under that title contain. Add an exercise mid-workout and it's part
of that split from then on; stop doing one and it drops off after a few
sessions. That's how a split actually drifts, and it needs no bookkeeping.

When you want to change one deliberately, **Edit split** renames it, drops an
exercise, or reorders them — drag the handles, and the grid follows. None of
that touches your logged pages.

**Key lifts** are the ones you star. They gather on the home screen with the
last time you did them and your best set, whichever split they came from —
so when you reshuffle your training, the lifts you actually care about don't
quietly vanish along with the split that used to contain them. A starred lift
you haven't touched in two weeks says so.

**The calendar** fills itself in: a day is marked because a page was written
for it, not because anything was scheduled. Tap a day you trained to open it
for editing; tap an empty one to add a workout you forgot to write down.

**Finishing a session later.** A workout logged in a hurry is rarely
complete. Any column's date can be tapped to open that session for editing,
so a half-filled Monday can be finished on Wednesday without retyping it.
Cells you never fill just stay blank — nothing is ever required.

**The page** is still there behind the grid. Every cell you type writes
straight into a plain-text page for that day, and **As text** on any open
session shows it as exactly that, for whenever the grid is the wrong shape
for what happened.

## The format

There's no format to learn. These are the rules your notebook already
follows, written down:

| You write | It reads as |
| --- | --- |
| `Chest/Tris 9/22` or `9/22 Chest/Tris` | the day's header — a name and a date |
| `Dumbbell Incline Press` | an exercise; any line that isn't a set |
| `95x7` | a set: 95 lb for 7 reps |
| `47.5x12` | decimals are fine |
| `10` | a set at bodyweight: 10 reps |
| `50x10` under `Dips` | whatever you wrote — added weight, assistance, your call |
| `25x10 \| 20x10` | a superset: columns split by a pipe |
| `95x7 (felt heavy)` | a set with a note attached |
| `// slept badly` | a note, ignored by history |

Spaces around the `x` don't matter, and `X` works too. The page title is what
puts a session in a split, which is the whole of the bookkeeping.

## What it does that paper can't

**It shows you last time, twice over.** In the grid, last session is the
column next to the one you're filling in. In an empty cell, its sets appear
as a placeholder. And in the text page, they appear in grey under the cursor.
Names are matched loosely, so `DB Incline Press` and `Dumbbell Incline Press`
are one exercise with one history.

**It tells you when it didn't understand.** A line it can't read gets a red
wave under it and stays exactly as you typed it — nothing is ever silently
reinterpreted into a number you didn't mean. If the line was deliberate,
**It's a note** prefixes it with `//` and it stops asking.

**It keeps every session of every lift.** Tap any exercise name, or search
from Home.

## Backing up

Your log lives in this phone's browser storage and nowhere else. Losing the
phone loses the log, so the bottom of Home has **Save as text**, which hands
iOS a plain `.txt` file: *Share → Save to Files → iCloud Drive*. The file is the
notebook, in the format above, readable in any text editor forever. **Save as
JSON** is the same data in a form that restores byte-exactly, and **Restore**
reads either back.

No browser can write to iCloud Drive on its own, so this is one deliberate tap
rather than background sync. The app nudges you if a week goes by without one.

## Putting it on your phone

Open the site in Safari, then Share → **Add to Home Screen**. It gets its own
icon, opens full screen without browser chrome, and works with no signal.

Installing it this way also matters for your data: Safari clears storage for
*websites* left untouched for a week, but treats a home-screen app as
installed. Lifting regularly keeps it alive either way — back up anyway.

## Running it yourself

```sh
npm install
npm run dev              # development server
npm test                 # unit tests over the parser, splits, grid and export
npm run build            # production build into dist/
node scripts/smoke.mjs   # drives the built app in a real browser, writes shots/
BASE_PATH=/Gym-log/ node scripts/smoke.mjs   # as GitHub Pages serves it
```

`src/core/` is plain TypeScript with no browser imports: the format, the
splits, the grid, the history index and the export live there and are covered
by the unit tests. `src/app/` is the only part that touches the DOM. That
split is deliberate — if this ever becomes a native app, `core/` moves across
untouched.

## What it deliberately doesn't do

No charts, no estimated 1RM, no rest timer, no plate calculator, no streaks,
no sync, no accounts. Each of those is a real feature, and each one is a
reason to look at your phone for longer between sets.

## Known limits

- **Prose under an exercise becomes a heading.** A line with no digits is read
  as an exercise name, so `felt weak today` starts a new exercise, and sets
  written after it attach to that instead of the lift above. The editor shows
  it styled as a heading so you can see it happen, and flags it if nothing
  follows — but prefix thoughts with `//` and it can't bite.
- **Weight is just a number.** `50x10` under `Dips` could be 50 lb added or 50
  lb of assistance. The app records what you wrote and doesn't guess, which
  means it also can't total those sets correctly in volume.
- **One split per page title.** Two splits with the same name are one split.
  Rename one if you want them apart.
- **Calendar squares abbreviate.** `Back/Bis/Shoulders` shows as `B/B/S`;
  the full name is in the tooltip, when you tap the day, and for a screen
  reader.
- **lb only.** Nothing converts units; the numbers are whatever you typed.
