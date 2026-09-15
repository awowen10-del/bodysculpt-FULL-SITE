/**
 * Deterministic RAW Meta-shaped daily-insight generator (Stage 10, Phase 1).
 *
 * ⚠️ Every value produced here is INVENTED, ILLUSTRATIVE SEED DATA — see the
 * header of `profiles.ts`. It is not real performance and not a benchmark.
 *
 * Given the 12 ad profiles and the 14 seed dates, this emits one raw insight row
 * per (ad, day) = 168 rows, in the SAME shape Meta's Marketing API returns:
 * string-encoded scalars and `list<AdsActionStats>` arrays of `{action_type,
 * value}`. `buildSeedDataset.ts` then feeds these straight through the real
 * `normalize.ts` layer — this module hand-rolls no normalisation of its own.
 *
 * DETERMINISM: day-to-day variation comes from `wobble()`, a pure integer hash of
 * (adIndex, dayIndex). There is no `Math.random` and no wall-clock input, so the
 * output is byte-identical on every run. A "dark day" (see `AdProfile.darkDays`)
 * emits a genuine zero row with `reach`/ratios ABSENT, giving the dashboard real
 * data behind its "—" undefined states.
 *
 * Pure DATA transform: no network, no database, no server-only imports.
 */
import type { AdProfile } from './profiles.ts'
import { AD_PROFILES, seedDates } from './profiles.ts'

/** The seed account node id — matches `fixtures/adAccounts.json`. */
const SEED_ACCOUNT_ID = 'act_SEED_0001'
/** A fixed, plausible attribution window stamped on every delivering row. */
const SEED_ATTRIBUTION_SETTING = '7d_click'

type RawInsight = Record<string, unknown>
type ActionStat = { action_type: string; value: string }

/**
 * Pure deterministic pseudo-value in [0, 1) from two small integers. Uses
 * `Math.imul` mixing (32-bit, deterministic across engines) — deliberately NOT
 * `Math.random`, so the whole dataset is reproducible.
 */
