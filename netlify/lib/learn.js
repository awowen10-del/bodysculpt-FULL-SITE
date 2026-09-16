// netlify/lib/learn.js  (v194)
//
// Learning from what Ash actually picks, and from what actually worked.
//
// The bundle he was sent had one idea we had not taken, and it was its best: it logged every
// session — all the hooks offered, which one was chosen, what was changed — and read it back
// on the next run, on the principle that the user's real picks beat the model's assumptions.
// Without it, a man who chooses "Behind the scenes" eleven times running and never once picks
// a myth bust goes on being offered myth busts for ever.
//
// We can do better than the bundle, because we have something it never had: his own numbers.
// He posts through Zernio, the reel lands in his feed, and instagram-feed already reads its
// reach and views. Tie a posted script back to the reel it became and the library can rank by
// what worked for BODYSCULPT rather than for a gym in Manchester.
//
// Two signals, in order of how much they are worth:
//   1. PERFORMANCE — what the reel actually did. Slow to arrive, worth the most.
//   2. PICKS — which of the eight he chose, and which he passed over. Immediate, and still
//      the best thing available until a dozen reels have been out long enough to judge.
//
// Neither is a rule. They go into the prompt as what he tends to do, because a preference is
// evidence about taste, not an instruction to repeat himself into a rut.
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");

// Captions are typed, pasted and tweaked, so this compares them the way a person would —
// first line, lowercased, punctuation dropped. An exact match is not the bar; recognising the
// same reel is.
const fingerprint = (caption) => clip(String(caption || "").split("\n").find((l) => l.trim()) || "", 120)
  .toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

