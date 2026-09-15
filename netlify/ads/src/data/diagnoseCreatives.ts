/**
 * Safe read-path diagnostics for the Creative Intelligence screen (Phase 0).
 *
 * Given a materialised `DashboardDataset`, run the EXACT engine the dashboard runs
 * (`createDatasetRepository()`), for a SPECIFIC window, and report only SAFE
 * aggregate signals about the path from stored rows to card props: counts,
 * booleans, dates and closed-set enums. It NEVER emits an id, name, url, headline,
 * body, token, connection detail or raw metric value.
 *
 * Crucially it can be run for ANY window, so the CLI compares the FULL data extent
 * against the SERVER'S DEFAULT WINDOW (the 14-day window the deployed dashboard
 * actually uses) — the difference is what a fixtures-only test could not see.
 *
 * Pure and transport-free: it takes an already-materialised dataset, so it is
 * unit-testable against a PGlite-materialised graph with no live database.
 */
import type { DashboardDataset } from './datasetRepository.ts'
import { createDatasetRepository } from './datasetRepository.ts'
import { isPositiveMetric } from './dto.ts'
import type { CampaignDTO, CreativeRowDTO } from './dto.ts'
import type { PreviewSource } from './creativeContent.ts'
import { creativeRowDtoSchema } from './apiSchemas.ts'
import { insightHasDelivery } from './creativeAssembly.ts'
import type {
  CommercialDecision,
  DecisionReason,
  Eligibility,
} from '../metrics/index.ts'

const PREVIEW_SOURCES: readonly PreviewSource[] = [
  'image_asset',
  'video_thumbnail',
  'asset_feed',
  'creative_thumbnail',
  'page_profile_fallback',
  'unavailable',
]

/** An inclusive window to diagnose (defaults to the dataset's full extent). */
export interface DiagnoseRange {
  start: string
  end: string
}

const DECISIONS: readonly CommercialDecision[] = [
  'winner',
  'needs_more_time',
  'turn_off',
]

const REASONS: readonly DecisionReason[] = [
  'below_min_spend',
  'gathering_no_leads_yet',
  'zero_leads_over_budget',
  'cpl_at_or_below_target',
  'cpl_within_acceptable',
  'cpl_above_max',
  'leads_unresolved',
  'currency_mismatch',
]

const ELIGIBILITIES: readonly Eligibility[] = [
  'eligible',
  'unsupported_objective',
  'unconfirmed_lead_objective',
]

/** Every field is a count, a boolean-derived count, a date, or a closed enum. */
export interface CreativeDiagnostics {
  window: { start: string; end: string }
  insightRows: number
  distinctDeliveryDates: number
  uniqueAdsInInsights: number
  campaigns: number
  ads: number
  adsWithCreative: number
  creatives: number
  creativesWithMatchedRows: number
  creativesDelivering: number
  present: {
    spend: number
    videoActivity: number
    preview: number
    videoId: number
    objectiveResolved: number
    lastDelivery: number
    adName: number
    adSetName: number
    campaignName: number
    primaryText: number
    headline: number
    description: number
    cta: number
  }
  /** How many creatives resolved each preview source (weak fallback visible). */
  previewSources: Record<PreviewSource, number>
  dtoPopulated: {
    imageUrl: number
    thumbnailUrl: number
    videoId: number
    headline: number
    primaryText: number
    cplAvailable: number
    linkCtrRated: number
  }
  /** How many creatives resolved each eligibility state (scope gate). */
  eligibilityCounts: Record<Eligibility, number>
  /** Creatives the lead engine actually judged (eligibility === 'eligible'). */
  eligibleCreatives: number
  /** Decision / reason counts are over the EVALUATED (eligible) creatives only. */
  decisionCounts: Record<CommercialDecision, number>
  reasonCounts: Record<DecisionReason, number>
  cohorts: number
}

/** Campaign-level safe signals (status + delivery + dates only). */
export interface CampaignDiagnostics {
  window: { start: string; end: string }
  total: number
  active: number
  paused: number
  otherStatus: number
  deliveredInWindow: number
  activeAndDelivering: number
  withLatestDeliveryDate: number
  earliestLastDelivery: string | null
  latestLastDelivery: string | null
}

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>
  for (const key of keys) out[key] = 0
  return out
}

