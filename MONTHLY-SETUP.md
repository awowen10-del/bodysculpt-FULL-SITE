# Bodysculpt Monthly Report — deploy notes

## What this is now
A **fully manual** monthly report. You type every figure from your own sources (Stripe / Ontraport / Meta / your accounts), and the page calculates the rest. It no longer reads the weekly dashboard — the two tools are independent. This was deliberate: weekly Sun–Sat weeks don't line up with calendar months, so typing from calendar-month sources keeps every number exact and tied to a real document.

## What's in this bundle
- `monthly.html` — the monthly report page.
- `netlify/functions/kpi-store.js` — your existing store function. The monthly page uses only its `?monthly=1` GET and `month` POST branches; weekly paths are untouched and unused by this page.
- `netlify/functions/mentor-ai.js`, `netlify.toml`, `package.json` — unchanged.

## Deploy (same site as the weekly dashboard)
1. Copy `monthly.html` into your existing deploy folder (next to `index.html`).
2. Replace `netlify/functions/kpi-store.js` with this one (additive monthly branches; weekly logic unchanged).
3. Re-drag the folder onto Netlify (or commit & push).

Lives at `https://<your-site>.netlify.app/monthly.html`. The `ANTHROPIC_API_KEY` already on the site powers the AI Monthly Review.

## Load this year's data (one time)
The page can seed Jan–Jun 2026 from your spreadsheet figures so you're not typing six months by hand.

1. Deploy first.
2. Visit `https://<your-site>.netlify.app/monthly.html?seed=YES` once.
3. It writes Jan–Jun **only for months with no data yet** — it never overwrites anything you've already entered. You'll see a confirmation line.
4. Remove `?seed=YES` from the URL and reload. Done.

Re-running the seed is safe: existing months are skipped.

## How figures work
- **You type:** all revenue lines, ATP, New Members (sign-ups), Cancellations, Recurring Members, Paused Members, Ad Spend, Leads, Trial Sales, the 15 expense lines, Tax Paid, Profit, Owners Pay, Neil Payment Saved, Tax Saved.
- **Calculated for you (marked ∑):**
  - Net Gain = Sign-ups − Cancellations
  - Total Members = Recurring + Paused
  - Expense Total = sum of the 15 expense lines
  - Membership Conversion = Sign-ups ÷ Trial Sales
  - Lead to Sale = Trial Sales ÷ Leads
  - Cost Per Acquisition = Ad Spend ÷ Trial Sales
  - Retention % = 1 − Cancellations ÷ Recurring
  - Cancellation % = Cancellations ÷ Recurring
- Anything not entered shows "—". Ratios show "—" instead of breaking when a divisor is zero.

## Entering / editing a month
- **Home** or **Expenses** tab → "Edit this month's figures" opens one panel covering the whole month: Revenue, Members & growth, Acquisition, Expense lines (live-summed), Tax & owner.
- Pick the month from the dropdown top-right first, then edit.

## Tabs
- **Home** — at-a-glance dashboard (Revenue / Back End / Front End / Retention).
- **Expenses** — Expense Total, the 15 lines, owner figures.
- **Growth** — full calendar year, four paired blocks (tiles + chart): Revenue, Members, Lead to Sale %, Retention %.
- **Table** — rolling 12-month grid of everything.

## Linking
Add to the weekly dashboard header: `<a href="/monthly.html">Monthly Report</a>`
HQ launcher tile -> `https://<your-site>.netlify.app/monthly.html`
Edit the "back to HQ" link near the top of `monthly.html` (there's an `EDIT THIS` comment) to your real HQ URL.
