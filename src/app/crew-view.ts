/**
 * The Friends tab: who else is training, and how their week is going.
 *
 * Deliberately a tab you visit rather than anything on the home screen. The
 * app's job is answering "did I beat last week?"; this answers a different
 * question, and it should not be able to shout over the first one.
 */

import { friendlyDate, thousands } from './format';
import {
  createCrew, fetchBoard, isConfigured, joinCrew, joinLink, leaveCrew, mySummary,
  peekBoard, postSummary, removeMember, rotateLink,
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
    'A crew is a link you send to friends. Opening it puts them on the board with you, '
    + 'under whatever account they sign in with.',
  ));
  wrap.append(privacyNote());

  const form = document.createElement('form');
  form.className = 'add-exercise';

  const name = nameField();

  const create = document.createElement('button');
  create.type = 'submit';
  create.className = 'btn btn-primary';
  create.textContent = 'Start a crew';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = name.value.trim();
    if (!chosen) {
      toast('A name for the board.');
      return;
    }

    const at = location.hash;
    create.disabled = true;
    create.textContent = 'Starting\u2026';
    void createCrew(chosen)
      .then(() => stillHere(at, () => renderCrew(root)))
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

/**
 * The name on the board.
 *
 * Not the handle you sign in with: people want to be "Alex" to their friends
 * whatever they had to type to get an account.
 */
function nameField(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'search';
  input.placeholder = 'Your name on the board';
  input.autocapitalize = 'words';
  input.value = store.crew()?.name ?? store.account()?.displayName ?? '';
  input.setAttribute('aria-label', 'Your name on the board');
  return input;
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
        show(result, false);
      });
    });
  });

  footer.append(when, refresh);

  /**
   * One place that decides what a fetch means.
   *
   * Asking again by hand and asking on the way in have to agree \u2014 a link
   * that no longer opens the crew has to say so either way, not only when
   * the tab happens to have refreshed itself.
   */
  const show = (result: Awaited<ReturnType<typeof fetchBoard>>, firstLoad: boolean) => {
    if (result === 'gone') {
      wrap.replaceChildren(linkChanged(root));
      return;
    }
    if (result === 'ok') {
      drawList();
      return;
    }
    if (firstLoad && !store.board()) {
      list.replaceChildren(note('Could not reach the board. It will load when you are back online.'));
      return;
    }
    toast('Could not reach the board.');
  };

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
      list.append(memberRow(member, member.memberId === store.account()?.id, root, drawList));
    }
    when.textContent = `As of ${new Date(cached.fetchedAt).toLocaleString()}`;
  };

  drawList();
  wrap.append(list, footer);

  const cached = store.board();
  // A copy from moments ago is good enough; this tab is not a live feed.
  if (!cached || Date.now() - cached.fetchedAt > 5000) {
    void fetchBoard().then((result) => stillHere(at, () => show(result, true)));
  }

  wrap.append(settings(root));
  return wrap;
}

/**
 * The crew is there, but this phone's link no longer opens it.
 *
 * Somebody was removed and the link rotated. Saying so beats a board that
 * silently stops updating.
 */
function linkChanged(root: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');

  const bar = document.createElement('div');
  bar.className = 'banner banner-warn';
  const text = document.createElement('span');
  text.textContent = 'This crew’s link has changed, so this one no longer opens it. '
    + 'Ask whoever started the crew for the new link — opening it puts you back on the board.';
  bar.append(text);

  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'btn btn-ghost';
  leave.textContent = 'Leave this crew';
  leave.addEventListener('click', () => {
    void leaveCrew().then(() => renderCrew(root));
  });

  wrap.append(bar, leave);
  return wrap;
}

function memberRow(member: BoardMember, isMe: boolean, root: HTMLElement, redraw: () => void): HTMLLIElement {
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

  // Only whoever started the crew sees this, and never against their own row.
  if (!isMe && store.isCrewAdmin()) row.append(removeControl(member, root, redraw));

  return row;
}

/**
 * Taking somebody off the board.
 *
 * Removing alone is theatre while they still hold the join link, so the
 * second step offers to rotate it. Rotating means everyone else needs the
 * new link, which is said plainly rather than discovered later.
 */
