/**
 * Commercial creative decision engine.
 *
 * Replaces the former peer-benchmarked scoring (Strong/Typical/Weak + confidence)
 * with the single question an experienced media buyer actually asks each morning:
 * do we have enough commercial evidence, and if so, is this creative profitable?
 * The answer is exactly one of three recommendations:
 *
 *   · KEEP ON — WINNER            (profitable: CPL at or below target)
 *   · KEEP ON — NEEDS MORE TIME   (not enough evidence yet, or acceptable-but-unproven)
 *   · TURN OFF                    (enough evidence and commercially unprofitable)
 *
 * The hierarchy is strict and commercial results ALWAYS win:
 *   1. Below Minimum Evaluation Spend → NEEDS MORE TIME (whatever the leads/CTR).
 *   2. Zero leads at/above Maximum Zero-Lead Spend → TURN OFF (overrides all).
 *   3. Otherwise decide on Cost Per Lead vs Target / Maximum Acceptable.
 *
 * Link CTR is an EXPLANATION metric only — it can never turn off a profitable ad,
 * nor save an unprofitable one. Every comparison is exact bigint arithmetic; the
 * engine is pure, total and deterministic (same metrics → same recommendation).
 */
import type { Metric, MetricAvailable } from './types.ts'
import type {
  CommercialDecisionSettings,
  LinkCtrRating,
  ObjectiveFamily,
} from './decisionConfig.ts'
import { ACTIVE_DECISION_SETTINGS, formatMinor } from './decisionConfig.ts'
import { formatMetric } from './format.ts'

/** The three commercial recommendations. No score, no bands. */
export type CommercialDecision = 'winner' | 'needs_more_time' | 'turn_off'

/**
 * Why a decision was reached. Closed set — the UI maps each to copy, and it is the
 * audit trail for a recommendation.
 */
export type DecisionReason =
  | 'below_min_spend'
  | 'gathering_no_leads_yet'
  | 'zero_leads_over_budget'
  | 'cpl_at_or_below_target'
  | 'cpl_within_acceptable'
  | 'cpl_above_max'
  | 'leads_unresolved'
  | 'currency_mismatch'

/** The resolved analysis window a creative was judged over. */
export interface AnalysisWindow {
  start: string
  end: string
  days: number
}

/** The exact metrics a decision is made from (already aggregated, exact). */
export interface DecisionInput {
  spend: Metric
  leads: Metric
  cpl: Metric
  linkCtr: Metric
}

/** A two-part, plain-English explanation, derived deterministically. */
export interface DecisionNarrative {
  /** One or two short sentences: the commercial reason (+ optional Link CTR note). */
  explanation: string
  /** The single next action to take. */
  nextAction: string
}

/** A fully computed commercial decision for one creative (domain form). */
export interface CreativeDecision {
  decision: CommercialDecision
  reason: DecisionReason
  /** Explanation-only Link CTR rating; null when Link CTR is unavailable. */
  linkCtrRating: LinkCtrRating | null
  /** The decision-driving metrics, carried so they survive list-response slimming. */
  spend: Metric
  leads: Metric
  cpl: Metric
  linkCtr: Metric
  cohort: { objectiveFamily: ObjectiveFamily | null; optimizationEvent: string }
  window: AnalysisWindow
  narrative: DecisionNarrative
  settingsVersion: string
}

// --- exact comparison helpers -------------------------------------------------

function isAvailable(metric: Metric): metric is MetricAvailable {
  return metric.status === 'available'
}

/**
 * Sign of (money metric − threshold), where the threshold is `minor/100` major
 * units. `n/d − minor/100` has the sign of `n*100 − minor*d` (d > 0). Exact.
 */
function compareMoneyToMinor(m: MetricAvailable, minor: bigint): number {
  const lhs = m.numerator * 100n
  const rhs = minor * m.denominator
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0
}

/**
 * Rate the Link CTR. The percent metric stores a FRACTION (link clicks ÷
 * impressions); basis points = fraction × 10000. `fraction ≥ bp/10000` ⇔
 * `numerator*10000 ≥ bp*denominator` (exact bigint).
 */
