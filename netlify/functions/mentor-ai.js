// Netlify Function: mentor-ai
// Server-side proxy to the Anthropic API so the API key never touches the browser.
//
// Setup: add an environment variable in Netlify named ANTHROPIC_API_KEY
// (Site configuration -> Environment variables). Get a key from console.anthropic.com.
//
// The browser POSTs { prompt } to /.netlify/functions/mentor-ai and gets back
// { text } (the model's reply) or { error }.

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set in Netlify environment variables." },
      { status: 500 }
    );
  }

  let body;
  try { body = await req.json(); }
  catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }

  const prompt = body && body.prompt;
  if (!prompt) {
    return Response.json({ error: "Missing prompt" }, { status: 400 });
  }

  // The caller may request a specific model / token budget. Callers name a TIER — "opus",
  // "sonnet", "haiku" — never an id, so the whole suite moves generation by editing this one
  // table. Only allow known models.
  //
  // v178: moved to the Claude 5 generation. The pages were still on Opus 4.8 / Sonnet 4.6
  // while lib/schedule.js had been writing captions on claude-opus-5 since v170, so the
  // reviews were a generation behind the thing writing the captions underneath them.
  //
  // ONE BEHAVIOURAL CHANGE WORTH KNOWING: on Opus 4.8, omitting `thinking` meant the model
  // did not think. On Opus 5 thinking is ON by default (adaptive). Every review here will
  // reason before it answers — better answers, slower and dearer. The non-streaming path
  // below already caps effort at "medium" to stay inside the 26s function wall, which is what
  // keeps the weekly and monthly reviews responsive; if one of them ever starts timing out,
  // the fix is for that caller to ask for effort "low", not to disable thinking (a
  // thinking-off Opus 5 writes tool calls and stray tags into its visible answer).
  const ALLOWED_MODELS = {
    "opus": "claude-opus-5",
    "sonnet": "claude-sonnet-5",
    "haiku": "claude-haiku-4-5",
  };
  const model = ALLOWED_MODELS[body && body.model] || "claude-opus-5";
  const maxTokens = (body && Number.isInteger(body.maxTokens) && body.maxTokens > 0 && body.maxTokens <= 16000)
    ? body.maxTokens : 1600;
  const wantStream = !!(body && body.stream);
  // Effort control (Opus 5 / Sonnet 5, which take all five levels). Opus defaults to HIGH on
  // the API, which is slower.
  // The non-streaming path is bound by the ~26s function timeout, so unless the caller asks
  // otherwise we cap it at "medium" there to keep monthly/weekly reviews responsive. Streaming
  // callers (e.g. the quarterly analysis) have no single-response wall, so we leave their
  // effort at the model default unless they specify one.
  const ALLOWED_EFFORT = { low:"low", medium:"medium", high:"high" };
  const requestedEffort = body && ALLOWED_EFFORT[body.effort];
  const effort = requestedEffort || (wantStream ? null : "medium");
  // Build the Anthropic request body, including effort only when set (so we never send an
  // invalid/empty effort, and streaming callers keep the model default unless they ask).
  const buildPayload = (withStream) => {
    const p = { model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] };
    if (withStream) p.stream = true;
    // effort is nested under output_config per the Messages API (a top-level "effort" is
    // rejected with a 400). Only sent when set, so streaming callers keep the model default.
    if (effort) p.output_config = { effort: effort };
    return JSON.stringify(p);
  };

  // ---- STREAMING PATH ----
  // Used for large/slow generations (e.g. the quarterly review) so there is no single
  // response-timeout wall: tokens flow to the browser as they are produced. The browser
  // receives Anthropic's raw SSE stream and parses it.
  if (wantStream) {
    try {
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: buildPayload(true),
      });
      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => "");
        return Response.json(
          { error: `Anthropic API ${upstream.status}`, detail: detail.slice(0, 200) },
          { status: 502 }
        );
      }
      // Pass the SSE stream straight through to the browser.
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    } catch (e) {
      return Response.json({ error: "Streaming failed: " + e.message }, { status: 502 });
    }
  }

  // ---- NON-STREAMING PATH (unchanged; used by the monthly review) ----
  try {
    const callApi = async () => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: buildPayload(false),
    });

    // Retry on 429/529 (rate limited / overloaded) with short backoff, but stay within a
    // time budget so we return a clean error rather than being killed by the 26s function
    // timeout mid-retry. Leave headroom for the final response to be sent.
    const startedAt = Date.now();
    const BUDGET_MS = 22000; // stop starting new attempts past this; function timeout is 26s
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await callApi();
      if (res.status !== 429 && res.status !== 529) break;
      const backoff = 800 * (attempt + 1);
      // if a backoff + another attempt would risk the budget, stop and surface the status
      if (Date.now() - startedAt + backoff > BUDGET_MS) break;
      await new Promise((r) => setTimeout(r, backoff));
    }

    if (!res.ok) {
      const detail = await res.text();
      const hint = (res.status === 529 || res.status === 429)
        ? "The AI service was busy. Please try again in a moment."
        : "";
      return Response.json(
        { error: `Anthropic API ${res.status}`, detail: hint || detail },
        { status: 502 }
      );
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // v178: a DECLINED answer is not an error, and that is the trap. Claude occasionally
    // reads a request and decides not to answer it: the call succeeds, HTTP 200, a normal
    // response body — with no text in it and a flag saying why. Read literally, as this did
    // until now, that is an empty string, and the page rendered a blank review with nothing
    // to explain it. Ash would press the button again, get the same nothing, and have no way
    // to tell a refusal from a bug. Every other Claude caller on this site (lib/schedule.js,
    // lib/hooks.js, lib/voice.js) checks this; mentor-ai predates them and never did.
    //
    // Unlikely on this site's prompts — it is being asked about gym takings and ad spend —
    // but a silent blank box is the worst way to find out.
    if (data.stop_reason === "refusal") {
      const why = (data.stop_details && data.stop_details.explanation) || "";
      return Response.json({
        error: "Claude declined to answer this one." + (why ? " " + String(why).slice(0, 200) : ""),
        detail: "This is not a fault with the dashboard and retrying the same question will most likely give the same answer. Re-run it, and if it happens again the prompt itself is what needs changing.",
        refusal: true,
      });
    }
    // Any other way of arriving with nothing to show. A truncated answer still has text and
    // is left alone — the pages handle that themselves — but empty is empty, and saying so
    // beats a blank panel.
    if (!text) {
      return Response.json({
        error: "The AI returned an empty answer" + (data.stop_reason ? " (" + data.stop_reason + ")" : "") + ".",
        detail: "Nothing came back to show. Re-run it — if it keeps happening the prompt is probably too large.",
      });
    }

    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
};