const hasVideoActivity = (row: CreativeRowDTO): boolean =>
  isPositiveMetric(row.metrics.videoPlays) ||
  isPositiveMetric(row.metrics.videoP75)

const delivered = (row: CreativeRowDTO): boolean =>
  isPositiveMetric(row.metrics.spend) ||
  isPositiveMetric(row.metrics.impressions) ||
  isPositiveMetric(row.metrics.clicks) ||
  hasVideoActivity(row)

function fullExtent(dataset: DashboardDataset): DiagnoseRange {
  return { start: dataset.meta.startDate, end: dataset.meta.endDate }
}

/** Run the dashboard engine over a dataset+window and derive safe signals. */
export async function diagnoseCreatives(
  dataset: DashboardDataset,
  range: DiagnoseRange = fullExtent(dataset),
): Promise<CreativeDiagnostics> {
  const repo = createDatasetRepository(dataset)
  const rows = await repo.listCreatives({ start: range.start, end: range.end })

  const inWindow = dataset.insights.filter(
    (i) => i.date >= range.start && i.date <= range.end,
  )
  const deliveryDates = new Set(
    inWindow
      .filter((i) => i.impressions !== null || i.spend !== null)
      .map((i) => i.date),
  )
  const adIdsInInsights = new Set(inWindow.map((i) => i.metaAdId))

  const decisionCounts = zeroed(DECISIONS)
  const reasonCounts = zeroed(REASONS)
  const eligibilityCounts = zeroed(ELIGIBILITIES)
  const cohortKeys = new Set<string>()
  const present = {
    spend: 0,
    videoActivity: 0,
    preview: 0,
    videoId: 0,
    objectiveResolved: 0,
    lastDelivery: 0,
    adName: 0,
    adSetName: 0,
    campaignName: 0,
    primaryText: 0,
    headline: 0,
    description: 0,
    cta: 0,
  }
  const previewSources = zeroed(PREVIEW_SOURCES)
  const dtoPopulated = {
    imageUrl: 0,
    thumbnailUrl: 0,
    videoId: 0,
    headline: 0,
    primaryText: 0,
    cplAvailable: 0,
    linkCtrRated: 0,
  }
  let creativesWithMatchedRows = 0
  let creativesDelivering = 0
  let eligibleCreatives = 0

  for (const row of rows) {
    const { evaluation, creative } = row
    eligibilityCounts[evaluation.eligibility] += 1

    // Decision / reason / CPL / CTR signals are only meaningful for EVALUATED
    // (eligible) lead creatives — an out-of-scope creative is never judged.
    if (evaluation.eligibility === 'eligible') {
      eligibleCreatives += 1
      const { decision } = evaluation
      decisionCounts[decision.decision] += 1
      reasonCounts[decision.reason] += 1
      if (decision.cpl.available) dtoPopulated.cplAvailable += 1
      if (decision.linkCtrRating !== null) dtoPopulated.linkCtrRated += 1
    }

    const objective = evaluation.objective
    const objectiveResolved = objective.objectiveFamily !== null
    if (
      objectiveResolved &&
      objective.optimizationEvent !== null &&
      objective.optimizationEvent !== ''
    ) {
      cohortKeys.add(
        `${objective.objectiveFamily}::${objective.optimizationEvent}`,
      )
    }

    if (row.metrics.spend.available) creativesWithMatchedRows += 1
    if (delivered(row)) creativesDelivering += 1
    if (isPositiveMetric(row.metrics.spend)) present.spend += 1
    if (hasVideoActivity(row)) present.videoActivity += 1
    if (creative.previewUrl !== null) present.preview += 1
    if (creative.videoId !== null) present.videoId += 1
    if (objectiveResolved) present.objectiveResolved += 1
    if (row.latestDeliveryDate !== null) present.lastDelivery += 1
    if (row.context.adName !== null) present.adName += 1
    if (row.context.adSetName !== null) present.adSetName += 1
    if (row.context.campaignName !== null) present.campaignName += 1
    if (creative.primaryText !== null) present.primaryText += 1
    if (creative.headline !== null) present.headline += 1
    if (creative.description !== null) present.description += 1
    if (creative.ctaType !== null) present.cta += 1
    previewSources[creative.previewSource] += 1

    if (creative.imageUrl !== null) dtoPopulated.imageUrl += 1
    if (creative.thumbnailUrl !== null) dtoPopulated.thumbnailUrl += 1
    if (creative.videoId !== null) dtoPopulated.videoId += 1
    if (creative.headline !== null) dtoPopulated.headline += 1
    if (creative.primaryText !== null) dtoPopulated.primaryText += 1
  }

  return {
    window: { start: range.start, end: range.end },
    insightRows: inWindow.length,
    distinctDeliveryDates: deliveryDates.size,
    uniqueAdsInInsights: adIdsInInsights.size,
    campaigns: dataset.campaigns.length,
    ads: dataset.ads.length,
    adsWithCreative: dataset.ads.filter((a) => a.metaCreativeId !== null)
      .length,
    creatives: dataset.creatives.length,
    creativesWithMatchedRows,
    creativesDelivering,
    present,
    previewSources,
    dtoPopulated,
    eligibilityCounts,
    eligibleCreatives,
    decisionCounts,
    reasonCounts,
    cohorts: cohortKeys.size,
  }
}