export function rateLinkCtr(
  linkCtr: Metric,
  settings: CommercialDecisionSettings = ACTIVE_DECISION_SETTINGS,
): LinkCtrRating | null {
  if (!isAvailable(linkCtr)) return null
  const atLeast = (bp: number): boolean =>
    linkCtr.numerator * 10_000n >= BigInt(bp) * linkCtr.denominator
  if (atLeast(settings.linkCtr.excellentMinBasisPoints)) return 'Excellent'
  if (atLeast(settings.linkCtr.goodMinBasisPoints)) return 'Good'
  if (atLeast(settings.linkCtr.weakMinBasisPoints)) return 'Weak'
  return 'Poor'
}

// --- decision -----------------------------------------------------------------

const LABEL_TEXT: Record<CommercialDecision, string> = {
  winner: 'KEEP ON — WINNER',
  needs_more_time: 'KEEP ON — NEEDS MORE TIME',
  turn_off: 'TURN OFF',
}

/** The human label for a decision, e.g. "KEEP ON — WINNER". */
export function decisionLabel(decision: CommercialDecision): string {
  return LABEL_TEXT[decision]
}

/**
 * Decide what to do with one creative from its exact aggregated metrics. Follows
 * the strict commercial hierarchy above; Link CTR never affects the outcome.
 */
export function decideCreative(
  input: DecisionInput,
  window: AnalysisWindow,
  cohort: {
    objectiveFamily: ObjectiveFamily | null
    optimizationEvent: string
  },
  settings: CommercialDecisionSettings = ACTIVE_DECISION_SETTINGS,
): CreativeDecision {
  const linkCtrRating = rateLinkCtr(input.linkCtr, settings)

  const finish = (
    decision: CommercialDecision,
    reason: DecisionReason,
  ): CreativeDecision => ({
    decision,
    reason,
    linkCtrRating,
    spend: input.spend,
    leads: input.leads,
    cpl: input.cpl,
    linkCtr: input.linkCtr,
    cohort,
    window,
    settingsVersion: settings.version,
    narrative: buildNarrative(decision, reason, linkCtrRating, input, settings),
  })

  // Currency guard: thresholds are only meaningful in their own currency.
  if (
    isAvailable(input.spend) &&
    input.spend.currency !== null &&
    input.spend.currency !== settings.currency
  ) {
    return finish('needs_more_time', 'currency_mismatch')
  }

  // STEP 1 — enough money spent to judge? Absent spend (no delivery) counts as £0,
  // which is below any positive minimum, so it lands here too.
  const belowMinSpend =
    !isAvailable(input.spend) ||
    compareMoneyToMinor(input.spend, settings.minEvaluationSpendMinor) < 0
  if (belowMinSpend) {
    return finish('needs_more_time', 'below_min_spend')
  }

  // Past the evaluation gate. We now need a trustworthy lead count.
  if (!isAvailable(input.leads)) {
    // Meta did not report a canonical lead total for part of the window; we never
    // invent one, and never turn an ad off without evidence.
    return finish('needs_more_time', 'leads_unresolved')
  }
  const leadCount = input.leads.numerator

  // STEP 2 — zero leads. Turning off requires crossing the zero-lead ceiling;
  // below it we keep gathering. This rule overrides Link CTR entirely.
  if (leadCount === 0n) {
    const atOrOverCeiling =
      isAvailable(input.spend) &&
      compareMoneyToMinor(input.spend, settings.maxZeroLeadSpendMinor) >= 0
    return atOrOverCeiling
      ? finish('turn_off', 'zero_leads_over_budget')
      : finish('needs_more_time', 'gathering_no_leads_yet')
  }

  // STEP 3/4 — leads exist, so Cost Per Lead is the decision metric.
  if (!isAvailable(input.cpl)) {
    // Defensive: leads > 0 and spend present should always yield an available CPL.
    return finish('needs_more_time', 'leads_unresolved')
  }
  if (compareMoneyToMinor(input.cpl, settings.targetCplMinor) <= 0) {
    return finish('winner', 'cpl_at_or_below_target')
  }
  if (compareMoneyToMinor(input.cpl, settings.maxAcceptableCplMinor) <= 0) {
    return finish('needs_more_time', 'cpl_within_acceptable')
  }
  return finish('turn_off', 'cpl_above_max')
}

