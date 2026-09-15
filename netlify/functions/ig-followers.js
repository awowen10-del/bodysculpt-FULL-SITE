// Netlify Function: ig-followers  (v173)
//
// The Content page's side of the follower record — see netlify/lib/followers.js.
//   GET   -> the history, newest last, plus the growth over 7 and 30 days
//   POST  -> record today's count (twice in a day just updates today), return the history
// Not scheduled, so the page may call it; the schedule lives in ig-snapshot.js.
import { readHistory, shape, recordToday } from "../lib/followers.js";

export default async (req) => {
  if (req.method === "GET") return Response.json(shape(await readHistory()));
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  return Response.json(await recordToday());
};
