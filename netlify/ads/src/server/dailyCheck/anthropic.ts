/**
 * Anthropic completion for the Daily Ad Check (SERVER-ONLY).
 *
 * The single place the Anthropic SDK is used. It exposes a narrow `Completor` seam
 * so `narrate.ts` (and its tests) depend on an interface, not the SDK — the AI is
 * fully stubbable and the SDK never leaks into the browser graph.
 *
 * The call is deliberately cheap and fast so it fits a synchronous serverless
 * request: structured JSON output (the model can only return the briefing shape),
 * thinking DISABLED (the deterministic layer already did the reasoning — the model
 * only phrases it), and a small token cap. Quality of judgement comes from Opus
 * 4.8 + a tight, fact-only prompt, not from extended thinking.
 */
import Anthropic from '@anthropic-ai/sdk'

/** Owner-approved model (2026-07-21): best quality for the daily briefing. */
export const DAILY_CHECK_MODEL = 'claude-opus-4-8'

/** A single structured-JSON completion. Returns the raw JSON text the model wrote. */
export interface Completor {
  modelId: string
  complete(input: {
    system: string
    user: string
    /** JSON schema the response is constrained to. */
    schema: Record<string, unknown>
  }): Promise<string>
}

/**
 * Build the real Anthropic completor, or `null` when `ANTHROPIC_API_KEY` is unset
 * (the caller then renders the deterministic fallback — the card still works). The
 * key is read at CALL time from `process.env`; it is NEVER `VITE_`-prefixed and so
 * never reaches the browser.
 */
export function createAnthropicCompletor(): Completor | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  const client = new Anthropic({ apiKey })
  return {
    modelId: DAILY_CHECK_MODEL,
    async complete({ system, user, schema }) {
      const message = await client.messages.create({
        model: DAILY_CHECK_MODEL,
        max_tokens: 4096,
        // Reasoning is deterministic upstream; disabling thinking keeps the call
        // fast enough for a synchronous function. Structured output prevents any
        // stray reasoning from leaking into the response.
        thinking: { type: 'disabled' },
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema },
        },
        system,
        messages: [{ role: 'user', content: user }],
      })
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      return text
    },
  }
}
