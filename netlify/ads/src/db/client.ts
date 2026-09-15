import postgres from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from './schema/index.ts'

/**
 * Runtime, SERVER-ONLY database client (Stage 6).
 *
 * This is the single module permitted to import the `postgres` driver (enforced
 * by tests/boundaries/serverOnly.test.ts). It MUST NEVER be imported by
 * browser-reachable code (`src/main.tsx`, `src/App.tsx`, `src/ui/**`). Secrets
 * are read from `process.env` at CALL time (never at import), so importing this
 * module neither connects nor requires the env var to be set.
 *
 * Connection: `DATABASE_URL` over Supavisor **TRANSACTION** mode (port 6543) with
 * `prepare: false` (transaction pooling does not support prepared statements).
 * No anon key, no service-role key, no browser access.
 *
 * Stage 6 is OFFLINE-ONLY: the automated suite runs on PGlite and never imports
 * this module. It exists so the future fetch-and-write workflow (src/sync/) can
 * obtain a runtime handle; it performs no live write in Stage 6.
 */

const REDACTED = '***redacted***'

/** The postgres.js client type, without depending on its internal type exports. */
export type RuntimeSql = ReturnType<typeof postgres>
export type RuntimeDb = PostgresJsDatabase<typeof schema>

/** Mask every sensitive part of a connection string for safe logging. */
export function redactConnectionString(value: string): string {
  try {
    const u = new URL(value)
    const db = u.pathname && u.pathname !== '/' ? u.pathname : ''
    return `${u.protocol}//${REDACTED}@${REDACTED}${db}`
  } catch {
    return REDACTED
  }
}

/** A safe-to-print description of a connection target (Stage 9). */
export interface RedactedTarget {
  protocol: string
  /** Always redacted: the Supavisor host encodes the project ref and region. */
  host: string
  /** Always redacted: the username encodes the project ref. */
  user: string
  /** SHOWN — not a secret, and the value being verified (6543 = transaction mode). */
  port: string
  /** SHOWN — the database name (`postgres`), not a secret. */
  database: string
  /** True only for Supavisor TRANSACTION mode, which the runtime client requires. */
  isTransactionPoolerPort: boolean
}

/** The port Supavisor serves TRANSACTION mode on; SESSION mode is 5432. */
export const TRANSACTION_POOLER_PORT = '6543'

const UNKNOWN_TARGET: RedactedTarget = {
  protocol: REDACTED,
  host: REDACTED,
  user: REDACTED,
  port: REDACTED,
  database: REDACTED,
  isTransactionPoolerPort: false,
}

/**
 * Describe a connection target for OPERATOR DISPLAY, so a live write can be
 * confirmed to be aimed at the intended database before it happens.
 *
 * Password, username and host are ALWAYS redacted — the host and user encode the
 * Supabase project ref. Port and database name are shown: neither is a secret,
 * and the port is precisely what the operator needs to confirm (6543 =
 * transaction mode). A malformed or absent url yields an all-redacted target
 * rather than throwing or echoing the raw value.
 */
export function describeTarget(raw: string | undefined): RedactedTarget {
  if (raw === undefined || raw.trim() === '') return { ...UNKNOWN_TARGET }
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ...UNKNOWN_TARGET }
  }
  const database = u.pathname.replace(/^\//, '')
  const port = u.port === '' ? '(default)' : u.port
  return {
    protocol: u.protocol.replace(/:$/, ''),
    host: REDACTED,
    user: REDACTED,
    port,
    database: database === '' ? '(none)' : database,
    isTransactionPoolerPort: u.port === TRANSACTION_POOLER_PORT,
  }
}

/** One-line rendering of `describeTarget` for console output. */
export function formatRedactedTarget(raw: string | undefined): string {
  const t = describeTarget(raw)
  const mode = t.isTransactionPoolerPort
    ? 'transaction pooler'
    : 'NOT the transaction pooler port'
  return `${t.protocol}://${t.user}@${t.host}:${t.port}/${t.database} (${mode})`
}

/**
 * Validate `DATABASE_URL` WITHOUT connecting. Throws a redacted error on
 * missing/malformed input — the value itself is never in the message.
 */
