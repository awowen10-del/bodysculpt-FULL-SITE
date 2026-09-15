/**
 * Daily Ad Check runtime wiring (SERVER-ONLY) — the only module here that reaches a
 * live database handle. Mirrors `src/server/runtime.ts`, but uses the write-capable
 * `createDailyCheckConnection` (the one write path in the deployed app) so the same
 * connection can both read the graph (via the shared read repository) and INSERT the
 * generated check. Reads `DAILY_CHECK_DATABASE_URL`/`DATABASE_URL` at CALL time; the
 * caller MUST `close()` in a `finally`.
 */
import { createDailyCheckConnection } from '../../db/client.ts'
import { createServerReadRepository } from '../repository.ts'
import type { Logger } from '../diagnostics.ts'
import type { DashboardRepository } from '../../data/index.ts'
import type { DailyCheckDb } from './store.ts'

export interface DailyCheckRuntime {
  db: DailyCheckDb
  repository: DashboardRepository
  probe: () => Promise<void>
  close: () => Promise<void>
}

export function createDailyCheckRuntime(logger?: Logger): DailyCheckRuntime {
  const conn = createDailyCheckConnection()
  return {
    db: conn.db,
    repository: createServerReadRepository(conn.db, { logger }),
    probe: async () => {
      await conn.sql`select 1`
    },
    close: conn.close,
  }
}
