/**
 * The Friends tab: who else is training, and how their week is going.
 *
 * Deliberately a tab you visit rather than anything on the home screen. The
 * app's job is answering "did I beat last week?"; this answers a different
 * question, and it should not be able to shout over the first one.
 */

import { friendlyDate, thousands } from './format';
import {
  createCrew, fetchBoard, isConfigured, joinCrew, joinLink, leaveCrew, mySummary, postSummary,
  type BoardMember,
} from './crew';
import { toast } from './panels';
import * as store from './store';

/** A member who has not posted in this long is shown as gone quiet. */
const STALE_DAYS = 14;

/**
 * Only redraw if the screen that asked for it is still the screen on show.
 *
 * Fetching the board takes as long as it takes, and someone who taps away
 * meanwhile must not have this tab painted over whatever they moved to.
 */
function stillHere(hash: string, redraw: () => void): void {
  if (location.hash === hash) redraw();
}

export function renderCrew(root: HTMLElement): void {
  root.replaceChildren();

  const heading = document.createElement('h1');
  heading.className = 'exercise-name';
  heading.textContent = 'Friends';
  root.append(heading);

  if (!isConfigured()) {
    root.append(note('Sharing is not set up on this copy of the app yet. Everything else works as usual.'));
    return;
  }

  if (!store.crew()) {
    root.append(startOrJoin(root));
    return;
  }

  root.append(board(root));
}

/* Before there is a crew ---------------------------------------------------- */

function startOrJoin(root: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');

  wrap.append(note(
    'A crew is a link you send to friends. Opening it gives them this app with their own empty log, and puts them on the board with you.',
  ));
  wrap.append(privacyNote());

  const form = document.createElement('form');
  form.className = 'add-exercise';

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'search';
  name.placeholder = 'Your name on the board';
  name.autocapitalize = 'words';
  name.setAttribute('aria-label', 'Your name on the board');

  const create = document.createElement('button');
  create.type = 'submit';
  create.className = 'btn btn-primary';
  create.textContent = 'Start a crew';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = name.value.trim();
    if (!chosen) {
      toast('Pick a name first — it is what your friends will see.');
      return;
    }
    create.disabled = true;
    create.textContent = 'Starting…';
    void createCrew(chosen)
      .then(() => renderCrew(root))
      .catch((error: Error) => {
        create.disabled = false;
        create.textContent = 'Start a crew';
        toast(`Could not start a crew: ${error.message}`);
      });
  });

  form.append(name, create);
  wrap.append(form);
  wrap.append(note('Already have a link from a friend? Open it and you will land here, in their crew.'));
  return wrap;
}

function privacyNote(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'banner banner-nudge';

  const text = document.createElement('span');
  text.textContent = 'Joining sends a summary of your training to a server: your name, how often you trained, '
    + 'and each lift with its best set. Your pages, notes and sessions never leave this phone. '
    + 'Anyone holding the link can see the board.';
  box.append(text);
  return box;
}

/* Once there is one --------------------------------------------------------- */

function board(root: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  const crew = store.crew()!;
  const at = location.hash;

  wrap.append(shareRow());
  if (store.crewPaused()) wrap.append(pausedBanner(root));

  const list = document.createElement('ul');
  list.className = 'board-list';

  const footer = document.createElement('div');
  footer.className = 'board-footer';

  const when = document.createElement('p');
  when.className = 'note';

  // The one screen whose data comes from somewhere else, so the one screen
  // that needs a way to ask again.
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'btn btn-ghost';
  refresh.textContent = 'Refresh';
  refresh.addEventListener('click', () => {
    const here = location.hash;
    refresh.disabled = true;
    refresh.textContent = 'Refreshing\u2026';
    void fetchBoard().then((result) => {
      stillHere(here, () => {
        refresh.disabled = false;
        refresh.textContent = 'Refresh';
        if (result === 'ok') drawList();
        else toast('Could not reach the board.');
      });
    });
  });

  footer.append(when, refresh);

  /**
   * Redraw the rows, not the tab.
   *
   * Re-rendering the whole screen here would start another fetch, which
   * would redraw the screen, which would fetch again - the tab rebuilt
   * itself forever and nothing on it could be tapped.
   */
  const drawList = () => {
    const cached = store.board();
    list.replaceChildren();

    if (!cached) {
      list.append(note('Loading the board\u2026'));
      when.textContent = '';
      return;
    }

    for (const member of [...cached.members].sort((a, b) => b.updatedAt - a.updatedAt)) {
      list.append(memberRow(member, member.memberId === crew.memberId));
    }
    when.textContent = `As of ${new Date(cached.fetchedAt).toLocaleString()}`;
  };

  drawList();
  wrap.append(list, footer);

  const cached = store.board();
  // A copy from moments ago is good enough; this tab is not a live feed.
  if (!cached || Date.now() - cached.fetchedAt > 5000) {
    void fetchBoard().then((result) => {
      stillHere(at, () => {
        if (result === 'ok') drawList();
        else if (!cached) {
          list.replaceChildren(note('Could not reach the board. It will load when you are back online.'));
        }
      });
    });
  }

  wrap.append(settings(root));
  return wrap;
}

