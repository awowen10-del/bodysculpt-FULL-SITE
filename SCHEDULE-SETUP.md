# Scheduling — connecting the three things it needs

**Time: about twenty minutes, once.** Three accounts, three keys, one Drive folder.

The Scheduling page (`/schedule.html`, "Scheduling" under Social in the rail) works like
this: a Google Drive folder is your inbox. Drop a finished video in it, press **Check
Drive**, and it appears as a card. **Write caption** transcribes the video and writes a
caption in your own voice (from your recent Instagram captions). You tidy the caption,
tick where it goes, pick the date and time, press **Schedule** — and Zernio posts it for
you. The **Month** tab shows what is queued and what went out.

Everything below goes in **Netlify → Site configuration → Environment variables**, then
**Deploys → Trigger deploy**. The page tells you which of the three is still missing.

---

## 1. Google Drive — the inbox (5 minutes)

1. In Google Drive, make a folder called something like **Ready to post**.
2. Right-click it → **Share** → under *General access* choose **Anyone with the link**
   (Viewer). This is what lets the site read the folder with a simple key and no login.
   Only videos you put in this folder are readable — nothing else in your Drive.
3. Copy the folder's id: it is the long string at the end of the folder's address,
   `https://drive.google.com/drive/folders/THIS-PART`.
4. **console.cloud.google.com** → the same *Bodysculpt Dashboard* project as the calendar →
   search **Google Drive API** → **Enable**.
5. **APIs & Services → Credentials → + Create credentials → API key.** Copy it. (Optional
   but sensible: click the key → *API restrictions* → restrict it to the Google Drive API.)
6. Netlify variables:
   - `GOOGLE_DRIVE_API_KEY` — the key
   - `GOOGLE_DRIVE_FOLDER_ID` — the folder id
   - `GOOGLE_DRIVE_CUTOFF_DATE` — optional, e.g. `2026-09-01T00:00:00Z`: ignore files
     older than this, so a folder full of history does not all land in the queue at once.

## 2. Gemini — transcribing the video (3 minutes)

Claude cannot watch a video; Gemini can. It is used for one thing: turning what is said
in the video into text, so the caption is about the actual content.

1. **aistudio.google.com** → sign in → **Get API key** → **Create API key** (pick the same
   Google Cloud project). Copy it.
2. Netlify variable: `GEMINI_API_KEY`.

The free tier is plenty. Without this key the page still works — captions are written from
the file name only, and the card says so.

## 3. Zernio — the posting (10 minutes)

Zernio is the service that actually publishes to Instagram, Facebook, TikTok and YouTube.
This is a paid account of your own.

1. **zernio.com** → sign up → connect the accounts you post to (Instagram at least).
2. In Zernio's settings find your **API key**, and for each connected account its
   **account id**.
3. Netlify variables:
   - `ZERNIO_API_KEY`
   - `ZERNIO_ACCOUNT_INSTAGRAM` — the Instagram account id
   - `ZERNIO_ACCOUNT_FACEBOOK`, `ZERNIO_ACCOUNT_TIKTOK`, `ZERNIO_ACCOUNT_YOUTUBE` — only
     the ones you connected. The **Where** tick-boxes on a card show only the platforms
     that have an id.

Until Zernio is connected the **Schedule** button is switched off; everything else works,
so you can start captioning straight away.

`ANTHROPIC_API_KEY` — the caption writer — is already on the site.

---

## Using it

| Button | What it does |
|---|---|
| **Check Drive** | Looks in the folder for new files and adds them to the queue. Files already seen are not added twice. |
| **Write caption** | Transcribes the video, then writes the caption (and a YouTube title if YouTube is connected). Takes a minute or two for a long video; the card updates on its own. Press again to rewrite. |
| **Schedule** | Uploads the video to Zernio and books it for the date and time you picked. |
| **Cancel** | Asks Zernio to cancel a scheduled post and puts the card back to *Ready*. If Zernio does not confirm, the card says to check there too. |
| **Skip** / **Bring back** / **Remove** | Put a video aside, bring it back, or drop it from the list. The file in Drive is never touched. |

A scheduled post whose time is a quarter of an hour gone is shown as **Posted**.

## If something goes wrong

| What you see | What it means |
|---|---|
| "Google Drive is not connected yet" | `GOOGLE_DRIVE_API_KEY` or `GOOGLE_DRIVE_FOLDER_ID` is missing, or the site has not been redeployed. |
| Check Drive says "Drive: … 404" or "not found" | The folder id is wrong, or the folder is not shared as *Anyone with the link*. |
| Captions arrive but are vague | `GEMINI_API_KEY` is missing (the card says "written from the file name"), or the video has no speech. |
| "Zernio would not schedule it: …" | Zernio's own words follow the colon — usually an account that is not connected in Zernio, or a video format it will not take. |
| "None of the chosen platforms is connected in Zernio" | The ticked platform has no `ZERNIO_ACCOUNT_…` id. |