function campaignActive(c: CampaignDTO): boolean {
  const status = (c.effectiveStatus ?? c.status ?? '').toUpperCase()
  return status === 'ACTIVE'
}

function campaignPaused(c: CampaignDTO): boolean {
  const status = (c.effectiveStatus ?? c.status ?? '').toUpperCase()
  return status.includes('PAUSED')
}

function campaignDelivered(c: CampaignDTO): boolean {
  return (
    isPositiveMetric(c.metrics.spend) || isPositiveMetric(c.metrics.impressions)
  )
}

/** Campaign-level safe signals for the same window the dashboard shows. */
export async function diagnoseCampaigns(
  dataset: DashboardDataset,
  range: DiagnoseRange = fullExtent(dataset),
): Promise<CampaignDiagnostics> {
  const repo = createDatasetRepository(dataset)
  const campaigns = await repo.listCampaigns({
    start: range.start,
    end: range.end,
  })

  const dates = campaigns
    .map((c) => c.latestDeliveryDate)
    .filter((d): d is string => d !== null)
    .sort((a, b) => a.localeCompare(b))

  return {
    window: { start: range.start, end: range.end },
    total: campaigns.length,
    active: campaigns.filter(campaignActive).length,
    paused: campaigns.filter(campaignPaused).length,
    otherStatus: campaigns.filter(
      (c) => !campaignActive(c) && !campaignPaused(c),
    ).length,
    deliveredInWindow: campaigns.filter(campaignDelivered).length,
    activeAndDelivering: campaigns.filter(
      (c) => campaignActive(c) && campaignDelivered(c),
    ).length,
    withLatestDeliveryDate: dates.length,
    earliestLastDelivery: dates.length > 0 ? dates[0] : null,
    latestLastDelivery: dates.length > 0 ? dates[dates.length - 1] : null,
  }
}

/** Render the creative diagnostics as aligned, secret-free terminal lines. */
export function formatCreativeDiagnostics(
  d: CreativeDiagnostics,
  title: string,
): string {
  const rowsProduced =
    d.eligibilityCounts.eligible +
    d.eligibilityCounts.unsupported_objective +
    d.eligibilityCounts.unconfirmed_lead_objective
  const windowLabel =
    d.window.start === '' ? '(no data)' : `${d.window.start} .. ${d.window.end}`
  return [
    `${title}   window: ${windowLabel}`,
    `  insight rows in window:     ${d.insightRows}`,
    `  distinct delivery dates:    ${d.distinctDeliveryDates}`,
    `  unique ads in window:       ${d.uniqueAdsInInsights}`,
    `  ads with a creative:        ${d.adsWithCreative} / ${d.ads}`,
    `  creative rows produced:     ${rowsProduced}`,
    `  eligible (evaluated) leads: ${d.eligibleCreatives}`,
    `  with matched insight rows:  ${d.creativesWithMatchedRows}`,
    `  delivering (any signal):    ${d.creativesDelivering}`,
    `  spend present:              ${d.present.spend}`,
    `  video activity present:     ${d.present.videoActivity}`,
    `  preview present:            ${d.present.preview}`,
    `  video id present:           ${d.present.videoId}`,
    `  objective resolved:         ${d.present.objectiveResolved}`,
    `  last delivery populated:    ${d.present.lastDelivery}`,
    `  objective cohorts:          ${d.cohorts}`,
    `  CPL available / CTR rated:  ${d.dtoPopulated.cplAvailable} / ${d.dtoPopulated.linkCtrRated}`,
    `  identity — ad name:         ${d.present.adName}`,
    `  identity — ad set name:     ${d.present.adSetName}`,
    `  identity — campaign name:   ${d.present.campaignName}`,
    `  copy — primary text:        ${d.present.primaryText}`,
    `  copy — headline:            ${d.present.headline}`,
    `  copy — description:         ${d.present.description}`,
    `  copy — call to action:      ${d.present.cta}`,
    `  preview by source:`,
    ...PREVIEW_SOURCES.map(
      (s) => `    ${(s + ':').padEnd(24)}${d.previewSources[s]}`,
    ),
    `  DTO videoId:                ${d.dtoPopulated.videoId}`,
    `  eligibility E/UNS/UNC:      ${d.eligibilityCounts.eligible} / ${d.eligibilityCounts.unsupported_objective} / ${d.eligibilityCounts.unconfirmed_lead_objective}`,
    `  decisions W/NMT/OFF:        ${d.decisionCounts.winner} / ${d.decisionCounts.needs_more_time} / ${d.decisionCounts.turn_off}`,
    `  below-min / unresolved:     ${d.reasonCounts.below_min_spend} / ${d.reasonCounts.leads_unresolved}`,
  ].join('\n')
}

