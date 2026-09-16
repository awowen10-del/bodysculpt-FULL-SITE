# Hooks — what was actually said in the reels that took off

**Time: none. There is nothing to set up.** Every key this needs is already on the site.

The Hooks tab sits next to My posts and Competitors on the Content page. It exists because
of a gap: the flame on the Competitors tab tells you a reel did at least twice what that
account normally does, and then stops. It never tells you what was **said** in it. A flame
with no words under it means something worked and leaves you to guess what.

This reads the opening of every flamed reel and writes down three things:

| | |
|---|---|
| **What was said** | the words in the first three seconds, verbatim |
| **What was on screen** | the text overlay at the start, which is usually not the same thing |
| **The shape** | the same sentence with the specifics taken out |

The shape is the part worth keeping:

> "Everyone thinks cardio burns the most fat. It doesn't."
> → **"Everyone thinks [THING] does [OUTCOME]. It doesn't."**

The original sentence is about cardio and is no use to you twice. The shape is about nothing
in particular, which is exactly why it works on a subject of your own.

---

## Where it gets the reels from

Nothing new. It reads what the nightly competitor scrape already found:

1. **05:00** — the scrape reads each watched account's public page (Apify). Already running.
2. **05:30** — this reads the reels from that scrape which beat their own account by 2× or
   more, and adds them to the library.

Your own reels go in too, using the flame the Content page already works out from your reach.
Those are the useful ones for confirming what works for *you* rather than for a gym in Leeds.

**Only the flames are read.** Reading a video costs a Gemini call and about half a minute. Ten
accounts × fifteen posts every night would be 150 of them for nothing, because a reel that did
its account's normal has nothing to teach. On a normal night there are two or three.

---

## Using it

### Writing a reel

1. Type what the reel is about, in a sentence. Plain words — *"a client asked whether she'd get
   bulky lifting three times a week"* is perfect.
2. Press **Find openings**. You get eight, each one built on a different proven shape from your
   library, and each one has three parts: what you say, what goes on the screen, and a caption
   line. The on-screen text deliberately does **not** repeat the spoken line — saying the same
   thing twice wastes the only two seconds that matter.
3. Pick one. Press **Write the script**.
4. **Keep it — to film** puts it in the *To film* list. **Copy** gives you the whole thing to
   paste into a teleprompter app.

### The list

A script moves *draft → filmed → posted* with one button each time. Tapping its hook line opens
it again to read or re-copy. The bin is a side exit and never deletes anything else.

When you've filmed it, drop the video in your **Ready to post** Drive folder as usual — the
Scheduling page picks it up from there, writes the caption and books it with Zernio. The two
pages meet at the Drive folder and neither needs to know about the other.

### The library

Every hook, newest first, with the flame that earned it and a **watch** link to the reel it came
from. The ✕ drops one you don't rate — it won't come back on the next nightly run.

### Find hooks

You shouldn't need it; the nightly run does this. Press it if you've just added a competitor and
don't want to wait until morning. It takes a few minutes and you can leave the page.

---

## What it costs

- **Gemini** — free tier is plenty at two or three reels a night.
- **Claude** — a few pence per script.
- **Apify** — unchanged. This reads what the existing scrape already paid for.

---

## How you talk

The card above the library. Press **Learn how I talk** once and it transcribes your ten
best-performing reels in full, then writes down how you actually speak: the words you reach for,
the ones you never use, how long your sentences run, how you open, how you close, whether you
swear, what you call the viewer. Plus a list of phrases that would instantly give away that a
script wasn't yours.

**This steers everything.** Scripts on this tab and captions on the Scheduling page both read it.
One build improves both.

The profile is shown in full on the page, on purpose — it's an instruction being handed to a
model on your behalf, so you should be able to read it and tell it it's wrong. If a line in it
doesn't sound like you, press Learn it again after your next few reels.

Until you build it, everything falls back to your recent captions, and the card says so. That
still works — it carries your vocabulary — but a caption is typed and edited, and a reel is
spoken once into a phone. The rhythm is the bit only the transcripts can teach.

Takes about five minutes. There's no nightly rebuild, and there shouldn't be: your voice doesn't
drift week to week. Press it again when you feel your content has moved on.

A build needs at least **three** reels it can transcribe. Instagram's video links go stale, so if
it complains, press Refresh on the Content page first and try again.

---

## If something goes wrong

| What you see | What it means |
|---|---|
| "Two keys are missing" | `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` isn't set in Netlify, or the site hasn't been redeployed since. Both are the Scheduling page's keys. |
| "The library is empty" and nothing waiting | Nothing on your Competitors tab has beaten its own account by 2× yet. Watch a few busier accounts and give it a night. |
| Reels waiting but nothing appears after Find hooks | Instagram's video links go stale within the day. A reel scraped last night reads fine; one from last week won't, and it goes on the skip list rather than being retried nightly. |
| "There are no hooks in the library yet" when writing | The library has to have something in it before it can build on it. Press Find hooks first. |
| An opening that sounds nothing like you | Say so in the topic box — more detail there changes the output more than anything else. Or pick a different shape; they're genuinely different. |
| Scripts sound generic | Check the *How you talk* card. If it says nothing has been learned yet, that's why — it's writing from captions. |
| "Only N of your reels could be transcribed" | Instagram's video links go stale. Press Refresh on the Content page, then try again. |
| The voice profile describes someone else | Press **Learn it again**. It reads your ten best reels, so it follows your content as it changes. |

---

## Where things live

| Thing | File |
|---|---|
| The tab | `social.html` (the `v-hooks` view) |
| The library and the writing | `netlify/lib/hooks.js` |
| Reading it, saving scripts | `netlify/functions/hooks-api.js` (`/api/hooks`) |
| Reading the reels (slow) | `netlify/functions/hooks-mine-background.js` |
| The nightly run, 05:30 | `netlify/functions/hooks-mine-scheduled.js` |
| The stored library | one blob, `ig-hooks` |
| How you talk | `netlify/lib/voice.js` + `netlify/functions/voice-build-background.js` |
| The stored voice profile | one blob, `ig-voice` |
| Where both writers read it | `voiceBrief()` in `netlify/lib/schedule.js` |
| The tests | `tests/v177-hook-library.test.cjs`, `tests/v178-spoken-voice.test.cjs` |