export function validateRuntimeUrl(raw: string | undefined): string {
  if (!raw || raw.trim() === '') {
    throw new Error('DATABASE_URL is not set')
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('DATABASE_URL is not a valid URL')
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      `DATABASE_URL must be a postgres:// connection string (got protocol "${parsed.protocol}")`,
    )
  }
  return raw
}

export interface RuntimeConnection {
  sql: RuntimeSql
  db: RuntimeDb
  /** Close the underlying connection. Always call this in a `finally` block. */
  close: () => Promise<void>
}

/** Conservative, serverless-safe postgres.js options for the runtime client. */
export interface RuntimeClientOptions {
  /** Supavisor requires TLS. */
  ssl: 'require'
  /** MUST be false for Supavisor TRANSACTION mode (6543): prepared statements
   * do not survive transaction pooling. */
  prepare: false
  /** One connection per serverless invocation. */
  max: number
  /** Seconds to wait for a connection before failing — so a bad connection fails
   * FAST instead of consuming the full platform timeout. */
  connect_timeout: number
  /** Seconds an idle connection lingers before being closed. */
  idle_timeout: number
  /** Seconds before a connection is recycled. */
  max_lifetime: number
  /** Swallow server NOTICE noise. */
  onnotice: () => void
}

/**
 * Build the runtime client options. Extracted so the settings — especially
 * `prepare: false` and a bounded `connect_timeout` — are unit-testable without
 * opening a connection.
 */
export function buildRuntimeClientOptions(): RuntimeClientOptions {
  return {
    ssl: 'require',
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    max_lifetime: 1800,
    onnotice: () => {},
  }
}

/** Open a validated transaction-mode connection to `url` with the runtime options. */
function openConnection(url: string): RuntimeConnection {
  const sql = postgres(url, buildRuntimeClientOptions())
  const db = drizzle(sql, { schema })
  return {
    sql,
    db,
    // Bounded shutdown: with serial reads there are no orphaned in-flight queries,
    // so a healthy connection closes immediately; the short timeout only caps the
    // pathological case so cleanup never dominates the request.
    close: async () => {
      await sql.end({ timeout: 2 })
    },
  }
}

/**
 * Create a Supavisor TRANSACTION-mode runtime connection. Reads and validates
 * `DATABASE_URL` at CALL time. `prepare: false` is required for transaction
 * pooling; a short `connect_timeout` ensures a bad connection fails quickly.
 */
export function createRuntimeConnection(): RuntimeConnection {
  return openConnection(validateRuntimeUrl(process.env.DATABASE_URL))
}

/**
 * Connection for the Daily Ad Check feature — the ONE write path in the deployed
 * app. It reads `DAILY_CHECK_DATABASE_URL` (a role permitted to INSERT into
 * `daily_ad_checks`) and falls back to `DATABASE_URL` so local/dev and tests work
 * unchanged. Keeping it a distinct env var lets the read API keep a strictly
 * read-only role while only this function is granted write. Reads/validates at CALL
 * time; the caller MUST `close()` in a `finally`.
 */
export function createDailyCheckConnection(): RuntimeConnection {
  const raw = process.env.DAILY_CHECK_DATABASE_URL ?? process.env.DATABASE_URL
  return openConnection(validateRuntimeUrl(raw))
}

/**
 * Connection for the SCHEDULED SYNC — the second (write-heavy) write path in the
 * deployed app. The nightly `sync-background` function upserts the full graph
 * (campaigns → ad sets → ads → creatives → daily insights) and the `sync_runs`
 * row, so it needs a role with the SAME write reach the manual CLI live-write
 * uses, NOT the read-only API role. It reads `SYNC_DATABASE_URL` and falls back
 * to `DATABASE_URL` so local runs and tests (which point `DATABASE_URL` at a
 * write-capable role) work unchanged. Keeping it a distinct env var lets the
 * deployed read API keep a strictly read-only `DATABASE_URL` while only this
 * function is granted broad write. Reads/validates at CALL time; the caller MUST
 * `close()` in a `finally`.
 */
export function createSyncConnection(): RuntimeConnection {
  const raw = process.env.SYNC_DATABASE_URL ?? process.env.DATABASE_URL
  return openConnection(validateRuntimeUrl(raw))
}
