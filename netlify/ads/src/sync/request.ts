/**
 * Sync request types, validation, and the live-write gate (Stage 7).
 *
 * The live-write gate is a FOUR-way AND — request mode, a CLI confirm flag, an
 * env confirmation, and DATABASE_URL present. All must hold or the write is
 * refused. Gate names are not secrets; no secret value is ever echoed.
 */
import type { SyncRunLevel, SyncRunScope } from '../types/index.ts'
import { SyncError } from './errors.ts'
import type { DateRange, WindowLimits } from './dateWindows.ts'

export type SyncMode = 'dry-run' | 'live-write'

export interface SyncRequest {
  mode: SyncMode
  level: SyncRunLevel
  scope: SyncRunScope
  /** Required for backfill/manual; omitted for daily (rolling window). */
  range?: DateRange
  /** Test-only lower limits; may never raise the hard caps. */
  limits?: WindowLimits
}

export function validateRequestShape(request: SyncRequest): void {
  if (request.mode !== 'dry-run' && request.mode !== 'live-write') {
    throw new SyncError('INVALID_REQUEST', 'unknown mode')
  }
  const levels: SyncRunLevel[] = [
    'backfill',
    'daily',
    'manual',
    'reconciliation',
  ]
  if (!levels.includes(request.level)) {
    throw new SyncError('INVALID_REQUEST', 'unknown level')
  }
  const scopes: SyncRunScope[] = ['full', 'incremental', 'filtered']
  if (!scopes.includes(request.scope)) {
    throw new SyncError('INVALID_REQUEST', 'unknown scope')
  }
  if (request.level !== 'daily' && request.range === undefined) {
    throw new SyncError(
      'INVALID_REQUEST',
      'a date range is required for backfill/manual runs',
    )
  }
}

export interface LiveWriteGates {
  /** request.mode === 'live-write' */
  modeIsLiveWrite: boolean
  /** the CLI --confirm-live-write flag was passed */
  cliConfirmFlag: boolean
  /** SYNC_CONFIRM_LIVE_WRITE === '1' */
  envConfirm: boolean
  /** DATABASE_URL is present */
  databaseUrlPresent: boolean
}

/** Read the four gates from parsed CLI flags + env (no secret values retained). */
export function readLiveWriteGates(
  mode: SyncMode,
  cliConfirmFlag: boolean,
  env: NodeJS.ProcessEnv = process.env,
): LiveWriteGates {
  return {
    modeIsLiveWrite: mode === 'live-write',
    cliConfirmFlag,
    envConfirm: env.SYNC_CONFIRM_LIVE_WRITE === '1',
    databaseUrlPresent:
      typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.trim() !== '',
  }
}

/** Throw `LIVE_WRITE_REFUSED` naming the missing gate(s) unless all four hold. */
export function assertLiveWriteAllowed(gates: LiveWriteGates): void {
  const missing: string[] = []
  if (!gates.modeIsLiveWrite) missing.push('--live-write')
  if (!gates.cliConfirmFlag) missing.push('--confirm-live-write')
  if (!gates.envConfirm) missing.push('SYNC_CONFIRM_LIVE_WRITE=1')
  if (!gates.databaseUrlPresent) missing.push('DATABASE_URL')
  if (missing.length > 0) {
    throw new SyncError(
      'LIVE_WRITE_REFUSED',
      `live-write refused; missing gate(s): ${missing.join(', ')}`,
    )
  }
}
