/**
 * Turn the deterministic ChangeSet into a plain-English Briefing (SERVER-ONLY).
 *
 * The AI's ONLY job is interpretation and prioritisation — it may not invent a
 * number or overturn a recommendation. It is fed the already-computed ChangeSet as
 * a fact sheet and constrained to the fixed `Briefing` JSON shape; the response is
 * validated against `briefingSchema` before it is ever trusted. Any failure (no API
 * key, API error, malformed/invalid JSON) falls back to the deterministic
 * `fallbackBriefing`, so the card never lies and never hard-fails.
 */
import {
  briefingSchema,
  creativeLabel,
  fallbackBriefing,
  type Briefing,
  type BriefingSource,
  type ChangeSet,
} from '../../dailyCheck/index.ts'
import { ACTIVE_DECISION_SETTINGS, formatMinor } from '../../metrics/index.ts'
import type { Completor } from './anthropic.ts'

/** JSON schema the model's response is constrained to (mirrors `Briefing`). */
export const BRIEFING_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'whatChanged', 'watch', 'leaveAlone', 'doToday'],
  properties: {
    headline: { type: 'string' },
    whatChanged: { type: 'array', items: { type: 'string' } },
    watch: { type: 'array', items: { type: 'string' } },
    leaveAlone: { type: 'array', items: { type: 'string' } },
    doToday: { type: 'array', items: { type: 'string' } },
  },
}

const s = ACTIVE_DECISION_SETTINGS

/** The system prompt: persona + hard guardrails that keep the AI a narrator. */
export function buildSystemPrompt(): string {
  return [
    'You are an experienced paid-media manager writing a short morning briefing',
    'for the owner of a single gym. They are not technical. They can already see',
    'the numbers on their dashboard — your job is to explain what the numbers MEAN',
    'and help them prioritise their day, in plain English.',
    '',
    'HARD RULES — you are interpreting data, not deciding:',
    '- The dashboard has already decided KEEP ON — WINNER, KEEP ON — NEEDS MORE',
    '  TIME, or TURN OFF for each ad. Never contradict or re-decide those calls.',
    '- Never invent, estimate, or round a number. Only mention figures that appear',
    '  in the DATA below, exactly as written.',
    '- If nothing meaningful changed, say so plainly and tell them to leave things',
    '  running. Do not manufacture activity.',
    '- Be concrete and brief. Prefer one clear sentence over three vague ones.',
    '- Practical over drastic: an ad above target that is still producing leads is',
    '  usually a "prepare a replacement, then swap" — not a panic "turn it off now".',
    '- A campaign under CAMPAIGNS COMPLETED has finished its scheduled run. Mention',
    '  it ONCE in whatChanged as a past-tense wrap-up of how it finished. Its ads',
    '  are done — never ask the owner to turn off, watch, or change anything in a',
    '  completed campaign, and never list its ads under watch / leaveAlone / doToday.',
    '',
    `The owner's targets: aim for a cost per lead at or below ${formatMinor(s.targetCplMinor)};`,
    `above ${formatMinor(s.maxAcceptableCplMinor)} is unacceptable.`,
    '',
    'Return ONLY the JSON object. Sections:',
    '- headline: one line summarising the day.',
    '- whatChanged: what actually moved since the last check (empty on a quiet day).',
    '- watch: things to keep an eye on but not act on yet.',
    '- leaveAlone: what is working and should simply be left running.',
    '- doToday: the concrete actions to take today (empty if there are none).',
    '',
    'Route each ad into EXACTLY ONE of watch / leaveAlone / doToday by its verdict:',
    '- TURN OFF → doToday ONLY. Never put a TURN OFF ad in watch.',
    '- Keep-on but above target (not yet turned off) → watch.',
    '- On target / working → leaveAlone.',
    'An ad may also appear in whatChanged — that section is the news, not an action.',
  ].join('\n')
}

function metricLine(label: string, m: { display: string }): string {
  return `${label} ${m.display}`
}

/**
 * Render the ChangeSet as a compact, readable fact sheet for the model. Every line
 * is a statement the deterministic layer already computed; the model reads these
 * and turns them into the briefing (it must not go beyond them).
 */
