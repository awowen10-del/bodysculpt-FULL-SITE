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

Your scheduled triage already does the hard part: it reads the inbox, labels every thread
with one of four labels, **writes the reply and saves it as a draft**. So the card is not a
list of work — it is a list of decisions. Read it, and send it.

| Label | Tier on the dashboard |
|---|---|
| `Triage/Urgent` | Urgent — before anything else |
| `Triage/Today` | Today — before the day is out |
| `Triage/This week` | This week |
| `Triage/FYI` | FYI — folded away as a count |

The dashboard cannot read Gmail itself (it is a static page and has no business holding
your mail credentials). So the triage job sends it the list once it has finished labelling.

**Add this to the end of your existing scheduled triage job's instructions:**

> Once you have finished labelling, send the morning's list to the Daily Dashboard.
> Build a JSON object of this exact shape:
>
> ```json
> {
>   "dailyBrief": {
>     "date": "YYYY-MM-DD",
>     "summary": "One sentence on what the morning looks like.",
>     "items": [
>       {
>         "tier": "urgent",
>         "from": "Who it is from",
>         "subject": "The subject line",
>         "why": "One short line on why it matters",
>         "action": "Send the reply",
>         "threadId": "the Gmail thread id",
>         "receivedAt": "2026-09-10T06:40:00Z",
>         "draftId": "the id of the draft you saved, if you saved one",
>         "draftPreview": "The first line or two of the reply you wrote."
>       }
>     ]
>   }
> }
> ```
>
> `tier` must be exactly one of `urgent`, `today`, `week`, `fyi` — matching the
> `Triage/Urgent`, `Triage/Today`, `Triage/This week` and `Triage/FYI` labels you just
> applied. Anything else is dropped. `action` is two or three words: "Send the reply",
> "Pay this", "Ring them", "Read later". Include every labelled thread, FYI ones too.
>
> **Wherever you have drafted and saved a reply, send it across with the item.**
> `draftId` is the draft's message id — `draft.message.id` from the Gmail API, not the
> draft id itself — and `draftPreview` is the first line or two of what you wrote, plain
> text, no greeting needed. The dashboard shows the preview under the email and links
> straight to the composer, so a reply can be judged and sent without opening five tabs to
> find out what it says. Leave both out for anything you did not draft.
>
> Then POST it to:
>
> ```
> https://<your-netlify-site>/.netlify/functions/kpi-store
> ```
>
> with `Content-Type: application/json`. A 200 back means it landed.

If that job cannot make HTTP calls, the same thing works as a separate scheduled Claude
Code routine in this repo — one that reads the four labels and sends the same payload.

### What the store does with it

- One blob, `daily-briefs`, holding a map keyed by date — exactly like `daily-checkins`.
- One date is replaced whole on each push, so a partial send cannot half-erase a morning.
- The map is pruned to the newest **30 days**.
- Every field is whitelisted, every string capped, unknown tiers dropped, and the list
  truncated at **60 items**. The counts shown on the page — including how many replies are
  drafted — are recalculated from the rows that survived, so a heading can never disagree
  with what is under it.
- It touches nothing but its own key.

### If today's brief has not arrived

The page falls back to the most recent one it has and says whose morning it is showing.

---

## Where things live

| Thing | File |
|---|---|
| The page | `daily.html` |
| The Stripe read | `netlify/functions/stripe-feed.js` |
| The brief's store route | `netlify/functions/kpi-store.js` (`daily-briefs`) |
| The tests | `tests/v135-daily-dashboard.test.cjs` |
