# Marketing Suite — how it connects to this dashboard

**Installed 17 September 2026.** Eight Claude Code skills from
[tenfoldmarc/marketing-suite](https://github.com/tenfoldmarc/marketing-suite) that write ads,
video scripts, ad images, VSLs and landing pages: `/ad-spy` `/ad-copy` `/video-ad-copy`
`/ad-image-gen` `/vsl-script` `/sales-page` `/optin-page` `/ghl-page`.

**It is not part of this site.** It has no screens, no functions and no database. It lives on
Ash's laptop in `~/.claude/skills/` and runs in Claude Code conversations. Nothing here
deploys it and nothing here depends on it. The reason it was not built into `ads.html`:
`/ad-spy` drives a real browser over the Meta Ad Library and runs `ffmpeg` and a transcriber
over competitors' videos. A Netlify function has no browser, no ffmpeg and 26 seconds — the
same wall the Friday trend scout hit, which is why that scout drives Ash's own Chrome too.

---

## The playbook is the master copy

Ash's business is described **once**, in the 35,000-word playbook:

| | |
|---|---|
| Lives in | Netlify Blobs, store `bodysculpt-kpi`, key `ig-ideas`, field `about` |
| Edited at | Content → Make a reel → "Edit what the gym does" |
| Read by | the ideas engine, the reel writer, the draft checker (`netlify/lib/ideas.js` `readAbout()`) |
| Also read by | `/api/hooks` GET, as `about` |

The marketing suite keeps its own profile at `~/.claude/ad-profiles/bodysculpt.md`. That file
is a **derived copy**, and it says so at the top. When the two disagree the playbook wins.
Change facts in the playbook, then re-seed the profile — never the other way round, or the two
drift and nobody can tell which one an ad was written from.

Seeded on 17 September 2026 from the playbook (30,809 characters) and the voice profile
(5,406). The dashboard lives at `https://bodysculptdashboard.netlify.app`.

Two other dashboard blobs are worth pulling into the profile at the same time:

| Blob key | What it adds |
|---|---|
| `ig-voice` | the voice profile learnt from Ash's own reels, plus his own banned phrases (`userBanned`) |
| `ig-competitors` | the gyms already watched on the Social tab — the same businesses worth spying on for ads |

## Re-seeding the profile

```
Re-seed my marketing suite profile from the dashboard playbook
```

That reads `about`, `ig-voice` and `ig-competitors` from the live site and rewrites
`~/.claude/ad-profiles/bodysculpt.md`. Anything the playbook does not plainly state is left
marked `NEEDS PLAYBOOK` rather than guessed: a gym's price, proof or guarantee invented into
an ad is the one failure mode that actually costs money.

## Two things the seeding turned up

**Calls to action are a genuine conflict, not an oversight.** Ash's organic voice contains
none at all — no "DM", no "sign up", no "link in bio", no hashtags anywhere. A paid ad has to
ask for something, and Meta puts a button on it regardless. So the profile says explicitly
what the ask is allowed to be: the Meta button plus one plain next step in his own enquiry
words ("Would Monday or Wednesday suit you better?"), landing on
`bodysculptwarrington.co/skipthequeue`. Without that written down, every ad either shouts or
never asks.

**The proof was never in the playbook — it was in the reviews.** The playbook is a coaching
and sales manual and quotes no clients, so the first pass recorded "no testimonials held".
Wrong place to look: `bodysculptwarrington.com/testimonials` carries six, published by Ash
himself and therefore already cleared, and Google Maps carries **73 reviews at 5.0**. Both are
now in the profile.

Ash: "I do believe the Google Reviews are way more powerful." He was right. 35 of the 73 are
now captured in full at `~/Documents/ad-copy/bodysculpt/google-reviews.md` (3,789 words), and
the strongest lines are pulled out in the profile. Google's own review dialog only renders its
reviews for real scroll events, so they came out through a `computer` scroll loop and the page
clipboard rather than anything scriptable — worth knowing before anyone tries again.

Counted across those 35: welcoming / no ego / no judgement (32), the Challenge (21), getting
stronger (16), coaches know their stuff (15), adapting for the individual and for injuries
(13), confidence (9). Equipment, facilities, price and before-and-after photos are almost
absent. That is the playbook's whole argument, confirmed by 35 customers independently.

**The public website contradicts the playbook.** The site sells a "6 WEEK TRANSFORMATION
CHALLENGE" and a "LIFE CHANGING TRANSFORMATION", calls itself "THE BEST GYM IN WARRINGTON" and
promises to "make all your fitness dreams come true". The playbook bans the word
transformation, bans superlatives about the gym, and names the product the 6 Week Challenge.
The site's three-step flow does not match the playbook's enquiry flow either. Ads written to
the playbook will therefore hand over to a page written against it, and the GoHighLevel move
is the moment to fix that rather than rebuild it as it stands.

## What it needs on the laptop

| | Status on 17 Sep 2026 |
|---|---|
| `ffmpeg` | installed (9.0.1) |
| `node` / `npx` | installed (24.21.0) — `agent-browser` downloads on first use |
| local `whisper` | not installed. Optional: `pip3 install openai-whisper`, or an `OPENAI_API_KEY` instead |
| competitors | the ten gyms from Social → Competitors are in the profile by Instagram handle. Each needs its Meta Ad Library page ID resolving on the first `/ad-spy` run |
| keys | `~/.claude/ad-profiles/.env`, written by Ash, never committed. `GEMINI_API_KEY` (already on the Netlify site) drives image generation |

## The open loop, not yet built

The suite learns from results: tell it "ad 2 won" and it logs the numbers and writes a note
every skill reads before writing again. **Those numbers have to be typed in by hand.** This
dashboard already has them — Facebook Ads syncs from Meta nightly, scores every ad and runs
the Daily Ad Check.

So: the dashboard knows which ads won, the suite writes the next ones, and nothing joins them
up. Closing that is a small job — an endpoint here that hands over what won and what it cost,
in the shape the suite's `learnings.md` already expects. Not built yet, deliberately.