export function buildUserPrompt(changeSet: ChangeSet): string {
  const out: string[] = []
  out.push('DATA (the facts you may use — do not go beyond these):')
  out.push('')
  out.push(
    changeSet.isFirstCheck
      ? 'This is the FIRST check — there is no previous check to compare against. Give a baseline read of the current state.'
      : `Comparison basis: the previous check on ${changeSet.previousCheckAt}.`,
  )
  out.push(
    `Analysis window: ${changeSet.window.start} to ${changeSet.window.end}.`,
  )
  out.push(
    `Current mix: ${changeSet.totals.winner} winner(s), ` +
      `${changeSet.totals.needsMoreTime} needs-more-time, ` +
      `${changeSet.totals.turnOff} to turn off, ` +
      `${changeSet.totals.notEvaluated} not evaluated (non-lead ads).`,
  )
  out.push('')

  if (changeSet.campaignsCompleted.length > 0) {
    out.push(
      'CAMPAIGNS COMPLETED (finished their scheduled run since last check):',
    )
    for (const f of changeSet.campaignsCompleted) {
      const t = f.totals
      out.push(
        `  - "${f.campaignName ?? 'unnamed campaign'}": final mix ${t.winner} winner(s), ` +
          `${t.needsMoreTime} needs-more-time, ${t.turnOff} past acceptable cost, ` +
          `${t.notEvaluated} not evaluated.`,
      )
      for (const w of f.winners)
        out.push(
          `      final winner: ${creativeLabel(w)} at ${w.cpl} per lead.`,
        )
      for (const x of f.turnOffs)
        out.push(
          `      ended past acceptable cost: ${creativeLabel(x)} at ${x.cpl} per lead (no action — campaign is over).`,
        )
    }
    out.push('')
  }

  out.push('RECOMMENDATION CHANGES since last check:')
  if (changeSet.decisionChanges.length === 0) out.push('  (none)')
  for (const c of changeSet.decisionChanges) {
    out.push(
      `  - ${creativeLabel(c)}: ${c.from} -> ${c.to} (${c.direction}). ` +
        `Cost per lead now ${c.cplNow}${c.cplBefore ? `, was ${c.cplBefore}` : ''}.`,
    )
  }
  out.push('')

  out.push('COST-PER-LEAD MOVES (still-running ads):')
  if (changeSet.cplMoves.length === 0) out.push('  (none material)')
  for (const m of changeSet.cplMoves) {
    out.push(
      `  - ${creativeLabel(m)}: ${m.before} -> ${m.now} (${m.direction} ${m.deltaDisplay}).`,
    )
  }
  out.push('')

  out.push('WINNERS ON A STREAK:')
  if (changeSet.winnerStreaks.length === 0) out.push('  (none)')
  for (const w of changeSet.winnerStreaks) {
    out.push(
      `  - ${creativeLabel(w)}: winner for ${w.checks} checks running, cost per lead ${w.cpl}.`,
    )
  }
  out.push('')

  if (changeSet.newlyDelivering.length > 0) {
    out.push('STARTED DELIVERING:')
    for (const c of changeSet.newlyDelivering)
      out.push(`  - ${creativeLabel(c)}`)
    out.push('')
  }
  if (changeSet.stoppedDelivering.length > 0) {
    out.push('STOPPED DELIVERING:')
    for (const c of changeSet.stoppedDelivering)
      out.push(`  - ${creativeLabel(c)}`)
    out.push('')
  }

  out.push('CURRENT ADS (for "leave alone" / context):')
  for (const snap of changeSet.snapshots) {
    if (!snap.evaluated) continue
    out.push(
      `  - ${creativeLabel(snap)}: ${snap.decisionLabel}. ` +
        `${metricLine('spend', snap.spend)}, ` +
        `${metricLine('leads', snap.leads)}, ` +
        `${metricLine('cost/lead', snap.cpl)}.`,
    )
  }

  return out.join('\n')
}

/** The outcome of narration — the briefing plus how it was produced. */
export interface NarrationResult {
  briefing: Briefing
  source: BriefingSource
  model: string | null
}

/**
 * Produce the briefing. With a working `completor`, ask the model and validate its
 * JSON; on any problem (or a null completor) fall back to the deterministic render.
 * `onFallback` receives a short reason for redacted server logging.
 */
export async function narrateBriefing(
  changeSet: ChangeSet,
  completor: Completor | null,
  onFallback?: (reason: string) => void,
): Promise<NarrationResult> {
  const fallback = (reason: string): NarrationResult => {
    onFallback?.(reason)
    return {
      briefing: fallbackBriefing(changeSet),
      source: 'fallback',
      model: null,
    }
  }

  if (completor === null) return fallback('no_api_key')

  let raw: string
  try {
    raw = await completor.complete({
      system: buildSystemPrompt(),
      user: buildUserPrompt(changeSet),
      schema: BRIEFING_JSON_SCHEMA,
    })
  } catch {
    return fallback('api_error')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback('invalid_json')
  }

  const result = briefingSchema.safeParse(parsed)
  if (!result.success) return fallback('schema_mismatch')

  return { briefing: result.data, source: 'ai', model: completor.modelId }
}
