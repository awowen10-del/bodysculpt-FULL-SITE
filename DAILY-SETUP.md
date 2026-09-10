# Daily Dashboard — switching the two feeds on

`daily.html` works the moment it deploys. With nothing set up it shows you the four Gmail
labels as links and tells you what to turn on. There are two things to turn on, and they
are independent — do either one first.

Everything below is a **read** as far as the dashboard is concerned. The page itself has no
write path at all: it cannot change a plan, a KPI week or a quarterly review even if it
wanted to.

---

## 1. Stripe — disputes and failed payments

The page never talks to Stripe. A Netlify function does, so the key stays on the server.

1. In Stripe: **Developers → API keys → Create restricted key**.
   Give it **read** access to these four and nothing else:
   - Charges
   - Disputes
   - Subscriptions
   - Customers

   A restricted read-only key cannot refund, cancel or charge anything. Use one.

2. In Netlify: **Site configuration → Environment variables → Add a variable**
   - Key: `STRIPE_SECRET_KEY`
   - Value: the key you just made (starts `rk_live_…`)

3. **Redeploy the site**, then press Refresh on the dashboard.

That is it. The card then shows three things, in the order they cost you money:

| Group | What it is | Why it is there |
|---|---|---|
| **Disputes** | A member has charged back and the bank has taken the money | There is a deadline. Miss it and the money is gone automatically. |
| **Stopped paying** | Memberships in `past_due` or `unpaid` | Recurring income leaking. Usually one message to fix. |
| **Failed payments** | Single failed charges, last 14 days | Nearly always an expired card. |

If the key is missing the card says so and tells you these steps. It never shows an error.

---

## 2. Email — the hierarchy of importance

**Nothing to add to your scheduled job.** It carries on exactly as it is.

Your triage runs on Anthropic's servers, so it works with the laptop shut. What it cannot
do is send anything to an outside web address — a routine can reach your mail and nothing
else. So the dashboard reads the result instead of waiting to be told about it.

That is the better half of the bargain anyway: there is nothing between the two to break,
nothing to go stale, and a morning the job did not run shows fewer labels rather than an
empty card.

| Label your job applies | Tier on the dashboard |
|---|---|
| `Triage/Urgent` | Urgent — before anything else |
| `Triage/Today` | Today — before the day is out |
| `Triage/This week` | This week |
| `Triage/FYI` | FYI — folded away as a count |

Wherever your job has saved a draft reply, the dashboard finds it in the thread, shows the
first lines of it, and links straight to Gmail's composer.

### Switching it on

It rides on the **same Google connection as the calendar** — one sign-in covers both.

1. In the Google Cloud console, with your `Bodysculpt Dashboard` project selected, search
   for **Gmail API** and click **Enable**. (Same as you did for the Calendar API.)
2. Open the Daily Dashboard and press **Connect Gmail** on the email card. Google will ask
   once more, because it is a new permission.
3. That is it.

If you already connected the calendar, you will be asked to sign in again the first time.
That is expected — the old permission covered the calendar only, so it is replaced with one
covering both.

### What it can and cannot do

The dashboard asks for **read-only** access to Gmail. It cannot send, reply, delete,
archive, label, or change one word of an email or a draft. Every button on the card opens
Gmail in a new tab to do anything at all.

You can see or withdraw it any time at **myaccount.google.com → Security → Your connections
to third-party apps**.

### If the card is empty

- **"Google is not connected yet"** — do the calendar setup in `CALENDAR-SETUP.md`; the
  same connection covers both.
- **"Your inbox has no Triage labels on it yet"** — the job has not run since the labels
  were set up, or it is using different label names. They must be exactly `Triage/Urgent`,
  `Triage/Today`, `Triage/This week` and `Triage/FYI`.
- **"Nothing is labelled for triage at the moment"** — the labels exist and nothing
  currently carries one. A genuinely clear inbox looks like this.

### The optional extra

If you ever move the triage somewhere that CAN make a web request, it can also push a brief
to `POST /.netlify/functions/kpi-store` with `{ "dailyBrief": { … } }`. The dashboard merges
it on top of what it reads live, matching on thread id — the only thing it adds is the
hand-written "why this matters" line under each email, which Gmail alone cannot supply.
Everything still works without it.

---

## Where things live

| Thing | File |
|---|---|
| The page | `daily.html` |
| The Stripe read | `netlify/functions/stripe-feed.js` |
| The brief's store route | `netlify/functions/kpi-store.js` (`daily-briefs`) |
| The tests | `tests/v135-daily-dashboard.test.cjs` |
