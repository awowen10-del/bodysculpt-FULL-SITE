/**
 * Production runtime wiring (Stage 11B) — the ONLY server module that reaches a
 * live database handle. It is NOT exercised by the automated suite (which runs on
 * PGlite via an injected handle) and opens no connection at import time.
 *
 * `createRuntimeConnection()` (in `src/db/client.ts`) reads and validates
 * `DATABASE_URL` at CALL time over the Supavisor TRANSACTION pooler — so importing
 * this module neither connects nor requires the env var. The caller MUST `close()`
 * in a `finally` block. This module is server-only and must never be reachable
 * from the browser graph.
 */
import { createRuntimeConnection } from '../db/client.ts'
import type { DashboardRepository } from '../data/index.ts'
import { createServerReadRepository } from './repository.ts'
import type { Logger } from './diagnostics.ts'

export interface RuntimeReadRepository {
  repository: DashboardRepository
  /** Lightweight connectivity check (`select 1`) so the caller can confirm and
   * time the connection distinctly from the actual query work. */
  probe: () => Promise<void>
  close: () => Promise<void>
}

/**
 * Open a pooled runtime connection and build the read repository over it. Reads
 * `DATABASE_URL` at call time. Always `close()` when the request completes. An
 * optional `logger` is threaded to `materializeDataset` for per-query diagnostics.
 */
export function createRuntimeReadRepository(
  logger?: Logger,
): RuntimeReadRepository {
  const conn = createRuntimeConnection()
  return {
    repository: createServerReadRepository(conn.db, { logger }),
    probe: async () => {
      await conn.sql`select 1`
    },
    close: conn.close,
  }
}
