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

  // The caller may request a specific model / token budget. Default to Sonnet so existing
  // callers (e.g. the monthly review) are unchanged. Only allow known models.
  const ALLOWED_MODELS = {
    "opus": "claude-opus-4-8",
    "sonnet": "claude-sonnet-4-6",
    "haiku": "claude-haiku-4-5-20251001",
  };
  const model = ALLOWED_MODELS[body && body.model] || "claude-opus-4-8";
  const maxTokens = (body && Number.isInteger(body.maxTokens) && body.maxTokens > 0 && body.maxTokens <= 16000)
    ? body.maxTokens : 1600;
  const wantStream = !!(body && body.stream);
  // Effort control (Opus 4.8 / Sonnet 5). Opus defaults to HIGH on the API, which is slower.
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

    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
};
