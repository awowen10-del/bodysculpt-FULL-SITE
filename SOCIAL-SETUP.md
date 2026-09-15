# Connecting Instagram

**Time: about fifteen minutes, once.** You already have most of the pieces because you run
Facebook ads.

Two things go into Netlify at the end: a **token** and an **account ID**. The token is a
genuine secret — it stays on the server and never reaches your browser. Do not paste it
into a chat, an email, or anywhere else.

---

## First, what can and cannot be known about a competitor

The dashboard shows **your** reach, views, saves and shares because you own the account.

For **competitors**, Instagram's API gives outsiders likes, comments and follower count —
that is the whole list. Reach, saves and shares are private to whoever owns the account,
and no tool can get them.

**Views are the exception.** Instagram prints a reel's play count on the reel itself, for
anyone to see, so a service that reads the public page the way a browser does can collect
it. Part 5 below connects one (Apify). With it, competitors' reels show views, and the flame
is judged on views. Without it, everything below still works on likes and comments.

| | Your posts | A competitor's posts |
|---|---|---|
| Engagement rate | interactions ÷ **reach** — of the people who saw it, how many did something | (likes + comments) ÷ **followers** — the public stand-in |
| Views | shown | shown on reels, once Part 5 is done; a dash before that |
| Reach, saves, shares | shown | a dash, always |

**What does compare properly** is a post against *its own account's* normal. That is what the
🔥 flame means: this post did at least twice what that account usually does — on views where
there are views, on engagement otherwise. It means the same thing on both sides of the
toggle, which is why it is the number to trust when you are sizing yourself up against
someone.

---

## Before you start

Your Instagram must be a **Business or Creator** account, connected to your Facebook Page.
Check on your phone: **Instagram → Settings → Account type and tools**. If it says
"Personal", switch it to Business. It is free and changes nothing about how the account
looks.

---

## Part 1 — a Meta app (4 minutes)

1. Go to **developers.facebook.com/apps** and sign in with the Facebook account that
   manages the Bodysculpt page.
2. **Create App**.
3. For "What do you want your app to do?", choose **Other**, then **Next**.
4. App type: **Business**. Next.
5. Name it `Bodysculpt Dashboard`, pick your Business portfolio if it asks, and create it.
6. On the app's dashboard, find **Instagram Graph API** (or "Instagram") in the product list
   and click **Set up**.

## Part 2 — a token that does not expire (6 minutes)

You can make a 60-day token in two clicks, but then you have to redo this six times a year.
The version below never expires. It is worth the extra five minutes.

7. Go to **business.facebook.com/settings** and pick your business.
8. Left menu: **Users → System users**. Click **Add**.
   - Name: `Dashboard reader`
   - Role: **Employee**
   - Create.
9. With that system user selected, click **Assign assets**.
   - Choose **Apps**, tick `Bodysculpt Dashboard`, give it **Full control**. Save.
   - **Assign assets** again → **Pages**, tick your Bodysculpt page, give it **Full
     control**. Save.
10. Click **Generate new token**.
    - App: `Bodysculpt Dashboard`
    - Token expiration: **Never**
    - Tick these permissions and no others:
      - `instagram_basic`
      - `instagram_manage_insights`
      - `pages_show_list`
      - `pages_read_engagement`
    - Generate.
11. **Copy the token now.** Facebook shows it once and never again. If you lose it, come
    back and generate another — no harm done.

## Part 3 — your Instagram account ID (3 minutes)

12. Go to **developers.facebook.com/tools/explorer**.
13. Top right: pick your app, and paste your token into the **Access Token** box.
14. In the request bar, put this and press Submit:
    ```
    me/accounts?fields=instagram_business_account,name
    ```
15. In the answer you will see your page, and inside it
    `"instagram_business_account": { "id": "17841400000000000" }`.
    **That long number is your account ID.** Copy it.

## Part 4 — tell the dashboard (2 minutes)

