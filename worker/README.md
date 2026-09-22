# The crew API

A single Cloudflare Worker with one D1 database, behind the Friends tab.
Three routes, no accounts: a crew is a secret in a link, and a member is a
token generated on a phone.

Until this is deployed and its URL wired into the app, the Friends tab says
sharing is not set up and everything else works exactly as before.

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

## What it stores

Per member: a chosen display name, a hash of their token, and the summary
their phone posted — training frequency, this week's daily goals, and each
lift with its best set. No pages, no notes, no session detail; those never
leave the device.

## What it does not do

No passwords, no email, no recovery. Whoever holds the link is in the crew,
and the app says so plainly before anyone posts. Losing the phone loses the
member identity unless a JSON backup was taken, since the token lives in it.

Rules worth knowing, all covered by `tests/worker.test.ts`:

- a member id belongs to the first token that used it, and only that token
  can post as it again
- an unknown crew and a wrong secret give exactly the same answer, so the
  API cannot be used to find out which crews exist
- token hashes never appear in a response
- 30 members per crew, 64 kB per summary