export function wobble(a: number, b: number): number {
  let h = Math.imul(a + 1, 2654435761) ^ Math.imul(b + 1, 1597334677)
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

function roundInt(n: number): number {
  return Math.max(0, Math.round(n))
}

/** Whole pence → major-unit decimal string with 2 places (e.g. 1234 → "12.34"). */
function pence(major: number): string {
  return (major / 100).toFixed(2)
}

/** A single-entry action-stat array (how Meta wraps per-action scalars). */
function stat(actionType: string, value: string): ActionStat[] {
  return [{ action_type: actionType, value }]
}

/** A zero-delivery ("dark") day: real row, zeros, `reach`/ratios deliberately absent. */
function darkRow(profile: AdProfile, date: string): RawInsight {
  return {
    date_start: date,
    date_stop: date,
    account_id: SEED_ACCOUNT_ID,
    campaign_id: profile.campaignId,
    adset_id: profile.adSetId,
    ad_id: profile.adId,
    spend: '0.00',
    impressions: '0',
    clicks: '0',
    inline_link_clicks: '0',
    actions: [],
    attribution_setting: SEED_ATTRIBUTION_SETTING,
  }
}

function leadsFields(
  profile: AdProfile,
  impressions: number,
  inlineLinkClicks: number,
  spendMajor: number,
): RawInsight {
  const native = roundInt((impressions / 1000) * profile.nativeLeadsPerMille)
  const website = roundInt((impressions / 1000) * profile.websiteLeadsPerMille)
  const landingPageViews = roundInt(inlineLinkClicks * 0.8)
  const totalLeads = native + website

  const actions: ActionStat[] = []
  if (inlineLinkClicks > 0) {
    actions.push({ action_type: 'link_click', value: String(inlineLinkClicks) })
  }
  if (landingPageViews > 0) {
    actions.push({
      action_type: 'landing_page_view',
      value: String(landingPageViews),
    })
  }
  if (native > 0) {
    actions.push({
      action_type: 'onsite_conversion.lead_grouped',
      value: String(native),
    })
  }
  if (website > 0) {
    actions.push({
      action_type: 'offsite_conversion.fb_pixel_lead',
      value: String(website),
    })
  }
  if (totalLeads > 0) {
    // Meta's generic roll-up aggregate; components are also present above.
    actions.push({ action_type: 'lead', value: String(totalLeads) })
  }

  const fields: RawInsight = { actions }
  if (totalLeads > 0) {
    fields.cost_per_action_type = stat(
      'lead',
      (spendMajor / totalLeads).toFixed(6),
    )
    fields.action_values = stat(
      'offsite_conversion.fb_pixel_lead',
      (website * 25).toFixed(2),
    )
  }
  return fields
}

function trafficFields(
  impressions: number,
  inlineLinkClicks: number,
  spendMajor: number,
): RawInsight {
  const outbound = roundInt(inlineLinkClicks * 0.92)
  const landingPageViews = roundInt(inlineLinkClicks * 0.85)

  const actions: ActionStat[] = []
  if (inlineLinkClicks > 0) {
    actions.push({ action_type: 'link_click', value: String(inlineLinkClicks) })
  }
  if (landingPageViews > 0) {
    actions.push({
      action_type: 'landing_page_view',
      value: String(landingPageViews),
    })
  }

  const fields: RawInsight = { actions }
  if (outbound > 0) {
    fields.outbound_clicks = stat('outbound_click', String(outbound))
    fields.outbound_clicks_ctr = stat(
      'outbound_click',
      ((outbound / impressions) * 100).toFixed(6),
    )
    fields.cost_per_outbound_click = stat(
      'outbound_click',
      (spendMajor / outbound).toFixed(6),
    )
  }
  return fields
}

function awarenessFields(
  profile: AdProfile,
  impressions: number,
  inlineLinkClicks: number,
  spendMajor: number,
  w: number,
): RawInsight {
  const plays = roundInt(impressions * profile.videoStartShare)
  const p25 = roundInt(plays * 0.7)
  const p50 = roundInt(plays * 0.45)
  const p75 = roundInt(plays * 0.3)
  const p95 = roundInt(plays * 0.18)
  const p100 = roundInt(plays * 0.12)

  const actions: ActionStat[] = []
  if (plays > 0)
    actions.push({ action_type: 'video_view', value: String(plays) })
  if (inlineLinkClicks > 0) {
    actions.push({ action_type: 'link_click', value: String(inlineLinkClicks) })
  }

  const fields: RawInsight = { actions }
  if (plays > 0) {
    fields.video_play_actions = stat('video_view', String(plays))
    fields.video_p25_watched_actions = stat('video_view', String(p25))
    fields.video_p50_watched_actions = stat('video_view', String(p50))
    fields.video_p75_watched_actions = stat('video_view', String(p75))
    fields.video_p95_watched_actions = stat('video_view', String(p95))
    fields.video_p100_watched_actions = stat('video_view', String(p100))
    fields.video_avg_time_watched_actions = stat(
      'video_view',
      (6 + 4 * w).toFixed(2),
    )
    fields.cost_per_thruplay = stat(
      'video_view',
      (spendMajor / Math.max(1, p100)).toFixed(6),
    )
  }
  return fields
}

/** Build one delivering (non-dark) raw insight row for an ad on a date. */
function deliveringRow(
  profile: AdProfile,
  adIndex: number,
  dayIndex: number,
  date: string,
): RawInsight {
  const w1 = wobble(adIndex, dayIndex)
  const w2 = wobble(adIndex, dayIndex + 100)

  const impressions = Math.max(
    1,
    roundInt(profile.baseImpressions * (0.75 + 0.5 * w1)),
  )
  const reach = Math.min(
    impressions,
    Math.max(1, roundInt(impressions * profile.reachRatio)),
  )
  const spendPence = roundInt(profile.baseSpendPence * (0.8 + 0.4 * w2))
  const spendMajor = spendPence / 100
  const clicks = roundInt((impressions / 1000) * profile.clicksPerMille)
  const inlineLinkClicks = roundInt(clicks * profile.linkClickShare)

  const row: RawInsight = {
    date_start: date,
    date_stop: date,
    account_id: SEED_ACCOUNT_ID,
    campaign_id: profile.campaignId,
    adset_id: profile.adSetId,
    ad_id: profile.adId,
    spend: pence(spendPence),
    impressions: String(impressions),
    reach: String(reach),
    frequency: (impressions / reach).toFixed(6),
    clicks: String(clicks),
    cpm: ((spendMajor / impressions) * 1000).toFixed(6),
    ctr: clicks > 0 ? ((clicks / impressions) * 100).toFixed(6) : '0',
    inline_link_clicks: String(inlineLinkClicks),
    inline_link_click_ctr:
      inlineLinkClicks > 0
        ? ((inlineLinkClicks / impressions) * 100).toFixed(6)
        : '0',
    attribution_setting: SEED_ATTRIBUTION_SETTING,
  }
  if (clicks > 0) row.cpc = (spendMajor / clicks).toFixed(6)
  if (inlineLinkClicks > 0) {
    row.cost_per_inline_link_click = (spendMajor / inlineLinkClicks).toFixed(6)
  }

  let extra: RawInsight
  if (profile.family === 'leads') {
    extra = leadsFields(profile, impressions, inlineLinkClicks, spendMajor)
  } else if (profile.family === 'traffic') {
    extra = trafficFields(impressions, inlineLinkClicks, spendMajor)
  } else {
    extra = awarenessFields(
      profile,
      impressions,
      inlineLinkClicks,
      spendMajor,
      w1,
    )
  }
  return { ...row, ...extra }
}

/**
 * The full grid of raw insight rows: one per (ad, day), oldest day first, ads in
 * `AD_PROFILES` order. Length is exactly `AD_PROFILES.length * SEED_DAYS` (168).
 */
export function generateRawInsights(): RawInsight[] {
  const dates = seedDates()
  const rows: RawInsight[] = []
  AD_PROFILES.forEach((profile, adIndex) => {
    dates.forEach((date, dayIndex) => {
      rows.push(
        profile.darkDays.includes(dayIndex)
          ? darkRow(profile, date)
          : deliveringRow(profile, adIndex, dayIndex, date),
      )
    })
  })
  return rows
}