16. **app.netlify.com** → your site → **Site configuration → Environment variables**.
17. Add two:
    - `IG_ACCESS_TOKEN` — the token from step 11
    - `IG_USER_ID` — the number from step 15
18. **Deploys → Trigger deploy → Deploy site.** Wait for green.
19. Open **Social → Instagram** and press **Refresh**.

Your last 25 posts appear with their numbers.

## Part 5 — competitors' views (5 minutes, optional, small cost)

This is the content-dashboard template's setup: a nightly read of each watched account's
public page through **Apify**, a scraping service.

20. **apify.com** → sign up (a free plan with $5 of monthly credit is enough to start).
21. **Settings → Integrations** (or *API & Integrations*) → copy your **Personal API token**.
22. Netlify → Environment variables → add `APIFY_API_TOKEN`. `SYNC_TRIGGER_SECRET` must also
    be set (it is, if the Facebook Ads move is done) — it is what lets the nightly run start.
23. Redeploy. On **Content → Competitors**, pick an account and press **Refresh**: the page
    says "Reading their page for views — about half a minute" and then the reels show views.
    From then on every watched account is read once a night at 5am.

**What it costs.** Apify's Instagram scraper is priced per post read — roughly $2.30 per
1,000. Ten competitors × 15 posts × every night is about 4,500 posts a month, around £8, or
free inside the monthly credit if you watch fewer accounts. An account is never read twice
inside an hour, however often Refresh is pressed.

**What it can and cannot do.** It reads what a logged-out visitor sees: the play count on
reels, likes, comments. Photos have no play count. Reach, saves and shares stay private.

---

## Adding competitors

On the **Competitors** tab, type a username in the box and press **Watch**. Up to ten.

- Just the name — `puregym`, not the full link — though pasting the link works too.
- They must be **Business or Creator accounts and public**. Any gym marketing itself will
  be. A personal or private account returns nothing, to anybody.
- Click a name to look at them. Click the ✕ on the chip to stop watching.

Good ones to start with: the two or three gyms people actually mention when they cancel,
plus one account whose content you admire that is nothing to do with gyms.

---

## Reading the page

- **The big number on each picture** is the engagement rate. On your posts that is out of
  the people who saw it; on theirs it is out of their followers.
- **The flame** is a post that did 2× that account's normal. Those are the ones to study.
- **Sort** by newest, best engagement, or most reach.
- **"Only the ones that took off"** hides everything except the flames — the fastest way to
  see what is working for someone.
- **Saves and shares are the ones to watch on your own posts.** A like is a reflex. A save
  means somebody intends to come back, and a share means they put their own name to it.

---

## If something goes wrong

| What you see | What it means |
|---|---|
| "Instagram is not connected yet" | The two variables are not set, or the site has not been redeployed since. Redeploy. |
| "The access token has expired or been revoked" | Make a new one — Part 2. If you used a 60-day token rather than a system user, this is why. |
| "That account has to be a Business or Creator account, and public" | It is a personal or private account. Nothing can be done — not by this dashboard or anything else. |
| A grey tile instead of a picture | Instagram's image links go stale after a while. Press Refresh. |
| Numbers look a few minutes old | They are cached for half an hour to stay inside Instagram's rate limit. Refresh forces a fresh read. |
| "reach —" on your own post | Very old posts, and some carousels, do not report every metric. The others are still right. |
| A competitor's reels show "views —" | Part 5 is not done, or their page has not been read yet — press Refresh and give it half a minute. |

---

## Where things live

| Thing | File |
|---|---|
| The page | `social.html` |
| The Instagram read | `netlify/functions/instagram-feed.js` |
| The competitor views scrape | `netlify/functions/ig-scrape-background.js` (+ `ig-scrape-scheduled.js`, nightly) |
| The competitor list | `netlify/functions/kpi-store.js` (`ig-competitors`) |
| The tests | `tests/v136-calendar-and-social.test.cjs` |
