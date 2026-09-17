// netlify/lib/stages.js  (v206)
//
// WHAT THE POST IS FOR.
//
// Ash's own content model, from Bodysculpt_Content_Model_Explanation: "Not every post has the
// same job." There are four jobs, and a week is made of a fixed mix of them —
// 2 ATTRACT, 2 NURTURE, 2 POSITION, 1 CONVERT.
//
// Until now the ideas engine suggested eight reels a week with no idea which job any of them
// was doing, which meant a Friday planning session could quite easily pick seven ATTRACT
// posts and call it a week's content. Seven good posts all doing the same job is not a week,
// it is one post filmed seven times. So every suggestion now carries its stage, and so does
// every script written from one.
//
// One file, because two prompts and one page all have to mean the same thing by the word
// "nurture". A definition kept in three places drifts in two of them.
//
// Nothing here decides anything on its own: the STAGE is a suggestion, in exactly the way the
// idea it sits on is a suggestion. Ash plans the week.

export const STAGES = {
  attract: {
    label: "Attract",
    perWeek: 2,
    gloss: "reach and shares",
    what: "relatable or funny content built to be passed on. Its job is to stop the scroll, get a laugh or " +
      "a nod of recognition, and reach people who have never heard of the gym. It does not sell anything.",
  },
  nurture: {
    label: "Nurture",
    perWeek: 2,
    gloss: "trust and reassurance",
    what: "content that builds trust and an emotional connection. Its job is reassurance — it is for the " +
      "person who half-believes this will not work for someone like them.",
  },
  position: {
    label: "Position",
    perWeek: 2,
    gloss: "experienced and different",
    what: "content that positions Bodysculpt as experienced, welcoming and genuinely different from a " +
      "standard gym. Its job is to take the intimidation out of walking in — the place, the coaches, how a " +
      "session actually runs.",
  },
  convert: {
    label: "Convert",
    perWeek: 1,
    gloss: "encourage an enquiry",
    what: "a softer call to action. Its job is to make someone feel comfortable reaching out, and to explain " +
      "the value of how the gym works. One a week, never more — this is the post that asks.",
  },
};

export const STAGE_KEYS = Object.keys(STAGES);
const PER_WEEK = STAGE_KEYS.reduce((n, k) => n + STAGES[k].perWeek, 0);

/* Unknown reads as unknown. Defaulting to "attract" would put a confident wrong label on a
   post, and a wrong label is worse than none — it is the thing he would plan a week around.
   Ideas suggested before this existed have no stage, and show none. */
export const normStage = (s) => {
  const k = String(s || "").trim().toLowerCase();
  return STAGE_KEYS.includes(k) ? k : "";
};

/* How many of each to ask for, when asking for n. Proportional to the week he actually posts,
   so a day's suggestions can be planned straight off as a week. */
export function mixFor(n) {
  const mix = {};
  for (const k of STAGE_KEYS) mix[k] = Math.max(1, Math.round((n * STAGES[k].perWeek) / PER_WEEK));
  let diff = n - STAGE_KEYS.reduce((t, k) => t + mix[k], 0);
  // rounding rarely lands on n exactly. Slack goes ON attract, which is the one he needs most
  // of; it comes OFF whichever has the most to spare, and never off anything already down to
  // one — CONVERT is capped at one a week for a reason and must not be rounded out of the set.
  while (diff > 0) { mix.attract++; diff--; }
  while (diff < 0) {
    const k = STAGE_KEYS.filter((x) => mix[x] > 1).sort((a, b) => mix[b] - mix[a])[0];
    if (!k) break;
    mix[k]--; diff++;
  }
  return mix;
}

export const mixLine = (n) => {
  const mix = mixFor(n);
  const parts = STAGE_KEYS.map((k) => mix[k] + " " + k.toUpperCase());
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
};

/* The model, as prompt text. The same words reach the ideas engine and the script writer, so
   neither can quietly invent its own version of what "position" means. */
export function stagesBrief() {
  return "THE CONTENT MODEL — every post has ONE job, and there are four:\n" +
    STAGE_KEYS.map((k) => "· " + k.toUpperCase() + " — " + STAGES[k].what).join("\n") + "\n" +
    "A posting week is " + STAGE_KEYS.map((k) => STAGES[k].perWeek + "× " + k.toUpperCase()).join(", ") +
    ". Not every post is there to sell, and not every post is there to go viral.\n";
}