function overlap(a, b) {
  if (!a || !b) return 0;
  const A = new Set(a.split(" ").filter((w) => w.length > 3));
  const B = new Set(b.split(" ").filter((w) => w.length > 3));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

/* Which of his own posts a script became. Only scripts he marked filmed or posted are
   considered — a draft has not been anywhere — and only a confident match counts, because a
   wrong one would teach the library the opposite of the truth. */
export function matchPerformance(scripts, ownPosts) {
  const posts = (ownPosts || []).filter((p) => p.caption);
  return (scripts || []).map((s) => {
    if (s.status !== "posted" && s.status !== "filmed") return s;
    const mine = fingerprint(s.caption);
    if (!mine) return s;
    let best = null, bestScore = 0;
    for (const p of posts) {
      const score = overlap(mine, fingerprint(p.caption));
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!best || bestScore < 0.6) return s;
    const views = best.views != null ? best.views : best.reach;
    return { ...s, postViews: views == null ? null : views, postUrl: best.permalink || "", postMatch: Number(bestScore.toFixed(2)) };
  });
}

/* What he tends to choose, said in a sentence the writer can use.
   Deliberately short: this rides along in every options prompt, and a long preamble about his
   history would crowd out the hooks it is supposed to be choosing between. */
export function preferenceBrief(scripts) {
  const kept = (scripts || []).filter((s) => s.status !== "binned");
  if (kept.length < 3) return "";           // three is not a taste, it is three

  const picked = new Map(), passed = new Map();
  for (const s of kept) {
    if (s.type) picked.set(s.type, (picked.get(s.type) || 0) + 1);
    for (const o of s.shown || []) {
      if (o.type && o.type !== s.type) passed.set(o.type, (passed.get(o.type) || 0) + 1);
    }
  }
  const top = [...picked.entries()].sort((a, b) => b[1] - a[1]);
  // offered more than three times and never once chosen: a real signal, not a gap in the data
  const never = [...passed.entries()].filter(([t, n]) => n >= 3 && !picked.has(t)).map(([t]) => t);

  const withNumbers = kept.filter((s) => typeof s.postViews === "number" && s.postViews > 0)
    .sort((a, b) => b.postViews - a.postViews);

  const lines = [];
  if (top.length) lines.push("He usually picks: " + top.slice(0, 3).map(([t, n]) => t + " (" + n + ")").join(", ") + ".");
  if (never.length) lines.push("He has been offered " + never.slice(0, 3).join(", ") + " several times and never once chosen " + (never.length === 1 ? "it" : "them") + ".");
  if (withNumbers.length >= 3) {
    const best = withNumbers.slice(0, 3).map((s) => '"' + clip(s.lead || s.spoken || s.onScreen, 70) + '" (' + s.postViews + " views)");
    lines.push("His own reels from this page that did best: " + best.join("; ") + ".");
    const worst = withNumbers[withNumbers.length - 1];
    if (withNumbers.length >= 5) lines.push('His weakest was "' + clip(worst.lead || worst.spoken || worst.onScreen, 70) + '" (' + worst.postViews + " views).");
  }
  if (!lines.length) return "";
  return "WHAT HE ACTUALLY GOES FOR, from " + kept.length + " reels written here:\n" + lines.join("\n") +
    "\nTreat this as evidence about his taste, not a rule. Do not simply repeat what he chose last time — " +
    "give him the range, weighted towards what he reaches for.";
}

/* The bit that runs after a draft is written: does it pass the rules his own voice profile
   set? The profile ends in a CHECKS section — six specific, yes-or-no rules — and a banned
   list, and until now nothing ever sat that test. Generating a rubric and never marking
   against it is the kind of thing that looks thorough and changes nothing. */
export function checkPrompt(draft, profile, banned, about) {
  /* v195: the WHOLE profile, not just its CHECKS section.
     The first live run caught five real things and left three hashtags standing, in a draft
     for a man whose profile says "Zero hashtags. Not one appears in twelve captions. Don't
     add any." That rule lives under CAPTIONS, and this function was passing only CHECKS —
     trading the rulebook for the summary of it to save a few hundred tokens on a call that
     had tokens to spare. CHECKS is still named as the explicit test, because a numbered
     yes-or-no list is what a marker marks against; the rest is the evidence behind it. */
  const checks = /^CHECKS\s*$/mi.test(profile || "")
    ? (profile.split(/^CHECKS\s*$/mi)[1] || "").split(/^[A-Z][A-Z \-']{3,}$/m)[0].trim()
    : "";
  return "Here is a draft written for Ash, who runs a gym in Warrington, and the profile of how he actually " +
    "writes and talks. The profile was built from transcripts and captions of his own reels, so it beats any " +
    "instinct about how social copy ought to sound.\n\n" +
    "HIS PROFILE — every line of it is a rule, not only the numbered ones:\n" + clip(profile, 6000) + "\n\n" +
    (checks ? "THE NUMBERED CHECKS, which the draft must pass one by one:\n" + clip(checks, 2000) + "\n\n" : "") +
    (banned && banned.length ? "NEVER HIS WORDS:\n" + banned.map((b) => "· " + b).join("\n") + "\n\n" : "") +
    /* v205: and the facts. The voice half of this catches a draft that does not sound like
       him; nothing was catching one that says something about the gym that is not true — a
       price he does not charge, a thing the programme does not include, a timescale nobody
       promised. Of everything this system can get wrong, that is the one that costs him with
       a real person standing in front of him. */
    (about ? "WHAT THE GYM ACTUALLY DOES — his own words, and the only source of fact:\n" +
      clip(about, 40000) + "\n\n" : "") +
    "THE DRAFT:\n" + clip(draft, 3000) + "\n\n" +
    (about ? "Check every factual claim about the gym against the passage above — prices, what is " +
      "included, how long things take, how many people are in a session, what happens when. Flag " +
      "anything the draft states that is not supported there, and in the fix, cut the claim or " +
      "soften it to what is true. Do not invent a replacement fact.\n\n" : "") +
    "Also watch for the tells that give away writing-that-was-written: three short sentences in a row " +
    "with the same shape, \"It's not X. It's Y.\", a rule of three, sections balanced too evenly. Real " +
    "speech and real captions are lumpier than that.\n\n" +
    /* v196: found in testing — it decided "sculpt" was a banned word and took
       @bodysculptwarrington out of the CTA. A checker that edits away the name of the business
       is worse than no checker: it looks like care and it costs him the only thing in the
       caption that tells anyone where to go. */
    "NEVER flag or remove any of these, whatever a rule seems to say: the name Bodysculpt, the " +
    "handle @bodysculptwarrington, Ash's own name, the name of any client, or the town Warrington. " +
    "They are his, not marketing language, and a rule about words he avoids never applies to them.\n\n" +
    "Go through the profile line by line, not just the numbered checks. A habit stated anywhere in it — " +
    "how long his on-screen lines run, whether he uses hashtags, whether he capitalises, how he closes — " +
    "is a rule the draft has to meet.\n\n" +
    "Answer in exactly this format and nothing else:\n" +
    "---FAILED---\n(one per line, each naming the rule broken and quoting the words that broke it. " +
    "If the draft passes everything, write: none)\n" +
    "---FIXED---\n(the whole draft again with those things fixed, in the same format it arrived in, " +
    "changing NOTHING else. If nothing failed, repeat the draft unchanged.)\n";
}

export function parseCheck(text) {
  const part = (name) => {
    const m = new RegExp("---" + name + "---\\s*([\\s\\S]*?)(?=---[A-Z]+---|$)").exec(text || "");
    return m ? m[1].trim() : "";
  };
  const failedRaw = part("FAILED");
  const failed = /^none$/i.test(failedRaw) ? [] :
    failedRaw.split("\n").map((l) => clip(l.replace(/^[-*•\d.\s]+/, "").trim(), 200)).filter(Boolean).slice(0, 8);
  return { failed, fixed: clip(part("FIXED"), 4000) };
}
