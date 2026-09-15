# Facebook Ads — moving it into the dashboard

**Time: about ten minutes, once.** Nothing to build, nothing to install: this is copying
the settings the old ads site already has into this site, then switching the old one off.

The Facebook Ads page (`/ads.html`, "Facebook Ads" under Social in the rail) is the
`bodysculpt-ad-intelligence` tool rebuilt inside this dashboard. The scoring, the nightly
sync from Meta and the Daily Ad Check all came across unchanged and now run as this site's
own functions. What did NOT come across is the login — the dashboard has none, so this page
has none either.

---

## Part 1 — copy the settings (5 minutes)

In **app.netlify.com**, open the OLD ads site → **Site configuration → Environment
variables**. Then open THIS site's environment variables and add each of these with the
same value:

| Key | What it is |
|---|---|
| `DATABASE_URL` | The ads database (read-only role). The page reads everything through this. |
| `SYNC_DATABASE_URL` | The write-capable role the nightly sync uses. If the old site has it. |
| `DAILY_CHECK_DATABASE_URL` | The role that may save a Daily Ad Check. If the old site has it. |
| `META_ACCESS_TOKEN` | Your Meta token — what the sync reads your ad account with. |
| `META_AD_ACCOUNT_ID` | Your ad account id. |
| `META_API_VERSION` | Only if the old site sets it. |
| `SYNC_TRIGGER_SECRET` | The password the "Sync now" button and the 4am trigger use to start a sync. |
| `SYNC_SCHEDULE_ENABLED` | `1` — without this the sync deliberately refuses to write. |

`ANTHROPIC_API_KEY` is **already on this site** (it powers the AI reviews) — the Daily Ad
Check uses the same one. Nothing to add.

Do **not** copy `SESSION_SECRET` or `DASHBOARD_PASSWORD`. They were the login, and the
login is gone.

> **Why the same database?** Because it is the same data. The old site and this one read
> the same tables; nothing was migrated or copied. That is what makes the switch-over safe:
> you can open both side by side and see the same numbers until you are happy.

## Part 2 — deploy and check (3 minutes)

1. **Deploys → Trigger deploy → Deploy site.** Wait for it to go green.
2. Open the dashboard → **Facebook Ads**. The line under the title should read
   "Data current to …" with a green dot, and your campaigns should appear.
3. Press **Generate today's check** (or Refresh). A briefing should appear within a
   minute or two.
4. Press **Sync now**. The line should say "Syncing…" and then update.

| What you see | What it means |
|---|---|
| "The ads service returned 500" and no campaigns | `DATABASE_URL` is missing on this site, or the site has not been redeployed since you set it. |
| "No successful sync has been recorded yet" | The database is reachable but `sync_runs` is empty — fine on a brand-new database, wrong if the old site was syncing. Check `DATABASE_URL` points at the same database. |
| Sync now says it couldn't start | `SYNC_TRIGGER_SECRET` is missing here. |
| Sync runs but nothing changes | `SYNC_SCHEDULE_ENABLED` is not `1` — the sync ran in its refuse-to-write mode. |
| Daily Ad Check never appears | `ANTHROPIC_API_KEY` or `DAILY_CHECK_DATABASE_URL`; the function log (Netlify → Functions → ads-daily-check-background) says which. |

## Part 3 — switch the old site off (2 minutes)

Once the page here shows what the old site shows:

1. On the OLD site, **Site configuration → Environment variables → delete
   `SYNC_SCHEDULE_ENABLED`** (or set it to `0`). This stops its 4am sync, so two syncs are
   not writing to the same database.
2. Then, when you are sure: **Site configuration → General → Delete this site.**

---

## What runs where, now

| Address | Function | Job |
|---|---|---|
| `/api/ads/…` | `ads-api` | reads campaigns, ads and creatives (with their verdicts) |
| `/api/ads/daily-check` | `ads-daily-check` | the latest Daily Ad Check |
| `/api/ads/daily-check/generate` | `ads-daily-check-background` | writes a new one (AI, up to 15 min) |
| `/api/ads/sync-status` | `ads-sync-status` | "Data current to …" |
| `/api/ads/sync-trigger` | `ads-sync-trigger` | the Sync now button |
| (cron, 04:00 UTC) | `ads-sync-scheduled` → `ads-sync-background` | the nightly Meta sync |

The server code lives in `netlify/ads/src` — the old repository's `src/` minus its React
front end and its login — and is type-checked by the test harness on every run.
