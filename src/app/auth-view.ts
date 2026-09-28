/**
 * The front door.
 *
 * Nothing in this app opens without an account, so this is the first screen
 * a new phone ever shows. It is deliberately three fields and a button: the
 * interesting part happens once, at sign-up, when the recovery code appears
 * and has to be written down.
 */

import { foldCode, logIn, recover, remember, signUp, type Identity } from './auth';
import { isConfigured } from './crew';
import { toast } from './panels';
import * as store from './store';

/**
 * The shortest password this will take.
 *
 * Short enough that it is the rate limit doing the protecting rather than
 * the password: ten wrong guesses put a handle to sleep for fifteen minutes,
 * which makes guessing over the network hopeless. It would not survive
 * somebody getting the database itself, key stretching or not, which is the
 * deliberate trade for an app a few friends share.
 */
const MIN_PASSWORD = 4;

/** Where a join link waits while somebody makes an account to open it with. */
const PENDING = 'gym-notebook:pending-invite';

export function rememberInvite(hash: string): void {
  try {
    localStorage.setItem(PENDING, hash);
  } catch {
    // Storage refused. The link still works, it just will not survive a
    // reload, which is the lesser of the two failures here.
  }
}

/** The link somebody arrived on, cleared as it is handed back. */
export function takeInvite(): string {
  try {
    const waiting = localStorage.getItem(PENDING);
    localStorage.removeItem(PENDING);
    return waiting ?? '';
  } catch {
    return '';
  }
}

export function renderAuth(root: HTMLElement): void {
  root.replaceChildren();

  const heading = document.createElement('h1');
  heading.className = 'exercise-name';
  heading.textContent = 'Gym Notebook';
  root.append(heading);

  if (!isConfigured()) {
    root.append(note('Accounts are not set up on this copy of the app, so there is nothing to sign in to yet.'));
    return;
  }

  const wrap = document.createElement('div');
  root.append(wrap);

  const invited = Boolean(peekInvite());

  const showSignUp = () => {
    heading.textContent = 'Create an account';
    wrap.replaceChildren(
      note(invited
        ? 'A friend has invited you to their board. Make an account and you will land straight in it.'
        : 'One account, and your log and your boards are behind it.'),
      form('Create account', ['handle', 'password', 'confirm'], async (values) => {
        if (values.password !== values.confirm) throw new Error('those two passwords are not the same');
        if (values.password.length < MIN_PASSWORD) {
          throw new Error(`a password of at least ${MIN_PASSWORD} characters`);
        }
        const made = await signUp(values.handle, values.password);
        showRecoveryCode(root, made.code, made.identity);
      }),
      link('I already have an account', showLogIn),
    );
  };

  const showLogIn = () => {
    heading.textContent = 'Sign in';
    wrap.replaceChildren(
      note(invited ? 'Sign in and you will land straight in your friend’s board.' : ''),
      form('Sign in', ['handle', 'password'], async (values) => {
        await logIn(values.handle, values.password);
        done();
      }),
      link('Create an account', showSignUp),
      link('I have lost my password', showRecover),
    );
  };

  const showRecover = () => {
    heading.textContent = 'Use your recovery code';
    wrap.replaceChildren(
      note('The code you were shown when you made the account. It is the only way back in, '
        + 'and using it signs out every device that was already signed in.'),
      form('Set a new password', ['handle', 'code', 'password', 'confirm'], async (values) => {
        if (values.password !== values.confirm) throw new Error('those two passwords are not the same');
        if (values.password.length < MIN_PASSWORD) {
          throw new Error(`a password of at least ${MIN_PASSWORD} characters`);
        }
        if (foldCode(values.code).length < 10) throw new Error('that does not look like a recovery code');
        const next = await recover(values.handle, values.code, values.password);
        showRecoveryCode(root, next.code, next.identity);
      }),
      link('Back to signing in', showLogIn),
    );
  };

  // Somebody arriving on a link has no account yet far more often than not.
  if (invited || !store.account()) showSignUp();
  else showLogIn();
}

/**
 * The code, once.
 *
 * It is derived into a key before it is sent, so the server cannot read it
 * back to anybody — which is exactly why this screen will not let itself be
 * skipped with a tap in the wrong place. Nothing is signed in until the tick
 * at the bottom: being signed in redraws the app over the top of this, and
 * this is the only time the code exists anywhere.
 */
