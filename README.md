# Gym Notebook

A workout log that works like the paper one, except it remembers what you
lifted last time.

Open it, type `95x7`, put the phone down. No fields, no exercise picker, no
modal asking which muscle group you are targeting. One page per day, written
in the order you did it, in the notation you already use.

It runs entirely on your phone. No account, no server, no signal needed.

```
9/22 Chest/Tris
Dumbbell Incline Press
45x8
45x8
70x8
80x8
90x8
95x7
70x8

Chest Fly
47.5x12
47.5x12
35x12
```

## The format

There is no format to learn. These are the rules your notebook already
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

Spaces around the `x` don't matter, and `X` works too. Blank lines between
exercises are optional.

## What it does that paper can't

**It shows you last time.** Type an exercise name and last session's sets
appear in grey underneath the cursor. Keep typing and they peel away one by
one as you replace them; press Tab, or the **Fill** button, to accept the rest
as a starting point. Names are matched loosely, so `DB Incline Press` and
`Dumbbell Incline Press` are the same exercise and share one history.

**It tells you when it didn't understand.** A line it can't read gets a red
wave under it and stays exactly as you typed it — nothing is ever silently
reinterpreted into a number you didn't mean. Tap the counter in the bottom bar
to see what confused it. If the line was deliberate, **It's a note** prefixes
it with `//` and it stops asking.

**It keeps every session of every lift.** Tap any exercise name in the log.

## Backing up

Your log lives in this phone's browser storage and nowhere else. Losing the
phone loses the log, so the Log screen has **Save as text**, which hands iOS a
plain `.txt` file: *Share → Save to Files → iCloud Drive*. The file is the
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
npm run dev       # development server
npm test          # 65 unit tests over the parser, history and export
npm run build     # production build into dist/
node scripts/smoke.mjs   # drives the built app in a real browser, writes shots/
```

`src/core/` is plain TypeScript with no browser imports: the format, the
history index, and the export live there and are covered by the unit tests.
`src/app/` is the only part that touches the DOM. That split is deliberate —
if this ever becomes a native app, `core/` moves across untouched.

## What it deliberately doesn't do

No charts, no estimated 1RM, no rest timer, no plate calculator, no streaks,
no sync, no accounts. Supersets are stored faithfully but shown as text rather
than as two columns. Each of those is a real feature, and each one is a reason
to look at your phone for longer between sets.

## Known limits

- **Prose under an exercise becomes a heading.** A line with no digits is read
  as an exercise name, so `felt weak today` starts a new exercise, and sets
  written after it attach to that instead of the lift above. The editor shows
  it styled as a heading so you can see it happen, and flags it if nothing
  follows — but prefix thoughts with `//` and it can't bite.
- **Weight is just a number.** `50x10` under `Dips` could be 50 lb added or 50
  lb of assistance. The app records what you wrote and doesn't guess, which
  means it also can't total those sets correctly in volume.
- **lb only.** Nothing converts units; the numbers are whatever you typed.
