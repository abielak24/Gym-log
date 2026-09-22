/**
 * The Cloudflare entry point: wiring only.
 *
 * Deploy with `npx wrangler deploy` from this folder, after
 * `npx wrangler d1 create gym-log-crew` and pasting the id into wrangler.toml.
 */

import { handle } from './handler';
import { d1Store, type D1Database } from './store';

export interface Env {
  DB: D1Database;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, {
      store: d1Store(env.DB),
      now: () => Date.now(),
      randomId,
      hash: sha256,
    });
  },
};

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
