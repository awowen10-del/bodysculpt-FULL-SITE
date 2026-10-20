# Team Slack card — switching it on

The **Team Slack** card on the Daily Dashboard reads the Bodysculpt Slack for you and shows:

- **What you missed** — a few sentences, most important first.
- **Worth knowing** — cancellations, injuries, new starters and the like. Tap one to open it in Slack.
- **Step in** — conversations where someone is waiting on you, a problem needs the owner, or a
  question needs your yes or no. Each one has a reply already written.
- **Post-session updates** — every Post-Shift Checklist you have not answered yet, with a reply
  that thanks the coach for something specific and picks up anything flagged.

Open a row, read what was said, change the reply if you want (or tell Claude what to say), and
press **Post as you**. It goes into that thread, under your name. If you change your mind, the
row that went has an **Undo** on it.

It needs one thing from you: a key that lets the dashboard read and post in Slack as you. That
key is called a **token**. It takes about ten minutes, once.

---

## 1. Make a small Slack app (this is where the token comes from)

A Slack "app" here is just a named permission slip. Nobody in the team will see it.

1. Go to **https://api.slack.com/apps** and sign in with your Bodysculpt Slack account.
2. Press **Create New App** → **From scratch**.
3. Name: `Bodysculpt Dashboard`. Workspace: **Bodysculpt**. Press **Create App**.

## 2. Say what it may do

1. In the left menu, open **OAuth & Permissions**.
2. Scroll to **Scopes** → **User Token Scopes** (the second box — *not* Bot Token Scopes).
3. Press **Add an OAuth Scope** and add each of these:

| Scope | Why the card needs it |
|---|---|
| `channels:read` | to see which public channels you are in |
| `channels:history` | to read them |
| `groups:read` | to see your private channels |
| `groups:history` | to read them |
| `im:read` | to see your direct messages |
| `im:history` | to read them |
| `mpim:read` | to see your group messages |
| `mpim:history` | to read them |
| `users:read` | to show names instead of codes |
| `chat:write` | to post a reply **when you press Post** (and delete it again if you press Undo) |
| `reactions:write` | for **Just react** on a checklist |

It cannot invite or remove anyone, change channels, or read any workspace you are not in.

## 3. Install it and copy the token

1. Scroll back to the top of **OAuth & Permissions** and press **Install to Workspace** → **Allow**.
2. You now see a **User OAuth Token** starting `xoxp-`. Press **Copy**.

Treat it like a password: anyone holding it can read and post in Slack as you.

## 4. Give it to the dashboard

1. In Netlify: **Site configuration → Environment variables → Add a variable**.
   - Key: `SLACK_USER_TOKEN`
   - Value: the `xoxp-…` token
2. `ANTHROPIC_API_KEY` is already there (the weekly review uses it). Nothing to do.
3. **Deploys → Trigger deploy → Deploy site.**

Open the Daily Dashboard. The card says it is reading Slack; the first read takes about a
minute. After that it reads again by itself at 7am and 3pm (UK summer time; 6am and 2pm in
winter), and whenever you open the page and the last read is more than an hour and a half
old. **Read again** on the card does it now.

---

## Good to know

- **It posts only when you press Post as you.** Nothing is ever sent by itself.
- **Undo** sits on the row you just posted from, for twenty seconds. After that you can still
  delete the message in Slack as normal.
- **No reply needed** takes a row off the card without posting anything. Undo is on that too.
- Replies go **in the thread** of the message they answer, so the channel does not fill up.
  A direct message is answered in the DM.
- Type `@Dan` (a first name) in a reply and it becomes a proper Slack mention when posted.
- The card keeps its own records, separate from your KPIs and plans — nothing here can touch them.
- Each read costs a few pence of Claude usage (it reads a week of messages and writes the
  replies). Two scheduled reads a day plus the ones you trigger is well under £1 a day.

## If something goes wrong

- **"Slack did not accept the token"** — it was revoked or mistyped. Repeat step 3 and paste the
  new one into Netlify, then redeploy.
- **"The Slack app is missing a permission (…)"** — add the scope named in brackets (step 2),
  press **Reinstall to Workspace**, copy the new token into Netlify, redeploy.
- **"The last read failed …"** — the card keeps showing the read before, and says so. Press
  **Read again** in a few minutes.

To switch it off: delete `SLACK_USER_TOKEN` in Netlify, or remove the app at
**https://api.slack.com/apps**.
