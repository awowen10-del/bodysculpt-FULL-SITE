// Netlify Background Function: food-background  (v236)
//
// The Food hub's long jobs — createMenu, swapMeal, changeMenu and useRecipe. A week's menu from Claude Opus 5.5
// takes well over the 26 seconds an ordinary function gets, so this runs as a background
// function (Netlify answers 202 at once and lets it run for up to 15 minutes).
//
//   POST { id, action: "createMenu", weekEnding, inputs:{ schedule, situation, people } }
//   POST { id, action: "swapMeal",   weekEnding, night }
//   POST { id, action: "changeMenu", weekEnding, request }
//   POST { id, action: "useRecipe",  weekEnding, night, recipeId }   — a recipe-book favourite onto a night
//
// Progress lives in `food-job-<week>` (read through food.js ?job=), with each meal copied there
// as it is written so the page can show it. The menu is written ONLY
// after the response has passed every check in netlify/lib/food.js — a timeout, a rate limit
// or a bad answer leaves the saved week exactly as it was. ANTHROPIC_API_KEY never leaves the
// server.
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { runJob } from "../lib/food.js";

export default async (req) => {
  let job = null;
  try { job = await req.json(); } catch (e) { job = null; }
  if (!job || !job.weekEnding || !job.action) return;
  const store = getStore({ name: "bodysculpt-kpi", consistency: "strong" });
  if (!process.env.ANTHROPIC_API_KEY) {
    await store.set("food-job-" + job.weekEnding, JSON.stringify({ id: String(job.id || ""), action: job.action,
      status: "error", error: "ANTHROPIC_API_KEY is not set in Netlify.", finishedAt: new Date().toISOString() }));
    return;
  }
  const client = new Anthropic({ timeout: 13 * 60 * 1000, maxRetries: 1 });
  const out = await runJob(store, client, job);
  console.log("[food-background] " + JSON.stringify({ action: job.action, week: job.weekEnding, ok: out.ok, error: out.error || "" }));
};
