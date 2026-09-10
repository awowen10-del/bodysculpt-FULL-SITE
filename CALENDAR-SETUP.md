# Connecting Google Calendar

**Time: about ten minutes, once.** After that it just works, on every device, forever.

You are going to tell Google "this dashboard is allowed to ask me for permission." That is
all this is. There is **no password and no secret** involved anywhere — the thing you copy
at the end is public by design, which is why it is safe to paste it into a settings box.

Do it on a laptop, not a phone.

---

## Before you start

Have your Netlify site address to hand. It is the one you type to reach the dashboard, for
example `https://bodysculpt-hq.netlify.app`. If you have a custom domain, use that one.

Write it down exactly — **no slash on the end**. Google is fussy about this and it is the
one step people get wrong.

---

## Part 1 — make the project (3 minutes)

1. Go to **console.cloud.google.com** and sign in as **ash@bodysculptwarrington.com**.
2. At the top of the page there is a project dropdown — it might say "Select a project".
   Click it, then **New Project**.
3. Name it `Bodysculpt Dashboard`. Leave everything else alone. Click **Create**.
4. Wait a few seconds, then make sure that project is the one selected in the dropdown at
   the top. Everything after this happens inside it.

## Part 2 — switch on the calendar (1 minute)

5. In the search bar at the top, type **Google Calendar API** and click the result.
6. Click the blue **Enable** button.

That is you telling Google which door you want to use. Nothing is connected yet.

## Part 3 — the consent screen (3 minutes)

This is the "Bodysculpt Dashboard wants to access your Google Account" box you will see
once. Google makes you write it before it will let you use it.

7. In the left menu find **APIs & Services → OAuth consent screen**.
8. Choose **External**, then **Create**. (Internal is only for large organisations.)
9. Fill in the three things it insists on:
   - **App name:** `Bodysculpt Dashboard`
   - **User support email:** your own address
   - **Developer contact email:** your own address again
   Click **Save and Continue** through the next screens — you do not need to add scopes
   here, the dashboard asks for what it needs when you connect.
10. On the **Test users** step, click **Add users** and add
    **ash@bodysculptwarrington.com**. Save.

> **Why this matters:** while the app is in "Testing", only the addresses listed here can
> connect. That is exactly what you want — it is your dashboard. You will see a warning
> screen the first time saying "Google hasn't verified this app". Click **Advanced**, then
> **Go to Bodysculpt Dashboard**. That warning is Google being careful about apps it does
> not know; you wrote this one.

## Part 4 — the client ID (2 minutes)

11. Left menu: **APIs & Services → Credentials**.
12. **+ Create Credentials → OAuth client ID**.
13. **Application type: Web application**. Name it `Dashboard`.
14. Under **Authorised JavaScript origins**, click **Add URI** and paste your site address.
    No slash on the end. For example:
    ```
    https://bodysculpt-hq.netlify.app
    ```
    If you also open the dashboard on a custom domain, add that as a second URI.
15. Leave **Authorised redirect URIs** empty. The dashboard does not use them.
16. Click **Create**. A box appears with a **Client ID** in it, ending
    `.apps.googleusercontent.com`. **Copy it.**

## Part 5 — tell the dashboard (1 minute)

17. Go to **app.netlify.com**, open your site.
18. **Site configuration → Environment variables → Add a variable**.
    - Key: `GOOGLE_CLIENT_ID`
    - Value: the client ID you just copied
19. Save, then **Deploys → Trigger deploy → Deploy site**. Wait for it to go green.

## Part 6 — connect

20. Open the Daily Dashboard. The week strip now shows a **Connect Google Calendar**
    button. Click it, pick your account, click through the unverified-app warning as
    described above, and click **Continue**.

Your week appears. It stays connected — you will not be asked again unless you sign out of
Google or withdraw the permission.

---

## What it can and cannot do

The dashboard asks for one permission: **see and change events on your calendars**.

It cannot read your email, open your Drive, see your contacts, or touch your Google account
in any other way. You can check or withdraw it any time at
**myaccount.google.com → Security → Your connections to third-party apps**.

---

## If something goes wrong

| What you see | What it means |
|---|---|
| "Google Calendar is not connected yet" | `GOOGLE_CLIENT_ID` is not set, or the site has not been redeployed since you set it. Redeploy. |
| A red box mentioning **origin** or `redirect_uri_mismatch` | The address in Part 4 step 14 does not exactly match the address in your browser bar. Check for a missing `https://`, a trailing slash, or `www.` on one and not the other. |
| "Google hasn't verified this app" | Expected. Advanced → Go to Bodysculpt Dashboard. |
| "access_denied" | Your address is not in the Test users list. Part 3 step 10. |
| The strip loads but is empty | It is reading the right calendar and that week is genuinely clear. Try the arrows. |

---

## Using it

- **The arrows** move a week back or forward. **Today** jumps back.
- **A day's column** shows up to four events; a busy day says "+2 more". Click any event to
  open it in Google Calendar.
- **New event** — name it, pick when, add email addresses for anyone coming.
  - Leave **"Email everyone an invitation"** ticked and Google sends them the invite and
    puts it straight in their calendar.
  - Untick it to add the event quietly to yours only.
- The line above the strip tells you what is next and how much is left after it.