function showRecoveryCode(root: HTMLElement, code: string, identity: Identity): void {
  root.replaceChildren();

  const heading = document.createElement('h1');
  heading.className = 'exercise-name';
  heading.textContent = 'Write this down';
  root.append(heading);

  root.append(note('This is the only way back into your account if you forget your password. '
    + 'Nobody can look it up for you, not even whoever runs the server. Put it somewhere that is not this phone.'));

  const shown = document.createElement('p');
  shown.className = 'recovery-code';
  shown.textContent = code;
  root.append(shown);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn btn-ghost';
  copy.textContent = 'Copy it';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(code)
      .then(() => toast('Copied. Paste it somewhere safe.'))
      .catch(() => toast('Could not copy it. Write it down instead.'));
  });
  root.append(copy);

  const confirm = document.createElement('label');
  confirm.className = 'confirm-saved';
  const box = document.createElement('input');
  box.type = 'checkbox';
  const said = document.createElement('span');
  said.textContent = 'I have saved this code somewhere else';
  confirm.append(box, said);
  root.append(confirm);

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn btn-primary';
  go.textContent = 'Continue';
  go.disabled = true;
  box.addEventListener('change', () => {
    go.disabled = !box.checked;
  });
  go.addEventListener('click', () => {
    // Only now. Storing the session makes the app consider itself signed in,
    // which redraws the screen this code is written on.
    remember(identity);
    done();
  });
  root.append(go);
}

/** Into the app, or into the crew whose link brought them here. */
function done(): void {
  const waiting = takeInvite();
  location.hash = waiting || '#/home';
  // The hash may already be what it is being set to, which fires no event.
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function peekInvite(): string {
  try {
    return localStorage.getItem(PENDING) ?? '';
  } catch {
    return '';
  }
}

type Field = 'handle' | 'password' | 'confirm' | 'code';

const LABELS: Record<Field, { label: string; type: string; hint: string }> = {
  handle: { label: 'Handle', type: 'text', hint: 'Letters, numbers, dots and dashes' },
  password: { label: 'Password', type: 'password', hint: `At least ${MIN_PASSWORD} characters` },
  confirm: { label: 'Password again', type: 'password', hint: '' },
  code: { label: 'Recovery code', type: 'text', hint: '' },
};

function form(
  action: string,
  fields: Field[],
  submit: (values: Record<Field, string>) => Promise<void>,
): HTMLFormElement {
  const element = document.createElement('form');
  element.className = 'auth-form';

  const inputs = new Map<Field, HTMLInputElement>();
  for (const field of fields) {
    const { label, type, hint } = LABELS[field];

    const input = document.createElement('input');
    input.type = type;
    input.className = 'search';
    input.placeholder = label;
    input.autocapitalize = 'none';
    input.setAttribute('autocorrect', 'off');
    input.spellcheck = false;
    input.autocomplete = field === 'handle' ? 'username'
      : field === 'password' ? (fields.includes('confirm') ? 'new-password' : 'current-password')
        : field === 'confirm' ? 'new-password' : 'one-time-code';
    input.setAttribute('aria-label', label);
    inputs.set(field, input);
    element.append(input);
    if (hint && fields.includes('confirm')) element.append(note(hint));
  }

  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'btn btn-primary';
  button.textContent = action;
  element.append(button);

  element.addEventListener('submit', (event) => {
    event.preventDefault();

    const values = {} as Record<Field, string>;
    for (const [field, input] of inputs) values[field] = input.value.trim();
    if (fields.some((field) => !values[field])) {
      toast('Every box, please.');
      return;
    }

    button.disabled = true;
    button.textContent = 'Working…';
    void submit(values)
      .catch((error: Error) => {
        button.disabled = false;
        button.textContent = action;
        toast(error.message);
      })
      .finally(() => {
        button.disabled = false;
        button.textContent = action;
      });
  });

  return element;
}

function link(text: string, go: () => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-ghost';
  button.textContent = text;
  button.addEventListener('click', go);
  return button;
}

function note(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'note';
  element.textContent = text;
  return element;
}
