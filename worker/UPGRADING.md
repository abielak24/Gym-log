# Upgrading a live crew worker

Two jobs, both in the Cloudflare dashboard, in this order:

1. **Add three columns to the database** (five minutes)
2. **Replace the worker's code** (five minutes)

Order matters. The new code writes columns that do not exist yet, so
deploying it first gives every request a 500. The other way round is safe:
the old code simply ignores the new columns until you replace it.

Cloudflare renames things in this dashboard fairly often. Where a label
below does not match what you see, **Ctrl K** (⌘ K on a Mac) opens a search
box that will take you to the right page by name.

---

## Job 1 — add the three columns

### 1.1 Open the database

Go to **https://dash.cloudflare.com/?to=/:account/workers/d1**

That `:account` is not a typo — Cloudflare fills your account in. If it
lands you on an account picker, choose yours and you will arrive.

You should see a list with **gym-log-crew** in it. Click it.

### 1.2 Open the Console tab

Along the top of the database's page are tabs — **Metrics**, **Tables**,
**Console**, **Settings** or similar. Click **Console**.

You get a box to type SQL into and a **Execute** / **Run** button under it.

### 1.3 Run three statements, one at a time

This is the part that matters: **do not paste all three at once.** The
console stops at the first error, and two of these may already error
harmlessly, which would silently skip the ones after.

Paste this, run it:

```sql
ALTER TABLE crews ADD COLUMN admin_token_hash TEXT NOT NULL DEFAULT '';
```

Clear the box. Paste this, run it:

```sql
ALTER TABLE members ADD COLUMN passcode_hash TEXT NOT NULL DEFAULT '';
```

Clear the box. Paste this, run it:

```sql
ALTER TABLE members ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
```

**What the answers mean:**

| It says | It means |
| --- | --- |
| success, 0 rows | done |
| `duplicate column name: …` | that column already exists — fine, move on |
| `no such table: crews` | you are in the wrong database; go back to 1.1 |

Nothing here touches existing rows. Every crew and every member keeps its
name, its summary and its place on the board.

### 1.4 Check it worked

In the same console, run:

```sql
SELECT name FROM pragma_table_info('members');
```

You want **passcode_hash** and **name_key** in that list. Then:

```sql
SELECT name FROM pragma_table_info('crews');
```

You want **admin_token_hash**. If all three are there, job 1 is done.

---

## Job 2 — replace the worker's code

### 2.1 Copy the new code

Open **https://raw.githubusercontent.com/abielak24/Gym-log/main/worker/paste-into-dashboard.js**

That is the plain-text version — no line numbers, nothing to trip over.
Select all (**Ctrl A** / **⌘ A**) and copy (**Ctrl C** / **⌘ C**). It is
about 270 lines; make sure you have the whole thing, ending with a `}`.

### 2.2 Open the worker's editor

Go to **https://dash.cloudflare.com/?to=/:account/workers-and-pages**

Click **gym-log-crew** in the list. On the worker's page, find **Edit
code** — recently a button near the top right; on older dashboards it is
**Quick edit**, or lives under the **···** menu next to Deploy.

You land in a code editor with the current worker in it.

### 2.3 Paste over it

Click inside the editor, **select all**, **paste**. The old code must be
gone entirely — not pasted above or below it.

### 2.4 Deploy

Click **Deploy** (top right, sometimes **Save and deploy**). Wait for it to
confirm.

### 2.5 Check the binding survived

The worker needs its database attached. In the worker's **Settings →
Bindings** (older dashboards: **Settings → Variables**), there should be a
**D1 database binding** with:

- Variable name: **DB** — exactly that, capitals, no spaces
- Database: **gym-log-crew**

If it is there, leave it alone. If it is missing, add it and **Deploy**
again.

### 2.6 Check the new code is actually live

Open the app, then open your browser's console and run:

```js
fetch('https://gym-log-crew.abielak24.workers.dev/crew', { method: 'OPTIONS' })
  .then((r) => console.log(r.headers.get('access-control-allow-headers')));
```

It should print a list containing **x-member-passcode** and
**x-admin-token**. If those two are missing, the old code is still running —
the paste or the deploy did not take, so go back to 2.2.

---

## Then: start a fresh crew

**Your existing crew has no owner, and cannot be given one.** The admin
token is generated once, when a crew is created, and handed only to the
phone that created it — there is deliberately no copy anywhere else, which
is also why nobody can steal it. A crew made before this upgrade has an
empty one, so no phone can prove it owns that crew: no removing members, no
changing the link.

So in the Friends tab, **Leave crew**, then **Start a crew**, and send the
new link round. You lose nothing but the board itself — everyone's workouts
are on their own phones and are not touched by this.

## What to try once it is up

- Start a crew, send yourself the link, open it in a private window, join
  with a different name and a passcode. Two rows on the board.
- On your own phone, **Remove** that member. It should ask whether to change
  the link too, and say what that costs.
- Take the removal with the link change. The private window should say the
  link has changed, rather than quietly going stale.
- Open the new link in a third window, join with the **same name and
  passcode** as before. It should take over that row rather than making a
  second one — and the original device should carry on posting to it.