function memberRow(member: BoardMember, isMe: boolean): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'board-row';

  const days = Math.round((Date.now() - member.updatedAt) / 86400000);
  if (days >= STALE_DAYS) row.classList.add('board-quiet');

  const name = document.createElement('span');
  name.className = 'board-name';
  name.textContent = isMe ? `${member.name} (you)` : member.name;

  const when = document.createElement('span');
  when.className = 'board-when';
  when.textContent = days >= STALE_DAYS ? `quiet for ${days} days` : `updated ${relative(member.updatedAt)}`;

  const stats = document.createElement('span');
  stats.className = 'board-stats';
  const summary = member.summary;
  stats.textContent = summary
    ? `${summary.daysTrained7} day${summary.daysTrained7 === 1 ? '' : 's'} this week`
      + ` · ${summary.daysTrained30} in 30`
      + (summary.goalsTracked7 > 0 ? ` · ${summary.goalsMet7}/${summary.goalsTracked7} goals` : '')
      + ` · ${thousands(summary.lifts.length)} lift${summary.lifts.length === 1 ? '' : 's'}`
    : 'nothing posted yet';

  row.append(name, when, stats);
  return row;
}

function shareRow(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'share-box';

  const title = document.createElement('h2');
  title.textContent = 'Invite a friend';
  box.append(title);

  const link = document.createElement('p');
  link.className = 'share-link';
  link.textContent = joinLink();
  box.append(link);

  const actions = document.createElement('div');
  actions.className = 'backup-actions';

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'btn btn-primary';
  share.textContent = 'Send the link';
  share.addEventListener('click', () => {
    const url = joinLink();
    if (navigator.share) {
      void navigator.share({ url, title: 'Join my gym crew' }).catch(() => {});
      return;
    }
    void navigator.clipboard?.writeText(url)
      .then(() => toast('Link copied.'))
      .catch(() => toast('Copy the link above.'));
  });

  actions.append(share);
  box.append(actions);
  return box;
}

function pausedBanner(root: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'banner banner-nudge';

  const text = document.createElement('span');
  text.textContent = 'Sharing is paused. Your row stays as it was until you turn it back on.';

  const resume = document.createElement('button');
  resume.type = 'button';
  resume.className = 'btn btn-ghost';
  resume.textContent = 'Resume sharing';
  resume.addEventListener('click', () => {
    const at = location.hash;
    store.setCrewPaused(false);
    void postSummary(true).then(() => stillHere(at, () => renderCrew(root)));
  });

  bar.append(text, resume);
  return bar;
}

function settings(root: HTMLElement): HTMLElement {
  const box = document.createElement('div');
  box.className = 'backup-box';

  const title = document.createElement('h2');
  title.textContent = 'What you are sharing';
  box.append(title);

  const summary = mySummary();
  const hidden = store.hiddenFromCrew().length;
  box.append(note(
    `${summary.lifts.length} lift${summary.lifts.length === 1 ? '' : 's'}, how often you trained, and this week's daily goals.`
    + (hidden ? ` ${hidden} lift${hidden === 1 ? '' : 's'} held back.` : '')
    + ' Hold a lift back from its own page, or from Key lifts on Home.',
  ));

  const actions = document.createElement('div');
  actions.className = 'backup-actions';

  if (!store.crewPaused()) {
    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'btn btn-ghost';
    pause.textContent = 'Pause sharing';
    pause.addEventListener('click', () => {
      store.setCrewPaused(true);
      renderCrew(root);
    });
    actions.append(pause);
  }

  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'btn btn-ghost btn-danger';
  leave.textContent = 'Leave crew';
  leave.addEventListener('click', () => {
    const at = location.hash;
    void leaveCrew().then(() => {
      toast('Left the crew. Your row has been removed.');
      stillHere(at, () => renderCrew(root));
    });
  });

  actions.append(leave);
  box.append(actions);
  return box;
}

/* Joining from a link -------------------------------------------------------- */

export function renderJoin(root: HTMLElement, crewId: string, secret: string): void {
  root.replaceChildren();

  const heading = document.createElement('h1');
  heading.className = 'exercise-name';
  heading.textContent = 'Join this crew';
  root.append(heading);

  root.append(note('You will get your own log, which stays on your phone, and a place on your friends’ board.'));
  root.append(privacyNote());

  const form = document.createElement('form');
  form.className = 'add-exercise';

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'search';
  name.placeholder = 'Your name on the board';
  name.autocapitalize = 'words';
  name.value = store.crew()?.name ?? '';
  name.setAttribute('aria-label', 'Your name on the board');

  const join = document.createElement('button');
  join.type = 'submit';
  join.className = 'btn btn-primary';
  join.textContent = 'Join';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = name.value.trim();
    if (!chosen) {
      toast('Pick a name first — it is what your friends will see.');
      return;
    }
    join.disabled = true;
    join.textContent = 'Joining…';
    void joinCrew(crewId, secret, chosen)
      .then(() => {
        location.hash = '#/friends';
      })
      .catch((error: Error) => {
        join.disabled = false;
        join.textContent = 'Join';
        toast(`Could not join: ${error.message}`);
      });
  });

  form.append(name, join);
  root.append(form);

  const skip = document.createElement('a');
  skip.className = 'btn btn-ghost';
  skip.href = '#/home';
  skip.textContent = 'Just use the app on its own';
  root.append(skip);
}

function relative(when: number): string {
  const days = Math.round((Date.now() - when) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return friendlyDate(new Date(when).toISOString().slice(0, 10));
}

function note(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'note';
  element.textContent = text;
  return element;
}