/**
 * Reproduce the EXACT production /creatives response path — build the DTOs, put
 * them through the wire shape (`JSON.parse(JSON.stringify(...))`, which drops any
 * `undefined`), and parse each row with the client's Zod schema — and report where
 * it fails. `firstFailingField` is a schema FIELD PATH (e.g. "context.adName"),
 * never an id, name, value or payload.
 */
export interface CreativeResponseDiagnostics {
  window: { start: string; end: string }
  campaigns: number
  adSets: number
  ads: number
  creativesAssembled: number
  dtoParseSuccess: boolean
  droppedCreatives: number
  firstFailingField: string | null
}

export async function diagnoseCreativeResponse(
  dataset: DashboardDataset,
  range: DiagnoseRange = fullExtent(dataset),
): Promise<CreativeResponseDiagnostics> {
  const repo = createDatasetRepository(dataset)
  const rows = await repo.listCreatives({ start: range.start, end: range.end })
  const wire: unknown = JSON.parse(JSON.stringify(rows))
  const items = Array.isArray(wire) ? wire : []

  let dropped = 0
  let firstFailingField: string | null = null
  for (const item of items) {
    const parsed = creativeRowDtoSchema.safeParse(item)
    if (!parsed.success) {
      dropped += 1
      if (firstFailingField === null) {
        firstFailingField = parsed.error.issues[0]?.path.join('.') || '(root)'
      }
    }
  }

  return {
    window: { start: range.start, end: range.end },
    campaigns: dataset.campaigns.length,
    adSets: dataset.adSets.length,
    ads: dataset.ads.length,
    creativesAssembled: rows.length,
    dtoParseSuccess: Array.isArray(wire) && dropped === 0,
    droppedCreatives: dropped,
    firstFailingField,
  }
}

/** Render the response diagnostics as aligned, secret-free terminal lines. */
export function formatCreativeResponse(d: CreativeResponseDiagnostics): string {
  return [
    'Creative response (production path: DTO → JSON → Zod)',
    `  campaigns loaded:           ${d.campaigns}`,
    `  ad sets loaded:             ${d.adSets}`,
    `  ads loaded:                 ${d.ads}`,
    `  creatives assembled:        ${d.creativesAssembled}`,
    `  DTO parse success:          ${d.dtoParseSuccess}`,
    `  creatives dropped (bad):    ${d.droppedCreatives}`,
    `  first failing field:        ${d.firstFailingField ?? '(none)'}`,
  ].join('\n')
}

/**
 * Ad-scope diagnostics: is "790 of 800 ads have no insights" a sync defect or the
 * expected shape of a long-lived account? It classifies EVERY ad by its live status
 * (active / paused / other) against whether it DELIVERED in the analysed window,
 * so the disambiguating fact is explicit: an ACTIVE ad with no delivery is a red
 * flag (possible sync gap or a genuinely dark ad); a paused/archived ad with no
 * delivery is expected historical inventory. Counts only — never an id or name.
 */
