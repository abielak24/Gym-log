/**
 * Getting the log off the phone.
 *
 * No browser can write to iCloud Drive by itself, so this hands iOS a real
 * file and lets the share sheet do it: Share → Save to Files → iCloud Drive.
 * One tap more than automatic sync, and the result is a plain text file you
 * can read on anything.
 */

import { exportJson, exportText, importJson, importText, mergeDaily, mergeSessions } from '../core/serialize';
import type { Session } from '../core/types';
import * as store from './store';

function filename(extension: string, today = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `gym-notebook-${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.${extension}`;
}

/** Your pages, without the seeded examples. */
function realSessions(): Session[] {
  return store.sessions().filter((s) => !s.sample);
}

export async function backupNow(format: 'txt' | 'json' = 'txt'): Promise<string> {
  const sessions = realSessions();
  if (sessions.length === 0 && Object.keys(store.dailyLog()).length === 0) return 'Nothing written yet.';

  const daily = store.dailyLog();
  const contents = format === 'txt' ? exportText(sessions, daily) : exportJson(sessions, daily);
  const type = format === 'txt' ? 'text/plain' : 'application/json';
  const name = filename(format);
  const file = new File([contents], name, { type });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      store.markBackedUp();
      return 'Saved. Choose "Save to Files" to keep it in iCloud Drive.';
    } catch (error) {
      // A cancelled share sheet is not a failure worth shouting about.
      if (error instanceof DOMException && error.name === 'AbortError') return '';
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  store.markBackedUp();
  return `Downloaded ${name}.`;
}

export async function restoreFrom(file: File): Promise<string> {
  const text = await file.text();
  const looksLikeJson = file.name.endsWith('.json') || text.trimStart().startsWith('{');

  let incoming: { sessions: Session[]; daily: ReturnType<typeof store.dailyLog> };
  try {
    incoming = looksLikeJson ? importJson(text) : importText(text);
  } catch (error) {
    return `Could not read that file: ${(error as Error).message}`;
  }

  const trackedDays = Object.keys(incoming.daily).length;
  if (incoming.sessions.length === 0 && trackedDays === 0) return 'No pages found in that file.';

  const { sessions, added, replaced } = mergeSessions(realSessions(), incoming.sessions);
  store.replaceAll(sessions, mergeDaily(store.dailyLog(), incoming.daily));

  const parts = [
    added ? `${added} page${added === 1 ? '' : 's'} added` : '',
    replaced ? `${replaced} replaced` : '',
    trackedDays ? `${trackedDays} tracked day${trackedDays === 1 ? '' : 's'}` : '',
  ];
  const summary = parts.filter(Boolean).join(', ');
  return summary ? `Restored: ${summary}.` : 'Everything in that file was already here.';
}
