/**
 * Accounts: the front door.
 *
 * The password never leaves this device. The phone fetches the account's
 * salt, stretches the password against it here, and sends the derived key;
 * the server stores only a hash of that. Stretching is deliberately slow,
 * and a phone has time to spare where a worker billed by the millisecond
 * does not — so the expensive half happens where it is free.
 *
 * Being signed in is a token in this device's storage. Nothing here is
 * checked again on the way into the app, which is what lets it open in a
 * basement with no signal.
 */

import { apiBase, ApiError, isConfigured } from './crew';
import * as store from './store';

/**
 * How hard the password is to work through.
 *
 * High enough to cost a guesser real time, low enough that an old phone
 * still signs in without appearing to hang. It is baked into every stored
 * key, so changing it later means everyone recovers or re-signs-up.
 */
const ITERATIONS = 250_000;

/**
 * The alphabet a recovery code is written in.
 *
 * No 0/O, no 1/I/L: this gets copied onto paper and typed back months
 * later, and a code nobody can transcribe is not a recovery route.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export interface Identity {
  accountId: string;
  token: string;
  handle: string;
  displayName: string;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(length = 16): string {
  return hex(crypto.getRandomValues(new Uint8Array(length)));
}

/** A code in groups of four, which is how people read one back. */
export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const letters = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  return (letters.join('').match(/.{1,5}/g) ?? []).join('-');
}

/** Typed-back codes arrive with stray spaces, lower case and missing dashes. */
export function foldCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Stretch a secret against a salt.
 *
 * The result is what the server sees, so it stands in for the password
 * everywhere below — which also means a stolen database holds nothing that
 * can be typed into this screen.
 */
export async function deriveKey(secret: string, salt: string): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  );
  return hex(new Uint8Array(bits));
}

async function send(path: string, body: unknown, token?: string): Promise<unknown> {
  if (!isConfigured()) throw new Error('accounts are not set up on this copy of the app');

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-account-token'] = token;

  const response = await fetch(`${apiBase()}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const failed = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError((failed as { error?: string }).error ?? `request failed (${response.status})`, response.status);
  }
  return response.json();
}

async function saltFor(handle: string): Promise<string> {
  const body = await send('/account/salt', { handle }) as { salt: string };
  return body.salt;
}

/**
 * Hold on to a session.
 *
 * Sign-up and recovery deliberately do not call this: storing the session is
 * what makes the app consider itself signed in, which redraws the screen -
 * and doing that while the recovery code is on show would wipe the only copy
 * of it before it could be written down.
 */
export function remember(identity: Identity): void {
  store.setAccount({
    id: identity.accountId,
    handle: identity.handle,
    displayName: identity.displayName,
    token: identity.token,
  });
}

/**
 * Make an account, and hand back the recovery code exactly once.
 *
 * The code is generated here and never sent in a form the server can read,
 * so nobody — including whoever runs the server — can recover an account on
 * somebody's behalf. That is the trade for having no email address.
 */
export async function signUp(handle: string, password: string): Promise<{ code: string; identity: Identity }> {
  const salt = randomHex();
  const code = newRecoveryCode();

  const identity = await send('/account', {
    handle,
    displayName: handle,
    salt,
    key: await deriveKey(password, salt),
    recovery: await deriveKey(foldCode(code), salt),
  }) as Identity;

  return { code, identity };
}

export async function logIn(handle: string, password: string): Promise<void> {
  const salt = await saltFor(handle);
  const identity = await send('/session', { handle, key: await deriveKey(password, salt) }) as Identity;
  remember(identity);
}

/** Back in with the code from sign-up, which also replaces it. */
export async function recover(
  handle: string, code: string, password: string,
): Promise<{ code: string; identity: Identity }> {
  const oldSalt = await saltFor(handle);
  const salt = randomHex();
  const nextCode = newRecoveryCode();

  const identity = await send('/account/recover', {
    handle,
    recovery: await deriveKey(foldCode(code), oldSalt),
    salt,
    key: await deriveKey(password, salt),
    nextRecovery: await deriveKey(foldCode(nextCode), salt),
  }) as Identity;

  return { code: nextCode, identity };
}

export async function logOut(): Promise<void> {
  const account = store.account();
  if (account && isConfigured()) {
    // Best effort: the device is signed out either way, and a token left
    // behind on the server expires with nothing attached to it.
    try {
      await fetch(`${apiBase()}/session`, {
        method: 'DELETE',
        headers: { 'x-account-token': account.token },
      });
    } catch {
      // Offline. Forgetting it here is the part that matters.
    }
  }
  store.clearAccount();
}

export function signedIn(): boolean {
  return store.account() !== null;
}

/** The headers that say who this device is signed in as. */
export function accountHeaders(): Record<string, string> {
  const account = store.account();
  return account ? { 'x-account-token': account.token } : {};
}