export interface AdScopeDiagnostics {
  window: { start: string; end: string }
  totalAds: number
  activeAds: number
  pausedAds: number
  otherStatusAds: number
  /** Ads with >= 1 delivering insight row inside the window. */
  adsDeliveringInWindow: number
  /** (1) active AND delivered in window. */
  activeWithDelivery: number
  /** active but NO delivery in window — the count that would reveal a sync gap. */
  activeNoDelivery: number
  /** (3) paused/other but delivered within the window (recently paused). */
  pausedWithRecentDelivery: number
  /** (4) not-active AND no delivery in window — hide-by-default historical ads. */
  historicalNoDelivery: number
}

function adIsActive(status: string | null, effective: string | null): boolean {
  return (effective ?? status ?? '').toUpperCase() === 'ACTIVE'
}

function adIsPaused(status: string | null, effective: string | null): boolean {
  return (effective ?? status ?? '').toUpperCase().includes('PAUSED')
}

/** Classify every ad by live status × delivery-in-window (safe counts only). */
export function diagnoseAdScope(
  dataset: DashboardDataset,
  range: DiagnoseRange = fullExtent(dataset),
): AdScopeDiagnostics {
  const deliveredAdIds = new Set(
    dataset.insights
      .filter(
        (i) =>
          i.date >= range.start && i.date <= range.end && insightHasDelivery(i),
      )
      .map((i) => i.metaAdId),
  )

  let activeAds = 0
  let pausedAds = 0
  let otherStatusAds = 0
  let activeWithDelivery = 0
  let activeNoDelivery = 0
  let pausedWithRecentDelivery = 0
  let historicalNoDelivery = 0

  for (const ad of dataset.ads) {
    const active = adIsActive(ad.status, ad.effectiveStatus)
    const paused = !active && adIsPaused(ad.status, ad.effectiveStatus)
    const delivered = deliveredAdIds.has(ad.metaAdId)

    if (active) activeAds += 1
    else if (paused) pausedAds += 1
    else otherStatusAds += 1

    if (active && delivered) activeWithDelivery += 1
    if (active && !delivered) activeNoDelivery += 1
    if (!active && delivered) pausedWithRecentDelivery += 1
    if (!active && !delivered) historicalNoDelivery += 1
  }

  return {
    window: { start: range.start, end: range.end },
    totalAds: dataset.ads.length,
    activeAds,
    pausedAds,
    otherStatusAds,
    adsDeliveringInWindow: deliveredAdIds.size,
    activeWithDelivery,
    activeNoDelivery,
    pausedWithRecentDelivery,
    historicalNoDelivery,
  }
}

/** Render the ad-scope diagnostics as aligned, secret-free terminal lines. */
export function formatAdScope(d: AdScopeDiagnostics): string {
  const windowLabel =
    d.window.start === '' ? '(no data)' : `${d.window.start} .. ${d.window.end}`
  return [
    `Ad scope (status × delivery)   window: ${windowLabel}`,
    `  total ads in account:       ${d.totalAds}`,
    `  status: active/paused/other:${d.activeAds} / ${d.pausedAds} / ${d.otherStatusAds}`,
    `  ads delivering in window:   ${d.adsDeliveringInWindow}`,
    `  --- the four cross-checks ---`,
    `  (1) active ads:             ${d.activeAds}`,
    `  (2) active WITH delivery:   ${d.activeWithDelivery}`,
    `      active, NO delivery:    ${d.activeNoDelivery}   <- a sync gap if non-zero & unexpected`,
    `  (3) paused, recent delivery:${d.pausedWithRecentDelivery}`,
    `  (4) historical, no delivery:${d.historicalNoDelivery}   <- hidden by default (expected inventory)`,
  ].join('\n')
}

/** Render the campaign diagnostics as aligned, secret-free terminal lines. */
export function formatCampaignDiagnostics(d: CampaignDiagnostics): string {
  return [
    'Campaigns (window-scoped)',
    `  total campaigns:            ${d.total}`,
    `  active / paused / other:    ${d.active} / ${d.paused} / ${d.otherStatus}`,
    `  delivered in window:        ${d.deliveredInWindow}`,
    `  active AND delivering:      ${d.activeAndDelivering}`,
    `  with a last-delivery date:  ${d.withLatestDeliveryDate}`,
    `  last delivery date range:   ${d.earliestLastDelivery ?? '—'} .. ${d.latestLastDelivery ?? '—'}`,
  ].join('\n')
}
