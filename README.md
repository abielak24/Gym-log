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

Two tabs. **Home** is your splits, your daily tracker and your key lifts;
**Calendar** is the month, with the workouts written onto it.

**Splits** are not set up — they're read out of what you've written. Every
page title you've used is a split, and its exercises are whatever the recent
sessions under that title contain. Add an exercise mid-workout and it's part
of that split from then on; stop doing one and it drops off after a few
sessions. That's how a split actually drifts, and it needs no bookkeeping.

When you want to change one deliberately, **Edit split** renames it, adds or
drops an exercise, or reorders them — drag the handles, and the grid follows.
None of that touches your logged pages.

**Supersets** are one row with two columns. Add an exercise named
`Rows | Cable Rows` — from the grid or from Edit split — and its sets are
written the same way: `25x10 | 20x10`. Each side keeps its own history.

**Key lifts** are the ones you star. They gather on the home screen with the
last time you did them and your best set, whichever split they came from —
so when you reshuffle your training, the lifts you actually care about don't
quietly vanish along with the split that used to contain them. A starred lift
you haven't touched in two weeks says so.

**The daily tracker** is separate from all the split machinery — things you
count every day rather than lift in a session:

```
Pushups    100   / 100
Cardio     30min / 30min
Steps      7.5k  / 10k
```

Write the numbers the way you say them: `100`, `30min`, `1h`, `10k`, `5mi`.
Each day owns its own goals, so a target can change without rewriting
history, and a new day arrives pre-filled with yesterday's goals and empty
values — one number per row to fill in. A day you never touch stays
untracked rather than becoming a row of zeroes.

**The calendar** fills itself in: a day is marked because a page was written
for it, not because anything was scheduled. Tap a day you trained to open it
for editing; tap an empty one to add a workout you forgot to write down. The
dots under a date are that day's daily goals — solid for each one met — and
any day's tracker can be opened from there.

**Nothing is saved by hand.** A cell saves itself a moment after you stop
typing, and again the instant the app is backgrounded or closed. Grey text
in a cell is last session's, shown for reference; anything in normal text is
yours and is already saved.

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
| `Rows \| Cable Rows` | a superset: an exercise naming both sides |
| `25x10 \| 20x10` | its sets: a column per side, split by the same pipe |
| `95x7 (felt heavy)` | a set with a note attached |
| `// slept badly` | a note, ignored by history |
| `@ Steps 7.5k/10k` | a daily tracker row — only ever written by the export |

Spaces around the `x` don't matter, and `X` works too. The page title is what
puts a session in a split, which is the whole of the bookkeeping.

## What it does that paper can't

**It shows you last time, twice over.** In the grid, last session is the
column next to the one you're filling in. In an empty cell, its sets appear
as a placeholder. And in the text page, they appear in grey under the cursor.
Names are matched loosely, so `DB Incline Press` and `Dumbbell Incline Press`
are one exercise with one history.

**You can write things that aren't sets.** Start a line with `//` and it is
kept with that exercise and left out of your history:

```
95x7
95x6
// shoulder felt tight, stopped early
```

Inside a grid cell you don't have to remember the `//`. The cell already
says which exercise you mean, so a sentence typed there is kept as a note on
it — the app says so while you type, and settles it when you move on. On the
text page there is no such context, so a line with no numbers really is read
as a new exercise; that is what the `//` is for.

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
reads either back. Both carry the daily tracker: in the text file it appears
as `@` lines under the day it belongs to, which import back as tracker rows
rather than as sets.

No browser can write to iCloud Drive on its own, so this is one deliberate tap
rather than background sync. The app nudges you if a week goes by without one.

## Seeing it with history in it

A fresh install comes with sample data: five sessions of each of two splits
over the past three weeks, and a fortnight of the daily tracker. It is enough
to see progression in a grid, a blank cell where a session was left
unfinished, and a calendar with dots on it.

Clear it in one tap from the banner at the top of Home, and load it again
from the bottom of Home whenever you want another look. Loading it never
touches a day you have really trained.

To empty the app completely — pages, splits, stars and tracked days —
**Start fresh** at the bottom of Home asks once and then erases everything on
the device. There is no undo, so export first if any of it mattered.

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

- **Prose on the text page becomes a heading.** Reading a page top to bottom,
  a line with no digits is an exercise name, so `felt weak today` typed into
  the text editor starts a new exercise and the sets after it attach to that.
  The editor styles it as a heading so you can see it happen, and flags it if
  nothing follows. Grid cells do not have this problem — there the exercise
  is already known — but on the text page, prefix thoughts with `//`.
- **The daily tracker has no comments.** A row is a name, a value and a goal;
  there is nowhere to say why the number was what it was.
- **Weight is just a number.** `50x10` under `Dips` could be 50 lb added or 50
  lb of assistance. The app records what you wrote and doesn't guess, which
  means it also can't total those sets correctly in volume.
- **One split per page title.** Two splits with the same name are one split.
  Rename one if you want them apart.
- **Calendar squares abbreviate.** `Back/Bis/Shoulders` shows as `B/B/S`;
  the full name is in the tooltip, when you tap the day, and for a screen
  reader.
- **lb only.** Nothing converts units; the numbers are whatever you typed.
