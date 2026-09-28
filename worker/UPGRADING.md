# Moving a live worker onto accounts

Two jobs in the Cloudflare dashboard, in this order:

1. **Rebuild the database** (five minutes)
2. **Replace the worker's code** (five minutes)

Order matters. The new code writes tables that do not exist yet, so
deploying it first gives every request a 500.

**This wipes the boards.** There is no migration: the old rows had no
accounts in them, members were keyed by a device token, and crews had an
admin token rather than an owner. None of that can be invented after the
fact. Nobody's *log* is touched by any of this — logs live on phones and
this never held one — but every crew and every board row goes, and everyone
signs up again afterwards.

Where a label below does not match what you see, **Ctrl K** (⌘ K) opens a
search box that will get you to the page by name.

---

## Job 1 — rebuild the database

**1.1** Go to **https://dash.cloudflare.com/?to=/:account/workers/d1** and
click **gym-log-crew**. (The `:account` is not a typo — Cloudflare fills your
account in.)

**1.2** Open its **Console** tab.

**1.3** Drop the two old tables, **one at a time** — the console stops at the
first error, and a table that was never there raises one:

```sql
DROP TABLE IF EXISTS members;
```
```sql
DROP TABLE IF EXISTS crews;
```

**1.4** Now paste the whole of [`schema.sql`](schema.sql) and run it. This
one **can** go in as a block: every statement is `IF NOT EXISTS`, so it is
safe over itself.

Copy it from
**https://raw.githubusercontent.com/abielak24/Gym-log/main/worker/schema.sql**

**1.5 Check it took.** Still in the console:

```sql
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
```

You want seven: **accounts**, **attempts**, **crews**, **log**, **members**,
**sessions**, **settings**. **log** is where your workouts live once they
sync; the rest are accounts and boards.

---

## Job 2 — replace the worker's code

**2.1** Open
**https://raw.githubusercontent.com/abielak24/Gym-log/main/worker/paste-into-dashboard.js**,
select all, copy.

**2.2** Go to **https://dash.cloudflare.com/?to=/:account/workers-and-pages**
→ **gym-log-crew** → **Edit code** (older dashboards: **Quick edit**, or
under the **···** menu).

**2.3** Select all in the editor and paste over it. The old code must be gone
entirely.

**2.4** **Deploy**.

**2.5** Check **Settings → Bindings** still has a D1 binding named exactly
**DB** pointing at **gym-log-crew**. If it is missing, add it and deploy
again.

---

## Then check it, in the app

Open the app. It should show **Create an account** — that screen existing at
all is the proof the new code is live, since the old worker had nothing to
sign in to.

1. Make an account. Handle, password, password again.
2. You are shown a **recovery code**. Save it somewhere that is not the
   phone; it is the only way back in if you forget the password, and nobody
   can look it up for you. Tick the box and continue.
3. The app opens on your log, exactly as before.
4. Friends tab → **Start a crew** → copy the link.
5. Open the link in a private window. It should ask for an account first and
   say a friend invited you, then drop you straight into the crew once you
   have made one.
6. Join under a different board name. Two rows.
7. Back on your own screen, **Refresh**. There should be a **Remove** control
   next to their row, because you own the crew.

Then the part worth testing properly — the log following you:

8. On your phone, log a real set into a split, then go to Home and tap
   **Sync now** at the bottom. It should say *Synced*.
9. Open the app somewhere else (another browser, a laptop, a private window)
   and **sign in** with the same handle and password. Your splits and that
   set should arrive on their own within a few seconds, and the demo data
   should not be there.
10. Change something on that second device, wait a moment, then tap **Sync
    now** on the phone. The change should appear.

If **Create an account** fails, the worker cannot reach the database — that
is job 1 or the `DB` binding, not the code. If accounts work but nothing
syncs, the **log** table is missing: re-run `schema.sql`.
