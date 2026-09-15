/**
 * Scheduled-sync orchestrator (SERVER-ONLY).
 *
 * The tested core of the nightly `sync-background` Netlify function. It runs ONE
 * daily rolling live-write (the same `liveWriteSync` the manual CLI uses) and
 * records a small, secret-free outcome. The Netlify function file is thin wiring
 * around this.
 *
 * FAILURE IS NOT SILENT — by design there is no push notification here. A
 * non-success surfaces two ways the owner already relies on: the `sync_runs` row
 * (readable with `npm run db:latest-run`, mirrored in the Netlify function logs
 * this emits) and the dashboard's "Data current to …" indicator, which turns
 * amber/red off the same `sync_runs` state. So the failure is always visible; it
 * just isn't pushed to a chat channel.
 *
 * Extracted from the platform so the whole outcome matrix — disabled, run
 * failed, run partial, connection/token exception — has regression cover with an
 * injected connection, and never touches a real database or Meta.
 *
 * DELIBERATE WRITE OPT-IN: this is a second, write-heavy path in the deployed
 * app, so it refuses to write unless `SYNC_SCHEDULE_ENABLED === '1'`. A freshly
 * deployed function therefore does nothing until the owner turns it on, and the
 * scheduler can be paused without redeploying by clearing that one variable.
 */
import type { RuntimeDb } from '../../db/client.ts'
import type { FetchLike } from '../../meta/graphClient.ts'
import type { RuntimeMetaConfig } from '../../meta/runtimeConfig.ts'
import { liveWriteSync, type SyncRequest } from '../../sync/index.ts'
import { lookupLocalAds } from '../../db/lookupAds.ts'
import { safeErrorFields } from '../diagnostics.ts'

/** The write connection the orchestrator drives. Loosened for test stubs. */
export interface SyncConnection {
  db: RuntimeDb
  close: () => Promise<void>
}

/** A redacted log line — safe fields only (never secrets/ids/SQL/copy). */
export type SyncLog = (event: { stage: string; [key: string]: unknown }) => void

export interface ScheduledSyncDeps {
  env: NodeJS.ProcessEnv
  /** Opens the WRITE connection (createSyncConnection in production). */
  openConnection: () => SyncConnection
  /** Resolves the Meta config; throws if the token/account env is missing. */
  metaConfig: () => RuntimeMetaConfig
  fetchImpl: FetchLike
  /** Injected "today" (YYYY-MM-DD) — no hidden clock. */
  todayIso: string
  logger: SyncLog
  /** Test seam; defaults to the real orchestrator. */
  liveWrite?: typeof liveWriteSync
}

export interface ScheduledSyncOutcome {
  /** Whether a live-write was actually attempted. */
  ran: boolean
  status: 'success' | 'partial' | 'failed' | 'disabled' | 'error'
}

/** How many run error codes to include in the failure log line. */
const MAX_LOGGED_ERRORS = 5

/**
 * Run the nightly sync and record its outcome. Resolves to a small, secret-free
 * outcome; it never throws (a thrown value from the run is caught, logged and
 * reported as `status: 'error'`), so the calling background function can log the
 * outcome and return cleanly. Every non-success is logged with safe error codes
 * so the Netlify function logs are diagnostic on their own.
 */
export async function runScheduledSync(
  deps: ScheduledSyncDeps,
): Promise<ScheduledSyncOutcome> {
  if (deps.env.SYNC_SCHEDULE_ENABLED !== '1') {
    deps.logger({ stage: 'disabled', reason: 'SYNC_SCHEDULE_ENABLED !== 1' })
    return { ran: false, status: 'disabled' }
  }

  const request: SyncRequest = {
    mode: 'live-write',
    level: 'daily',
    scope: 'incremental',
  }
  const liveWrite = deps.liveWrite ?? liveWriteSync

  // Resolve config + open the connection BEFORE the try's happy path so a missing
  // token or an unreachable database surfaces as an `error` outcome with safe
  // fields, exactly like an in-run failure.
  let conn: SyncConnection | undefined
  try {
    const config = deps.metaConfig()
    conn = deps.openConnection()
    const db = conn.db

    deps.logger({ stage: 'run_start', level: 'daily' })
    const result = await liveWrite(db, request, {
      config,
      fetchImpl: deps.fetchImpl,
      todayIso: deps.todayIso,
      retry: {},
      localAdLookup: (ids) => lookupLocalAds(db, ids),
      onStage: (stage) => deps.logger({ stage: `sync:${stage}` }),
      onRetry: (info) =>
        deps.logger({
          stage: 'sync_retry',
          writeStage: info.stage,
          attempt: info.attempt,
          maxAttempts: info.maxAttempts,
          code: info.code,
        }),
    })

    const success = result.status === 'success' && result.finalised
    if (success) {
      deps.logger({
        stage: 'run_success',
        status: result.status,
        written: result.counts.written,
      })
      return { ran: true, status: 'success' }
    }

    // Non-success: log with safe error codes so the failure is diagnosable from
    // the function logs alone (the dashboard indicator + sync_runs row surface it
    // to the owner). Never SQL, ids, urls or payloads — codes + stages only.
    deps.logger({
      stage: 'run_not_ok',
      status: result.status,
      finalised: result.finalised,
      written: result.counts.written,
      errorCodes: result.errors
        .slice(0, MAX_LOGGED_ERRORS)
        .map((e) => `${e.stage}:${e.code}`),
    })
    return {
      ran: true,
      status: result.status === 'partial' ? 'partial' : 'failed',
    }
  } catch (err) {
    deps.logger({ stage: 'run_exception', ...safeErrorFields(err) })
    return { ran: true, status: 'error' }
  } finally {
    // Best-effort close that must NEVER mask the run's real outcome (see the CLI's
    // runLiveWriteWithConnection for the same guard).
    try {
      await conn?.close()
    } catch {
      deps.logger({ stage: 'close_failed_nonfatal' })
    }
  }
}
