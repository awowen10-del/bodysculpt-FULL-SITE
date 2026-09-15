/**
 * Briefing schema + deterministic fallback (browser-safe).
 *
 * `briefingSchema` validates whatever the AI returns before it is ever trusted or
 * stored — a malformed or off-contract response is rejected and the caller falls
 * back to `fallbackBriefing`, which renders the SAME `Briefing` shape straight from
 * the deterministic `ChangeSet`. So the card always shows something truthful: prose
 * when the AI succeeds, plain bullets when it doesn't. The AI can never widen the
 * shape or smuggle in a field the schema doesn't allow.
 */
import { z } from 'zod'
import type { Briefing, ChangeSet, CreativeIdentity } from './types.ts'

/** Bounded so a runaway response can't bloat a stored row or the card. */
const line = z.string().trim().min(1).max(600)
const lines = z.array(line).max(12)

export const briefingSchema: z.ZodType<Briefing> = z.object({
  headline: z.string().trim().min(1).max(240),
  whatChanged: lines,
  watch: lines,
  leaveAlone: lines,
  doToday: lines,
})

/** The base name for a row: ad name, else headline, else campaign. */
function baseLabel(c: CreativeIdentity): string {
  const name = c.adName?.trim()
  if (name) return name
  const headline = c.headline?.trim()
  if (headline)
    return headline.length > 60 ? `${headline.slice(0, 57)}…` : headline
  const campaign = c.campaignName?.trim()
  if (campaign) return `an ad in ${campaign}`
  return 'an ad'
}

/**
 * A short human label for a row, suffixed with its audience (ad set) so the SAME
 * creative running in two ad sets — now separate rows — never reads as one thing
 * (e.g. "Problem Ad #3 — …Women…" vs "Problem Ad #3 — …Men…").
 */
export function creativeLabel(c: CreativeIdentity): string {
  const base = baseLabel(c)
  const audience = c.adSetName?.trim()
  return audience ? `${base} — ${audience}` : base
}

const DECISION_WORD: Record<string, string> = {
  winner: 'a winner',
  needs_more_time: 'needs more time',
  turn_off: 'one to turn off',
}

/**
 * Render the ChangeSet as a plain-English Briefing WITHOUT any AI. This is the
 * safety net (AI unavailable / invalid) and the reference for what a briefing must
 * never contradict: every line here is a direct statement of a computed fact.
 */
export function fallbackBriefing(changeSet: ChangeSet): Briefing {
  const {
    isFirstCheck,
    decisionChanges,
    cplMoves,
    newlyDelivering,
    stoppedDelivering,
    campaignsCompleted,
    winnerStreaks,
    snapshots,
    totals,
  } = changeSet

  const whatChanged: string[] = []
  // The one-time farewell leads the news: a finished campaign is bigger news
  // than any single ad's move, and it never generates an action — its ads no
  // longer exist as live things to act on.
  for (const f of campaignsCompleted) {
    const t = f.totals
    const winnerBit =
      f.winners.length > 0
        ? ` Best performer: ${f.winners
            .map((w) => `${creativeLabel(w)} at ${w.cpl} per lead`)
            .join('; ')}.`
        : ''
    whatChanged.push(
      `${f.campaignName ?? 'A campaign'} has finished its scheduled run — ` +
        `final position: ${t.winner} winner(s), ${t.needsMoreTime} still proving out, ` +
        `${t.turnOff} past acceptable cost.${winnerBit} Nothing to action — it's done.`,
    )
  }
  for (const c of decisionChanges) {
    const verb = c.direction === 'improved' ? 'improved to' : 'slipped to'
    whatChanged.push(
      `${creativeLabel(c)} ${verb} ${DECISION_WORD[c.to ?? ''] ?? c.to} ` +
        `(cost per lead now ${c.cplNow}${c.cplBefore ? `, was ${c.cplBefore}` : ''}).`,
    )
  }
  for (const m of cplMoves) {
    const dir = m.direction === 'up' ? 'rose' : 'fell'
    whatChanged.push(
      `${creativeLabel(m)} cost per lead ${dir} ${m.deltaDisplay} (${m.before} → ${m.now}).`,
    )
  }
  for (const c of newlyDelivering) {
    whatChanged.push(`${creativeLabel(c)} started delivering.`)
  }
  for (const c of stoppedDelivering) {
    whatChanged.push(`${creativeLabel(c)} stopped delivering.`)
  }

  // ACTION sections are routed by each ad's CURRENT verdict, mutually exclusively —
  // an ad lands in EXACTLY ONE of Do today / Keep an eye on / Leave running:
  //   turn_off                                   → Do today (act now)
  //   needs_more_time & drifting above target    → Keep an eye on (running, not yet
  //                                                 past the turn-off line)
  //   winner (on target) / still gathering       → Leave running
  // A TURN OFF ad therefore NEVER appears under "Keep an eye on".
  const watch: string[] = []
  const leaveAlone: string[] = []
  const doToday: string[] = []
  const streakByRow = new Map(winnerStreaks.map((s) => [s.rowId, s]))

  for (const s of snapshots) {
    if (!s.evaluated || s.decision === null) continue
    const label = creativeLabel(s)
    if (s.decision === 'turn_off') {
      doToday.push(
        `${label} is past your acceptable cost per lead (${s.cpl.display}). ` +
          `Prepare a replacement and swap it in rather than turning it off cold.`,
      )
    } else if (
      s.decision === 'needs_more_time' &&
      s.reason === 'cpl_within_acceptable'
    ) {
      watch.push(
        `${label} is drifting above your target cost per lead (now ${s.cpl.display}), ` +
          `but hasn't crossed the turn-off line — keep an eye on it.`,
      )
    } else if (s.decision === 'winner') {
      const streak = streakByRow.get(s.rowId)
      const tail =
        streak && streak.checks >= 3
          ? ` It's led for ${streak.checks} checks — consider a fresh variation on the same hook.`
          : ''
      leaveAlone.push(
        `${label} is on target (cost per lead ${s.cpl.display}) — leave it running.${tail}`,
      )
    } else {
      // A keep-on ad still gathering evidence (not enough spend / no leads yet).
      leaveAlone.push(
        `${label} is still proving out — leave it running to gather more data.`,
      )
    }
  }

  const changed = whatChanged.length > 0
  const hasAction = doToday.length > 0

  let headline: string
  if (isFirstCheck) {
    headline =
      `Here's your first Daily Ad Check — ${totals.winner} winner(s), ` +
      `${totals.needsMoreTime} still proving out, ${totals.turnOff} to turn off. ` +
      `Tomorrow's check will compare against today.`
  } else if (!changed && !hasAction) {
    headline = 'Nothing meaningful changed today — leave everything running.'
  } else if (!changed && hasAction) {
    const n = doToday.length
    headline =
      `No change since your last check, but ${n} ad${n === 1 ? '' : 's'} ` +
      `still need${n === 1 ? 's' : ''} action today.`
  } else {
    const n = whatChanged.length
    headline = `${n} update${n === 1 ? '' : 's'} since your last check.`
  }

  if (doToday.length === 0) {
    doToday.push('Nothing to do today — check back tomorrow.')
  }

  return { headline, whatChanged, watch, leaveAlone, doToday }
}
