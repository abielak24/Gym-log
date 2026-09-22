/**
 * Sample data: five sessions of each split, and a couple of weeks of the
 * daily tracker, so the grid and the calendar can be seen with history in
 * them rather than empty.
 *
 * Everything here is dated relative to the day it is loaded, and everything
 * is marked as a sample so it can be removed in one tap without touching
 * anything real.
 */

import type { Session } from './types';
import { makeEntry, type DailyLog } from './daily';

/** Days before today, newest last, so progression reads left to right. */
const CHEST_DAYS = [18, 14, 11, 7, 4];
const BACK_DAYS = [17, 13, 10, 6, 3];

/**
 * Five chest days with the incline press creeping up: 85 for eight becomes
 * 100 for six, with the back-off sets moving with it.
 */
const CHEST: string[] = [
  `Dumbbell Incline Press
45x8
45x8
70x8
80x8
85x8
85x7
70x8

Chest Fly
30x12
30x12
35x12
35x12

Iso Chest Press
210x12
210x12
210x12

Dips
10
15x10
15x10`,

  `Dumbbell Incline Press
45x8
50x8
70x8
80x8
90x8
90x6
70x8

Chest Fly
35x12
35x12
35x12
35x12

Iso Chest Press
210x12
230x12
230x11

Dips
10
20x10
20x10`,

  `Dumbbell Incline Press
45x8
50x8
75x8
85x8
90x8
95x6

Chest Fly
35x12
35x12
40x12
40x11

Iso Chest Press
230x12
230x12
230x12`,

  `Dumbbell Incline Press
45x8
50x8
75x8
85x8
90x8
95x7
70x8

Chest Fly
40x12
40x12
40x12
40x12

Iso Chest Press
230x12
230x12
230x12

Dips
12
20x10
20x10
50x10`,

  `Dumbbell Incline Press
45x8
50x8
75x8
85x8
95x8
100x6
70x8

Chest Fly
40x12
40x12
45x12
45x10

Iso Chest Press
230x12
250x11
250x10

Dips
12
20x10
50x10
50x10`,
];

/**
 * Five back days. The third has no curls, which is what an unfinished
 * session looks like: a blank cell, not a zero.
 */
const BACK: string[] = [
  `Pull Ups
8
8
7

Lat Pull Down
160x8
160x8
160x7

Rows | Cable Rows
20x10 | 15x10
20x10 | 15x10
20x10 | 15x10

Curls
35x12
35x12
35x12`,

  `Pull Ups
9
8
8

Lat Pull Down
170x6
170x8
170x8

Rows | Cable Rows
25x10 | 20x10
25x10 | 20x10
25x10 | 20x10

Curls
40x12
40x12
40x11`,

  `Pull Ups
10
9
8

Lat Pull Down
170x8
170x8
170x8

Rows | Cable Rows
25x10 | 20x10
25x10 | 20x10`,

  `Pull Ups
10
10x8
10x8

Lat Pull Down
180x6
180x6
170x8

Rows | Cable Rows
25x10 | 20x10
30x10 | 20x10
30x10 | 20x10

Curls
40x12
40x12
45x10`,

  `Pull Ups
12
10x8
10x8

Lat Pull Down
180x8
180x7
180x7

Rows | Cable Rows
30x10 | 25x10
30x10 | 25x10
30x10 | 25x10

Curls
45x12
45x11
45x10`,
];

export function createSamples(today = new Date()): Session[] {
  const sessions: Session[] = [
    ...CHEST_DAYS.map((ago, index) => page(daysBefore(today, ago), 'Chest/Tris', CHEST[index])),
    ...BACK_DAYS.map((ago, index) => page(daysBefore(today, ago), 'Back/Bis/Shoulders', BACK[index])),
  ];

  return sessions.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Steps that mostly miss, cardio that mostly lands: enough variety to read. */
const STEPS = ['9.2k', '11k', '7.5k', '10.4k', '8.1k', '12k', '10k', '6.8k', '10.2k', '9.5k', '13k', '7.9k'];
const CARDIO = ['30min', '35min', '20min', '30min', '', '45min', '30min', '15min', '30min', '30min', '40min', '25min'];
const PUSHUPS = ['100', '100', '60', '100', '80', '120', '100', '100', '100', '40', '100', '100'];

export function createSampleDaily(today = new Date()): DailyLog {
  const log: DailyLog = {};

  STEPS.forEach((steps, index) => {
    const date = iso(daysBefore(today, index + 1));
    log[date] = [
      makeEntry('Pushups', '100', PUSHUPS[index]),
      makeEntry('Cardio', '30min', CARDIO[index]),
      makeEntry('Steps', '10k', steps),
    ];
  });

  return log;
}

function page(date: Date, title: string, body: string): Session {
  const id = iso(date);
  return {
    id,
    date: id,
    text: `${title} ${date.getMonth() + 1}/${date.getDate()}\n${body}`,
    updatedAt: Date.now(),
    sample: true,
  };
}

function daysBefore(today: Date, days: number): Date {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  date.setDate(date.getDate() - days);
  return date;
}

function iso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
