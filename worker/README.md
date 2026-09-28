# The API

A single Cloudflare Worker with one D1 database, behind the account screen
and the Friends tab.

An **account** is a handle and a password, with no email anywhere. A
**session** is a token a device holds after signing in. A **crew** is a
secret in a link: holding it lets you read a board and post to it, and your
account decides which row on it is yours.

Until this is deployed and its URL wired into the app, the app says accounts
are not set up and nothing behind the front door opens.

## The password never arrives here

The phone fetches the account's salt, runs PBKDF2 against it locally, and
sends the derived key; this stores only a SHA-256 of that key. Two reasons,
both load-bearing:

- The word somebody typed is never transmitted and never stored, so a stolen
  database holds nothing that can be typed into the sign-in screen.
- Stretching a password is deliberately slow, and a Worker is billed by CPU
  millisecond while a phone is not. The expensive half runs where it is free.

The same goes for the recovery code, which means **nobody can recover an
account on somebody's behalf** — not even whoever runs this. That is the
trade for asking no email address.

A handle nobody has still gets a salt, worked out from the handle and a
secret this server keeps in `settings`. It is stable, so a wrong handle looks
exactly like a wrong password. Ten wrong guesses puts a handle to sleep for
fifteen minutes.

## Who can do what

- **Anyone signed in** can start a crew, and is its owner.
- **Anyone with the link** can read a board, and, signed in, post to it.
- **The owner** can remove any row and change the link. It is their account
  that says so, so they can do it from any device they are signed in on.
- **One account is one row per board**, however many devices post from it.

Removing somebody does not stop them rejoining with the link they already
have. Changing the link is what makes it stick, and it means everyone else
needs re-inviting — so the app offers the two as a single choice rather than
pretending a removal is final.

## Deploying it

You need a free Cloudflare account. From this folder:

```sh
npx wrangler login
npx wrangler d1 create gym-log-crew      # paste the printed id into wrangler.toml
npx wrangler d1 execute gym-log-crew --remote --file=./schema.sql
npx wrangler deploy
```

The last command prints a URL like `https://gym-log-crew.<you>.workers.dev`.
Two ways to use it:

- **Try it first** — in the app, run this in the browser console, then reload:
  `localStorage.setItem('gym-notebook:crew-api', 'https://…workers.dev')`
- **Ship it** — set `DEFAULT_API` in `src/app/crew.ts` to that URL and push.
  Everyone who opens the app then gets it.

## Deploying it without a terminal

Everything below happens in the Cloudflare dashboard. Labels move around, so
the quickest way to any of these pages is **Quick search (Ctrl K)**.

1. **Make the database.** Ctrl K, type `D1`, open **D1 SQL Database** and
   create one called `gym-log-crew`.
2. **Give it its tables.** Open that database, go to its **Console** tab,
   paste the whole of [`schema.sql`](schema.sql), and run it.
3. **Make the worker.** Workers & Pages, **Create application**, then Worker.
   Name it `gym-log-crew` and deploy the starter it offers.
4. **Paste the code.** Open the worker, **Edit code**, select everything in
   the editor and replace it with [`paste-into-dashboard.js`](paste-into-dashboard.js).
   Deploy.
5. **Connect the two.** In the worker's **Settings → Bindings**, add a **D1
   database** binding. The variable name must be exactly `DB`, and it points
   at `gym-log-crew`. Deploy again.

The worker's URL is `https://gym-log-crew.<your subdomain>.workers.dev`, and
your subdomain is shown under **Account details** on the Workers & Pages page.

`paste-into-dashboard.js` is generated — run `node worker/build.mjs` after
changing anything in `src/`, or the dashboard copy will drift from the source.
`tests/bundle.test.ts` checks it has not.

## Upgrading a deployment made before accounts

There is no migration. The old data had no accounts in it, member rows were
keyed by a device token, and crews had an admin token rather than an owner —
none of which can be invented after the fact. Wipe it and start over.

In the D1 console, run these **one at a time**; the console stops at the
first error, and a table that was never there raises one:

```sql
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS crews;
```

Then paste the whole of [`schema.sql`](schema.sql) and run it. The
`CREATE TABLE IF NOT EXISTS` statements are safe to run over each other, so
this one **can** go in as a block.

Then replace the worker's code from
[`paste-into-dashboard.js`](paste-into-dashboard.js), or `npx wrangler deploy`.

Everyone signs up again, and the first person to start a crew owns it.

## What it stores

Per account: a handle, a display name, a public salt, a hash of the derived
key, a hash of the derived recovery code. No email, no password, no name.

Per member of a board: the account it belongs to, a chosen display name, and
the summary that phone posted — training frequency, this week's daily goals,
and each lift with its best set. No pages, no notes, no session detail; those
never leave the device.

## What it does not do

No email, no password reset, no support route back into an account. The
recovery code is the whole of it. The app says so at sign-up, on the screen
that shows the code, and will not move on until it has been acknowledged.