function removeControl(member: BoardMember, root: HTMLElement, redraw: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'board-admin';

  const idle = () => {
    wrap.replaceChildren();
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-ghost btn-danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', confirming);
    wrap.append(remove);
  };

  const confirming = () => {
    wrap.replaceChildren();

    const warning = document.createElement('p');
    warning.className = 'danger-note';
    warning.textContent = `Take ${member.name} off the board? They still hold the join link, `
      + 'so they can rejoin unless you also change it.';

    const removeOnly = document.createElement('button');
    removeOnly.type = 'button';
    removeOnly.className = 'btn btn-ghost';
    removeOnly.textContent = 'Just remove';
    removeOnly.addEventListener('click', () => void run(false));

    const andRotate = document.createElement('button');
    andRotate.type = 'button';
    andRotate.className = 'btn btn-danger-on';
    andRotate.textContent = 'Remove and change the link';
    andRotate.addEventListener('click', () => void run(true));

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', idle);

    const buttons = document.createElement('div');
    buttons.className = 'backup-actions';
    buttons.append(andRotate, removeOnly, cancel);

    wrap.append(warning, buttons);
  };

  const run = async (rotate: boolean) => {
    const at = location.hash;
    try {
      await removeMember(member.memberId);
      if (rotate) await rotateLink();
    } catch (error) {
      toast(`Could not remove ${member.name}: ${(error as Error).message}`);
      return;
    }

    await fetchBoard();
    stillHere(at, () => {
      if (rotate) {
        toast('Link changed. Everyone still in the crew needs the new one.');
        renderCrew(root);
      } else {
        toast(`${member.name} removed. They can rejoin with the link they have.`);
        redraw();
      }
    });
  };

  idle();
  return wrap;
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

/**
 * Opening a join link.
 *
 * The link is sent around, re-sent and re-opened, so this screen's first job
 * is not signing anybody up. Who you are is your account; this only decides
 * which board you are on, and a phone already in the crew skips it entirely.
 */
export function renderJoin(root: HTMLElement, crewId: string, secret: string): void {
  const mine = store.crew();

  if (mine && mine.id === crewId) {
    // Opening the current link also repairs a phone left holding the old one
    // after a rotation, which otherwise just watched the board go stale.
    if (mine.secret !== secret) store.updateCrew({ secret });
    // And re-posts, because this account may have been removed from the
    // board while still holding the crew. Being handed the new link is
    // permission to be back on it.
    void postSummary(true).catch(() => {});
    location.hash = '#/friends';
    return;
  }

  root.replaceChildren();

  const heading = document.createElement('h1');
  heading.className = 'exercise-name';
  heading.textContent = 'This crew';
  root.append(heading);

  const wrap = document.createElement('div');
  wrap.append(note('Checking that link\u2026'));
  root.append(wrap);

  const at = location.hash;
  void peekBoard(crewId, secret).then((result) => stillHere(at, () => {
    if (result === 'gone') {
      heading.textContent = 'That link has expired';
      wrap.replaceChildren(deadLink());
      return;
    }

    heading.textContent = 'Join this crew';
    const parts: Node[] = [];

    const switching = store.crew();
    if (switching) {
      const bar = document.createElement('div');
      bar.className = 'banner banner-warn';
      const text = document.createElement('span');
      text.textContent = `You are already on a board as ${switching.name}. `
        + 'Joining this one leaves that board and comes over to this one.';
      bar.append(text);
      parts.push(bar);
    }

    if (result === 'failed') {
      parts.push(note('Could not reach that board, so there is nobody to show yet. It will still let you join.'));
    } else if (result.length > 0) {
      parts.push(note('Already on this board:'));
      const list = document.createElement('ul');
      list.className = 'board-list';
      for (const member of [...result].sort((a, b) => a.name.localeCompare(b.name))) {
        const row = document.createElement('li');
        row.className = 'board-row';
        const name = document.createElement('span');
        name.className = 'board-name';
        name.textContent = member.name;
        const when = document.createElement('span');
        when.className = 'board-when';
        when.textContent = `updated ${relative(member.updatedAt)}`;
        row.append(name, when);
        list.append(row);
      }
      parts.push(list);
    }

    parts.push(privacyNote());
    parts.push(joinForm(crewId, secret));
    wrap.replaceChildren(...parts);
  }));
}

/** The link opens nothing: the crew is gone, or its link has been changed. */
function deadLink(): HTMLElement {
  const wrap = document.createElement('div');

  const bar = document.createElement('div');
  bar.className = 'banner banner-warn';
  const text = document.createElement('span');
  text.textContent = 'This link no longer opens that crew. Either it was changed after somebody was removed, '
    + 'or the crew is gone. Ask whoever started it for the current link.';
  bar.append(text);

  const home = document.createElement('a');
  home.className = 'btn btn-ghost';
  home.href = '#/home';
  home.textContent = 'Just use the app on its own';

  wrap.append(bar, home);
  return wrap;
}

function joinForm(crewId: string, secret: string): HTMLElement {
  const wrap = document.createElement('div');

  const form = document.createElement('form');
  form.className = 'add-exercise';

  const name = nameField();

  const join = document.createElement('button');
  join.type = 'submit';
  join.className = 'btn btn-primary';
  join.textContent = 'Join';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = name.value.trim();
    if (!chosen) {
      toast('A name for the board.');
      return;
    }

    join.disabled = true;
    join.textContent = 'Joining\u2026';
    void joinCrew(crewId, secret, chosen)
      .then(() => {
        location.hash = '#/friends';
      })
      .catch((error: Error) => {
        join.disabled = false;
        join.textContent = 'Join';
        // The likeliest failure by far, and the one worth explaining.
        toast(error.message.includes('name is taken')
          ? `Somebody on that board is already called ${chosen}. Pick another name.`
          : `Could not join: ${error.message}`);
      });
  });

  form.append(name, join);
  wrap.append(form);

  const skip = document.createElement('a');
  skip.className = 'btn btn-ghost';
  skip.href = '#/home';
  skip.textContent = 'Just use the app on its own';
  wrap.append(skip);

  return wrap;
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