// --- narrative (deterministic plain English) ----------------------------------

/**
 * A short Link CTR sentence for the explanation. EXPLANATION ONLY — it never
 * changes the decision; it only helps the owner understand a decision already
 * made. Phrasing depends on the rating and the decision so it reads naturally
 * (e.g. Excellent CTR on a TURN OFF means "clicking but not converting").
 */
function linkCtrNote(
  rating: LinkCtrRating | null,
  decision: CommercialDecision,
): string {
  if (rating === null) return ''
  const profitable = decision === 'winner'
  switch (rating) {
    case 'Excellent':
      return decision === 'turn_off'
        ? ' Link CTR is Excellent, so people are clicking but not converting.'
        : ' Link CTR is Excellent, showing the creative is attracting quality traffic.'
    case 'Good':
      return ' Link CTR is Good, showing the creative is attracting quality traffic.'
    case 'Weak':
      return profitable
        ? ' Link CTR is Weak, but the people who click are converting efficiently.'
        : ' Link CTR is Weak, so it is also struggling to attract qualified clicks.'
    case 'Poor':
      return profitable
        ? ' Link CTR is Poor, but the few who click convert efficiently.'
        : ' Link CTR is Poor, so few clicks are reaching the lead form.'
  }
}

function buildNarrative(
  decision: CommercialDecision,
  reason: DecisionReason,
  rating: LinkCtrRating | null,
  input: DecisionInput,
  settings: CommercialDecisionSettings,
): DecisionNarrative {
  const spend = formatMetric(input.spend)
  const cpl = formatMetric(input.cpl)
  const target = formatMinor(settings.targetCplMinor, settings)
  const maxCpl = formatMinor(settings.maxAcceptableCplMinor, settings)
  const minEval = formatMinor(settings.minEvaluationSpendMinor, settings)
  const maxZero = formatMinor(settings.maxZeroLeadSpendMinor, settings)
  const note = linkCtrNote(rating, decision)

  switch (reason) {
    case 'below_min_spend':
      return {
        explanation:
          `The creative has spent ${spend}, below the ${minEval} evaluation spend, ` +
          `so there isn't enough evidence to judge it yet.${note}`,
        nextAction: 'Allow more data before judging performance.',
      }
    case 'gathering_no_leads_yet':
      return {
        explanation:
          `It has reached the evaluation spend but has no leads yet, and is still ` +
          `within the ${maxZero} zero-lead allowance.`,
        nextAction: `Keep watching — turn off if it passes ${maxZero} with no lead.`,
      }
    case 'zero_leads_over_budget':
      return {
        explanation:
          `The creative has spent ${spend} without generating a single lead, past ` +
          `the ${maxZero} zero-lead limit.${note}`,
        nextAction:
          'Replace the creative or investigate the offer or lead form.',
      }
    case 'cpl_at_or_below_target':
      return {
        explanation:
          `Cost per lead of ${cpl} is at or below your ${target} target, so the ` +
          `creative is generating profitable leads.${note}`,
        nextAction:
          'Keep this creative running; consider scaling budget or making more like it.',
      }
    case 'cpl_within_acceptable':
      return {
        explanation:
          `Cost per lead of ${cpl} sits between your ${target} target and ${maxCpl} ` +
          `maximum acceptable level, so it is worth continuing but hasn't proven itself.${note}`,
        nextAction:
          'Continue running and gather more evidence before a final decision.',
      }
    case 'cpl_above_max':
      return {
        explanation:
          `Cost per lead of ${cpl} is above your ${maxCpl} maximum acceptable ` +
          `level, so the creative is commercially unprofitable.${note}`,
        nextAction: 'Replace the creative.',
      }
    case 'leads_unresolved':
      return {
        explanation:
          `It has reached the evaluation spend, but Meta hasn't reported a canonical ` +
          `lead count for part of this period, so cost per lead can't be trusted yet.`,
        nextAction: 'Allow more data, and check lead tracking is reporting.',
      }
    case 'currency_mismatch':
      return {
        explanation:
          `This creative's spend is in a different currency to your decision ` +
          `settings, so it can't be judged against your thresholds yet.`,
        nextAction: 'Set the decision currency to match the ad account.',
      }
  }
}
