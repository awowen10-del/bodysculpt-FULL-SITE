/**
 * Safe request FINGERPRINT for the account dimension fetch (Stage 7 diagnosis).
 *
 * WHY THIS EXISTS: `meta:diagnose-dimensions` and `sync:preflight` both fetch
 * the account dimension through the SAME `fetchAdAccount` → `metaGetPaged`
 * path, yet one has been observed to succeed while the other reports
 * `DIMENSION_FETCH_FAILED`. To settle whether the two commands really construct
 * an equivalent account request — rather than just asserting they do — each
 * prints this fingerprint for the account request it is about to make. Two runs
 * in the same shell can then be compared field-by-field.
 *
 * SECRET-SAFE BY CONSTRUCTION: the fingerprint carries only the derived shape of
 * the request — never the token, never the account id itself, never a url, query
 * string or the field NAMES. The account id contributes only a boolean (does it
 * carry the `act_` prefix) and its character length; the field list contributes
 * only its count. Everything else is a fixed identifier. There is no field here
 * that can hold a credential or a raw id, so it is safe to print verbatim.
 *
 * The `fieldCount` and `retryPolicy` are read from the SAME constants the real
 * fetch uses (`AD_ACCOUNT_FIELDS`, `MAX_RETRIES`), so if either changes the
 * fingerprint moves with it — it can never drift into describing a request the
 * code no longer makes.
 */
import { MAX_RETRIES } from './graphClient.ts'
import { AD_ACCOUNT_FIELDS } from './fields.ts'

/**
 * The minimal, structural slice of a fetch config the account request depends
 * on. Deliberately NOT the full `FetchConfig`: the token plays no part in the
 * fingerprint, so it is not even accepted here.
 */
export interface AccountFetchInputs {
  adAccountId: string
  apiVersion: string
}

/** The safe, printable fingerprint of an account-dimension request. */
export interface RequestFingerprint {
  /** Fixed operation label — the account-dimension fetcher. */
  operation: 'fetchAdAccount'
  /** The Graph API version the request will use. */
  apiVersion: string
  /** Whether the account id carries the canonical `act_` prefix. */
  accountIdHasActPrefix: boolean
  /** Character length of the account id (never the id itself). */
  accountIdLength: number
  /** How many fields are requested (never their names). */
  fieldCount: number
  /** Stable identifier of the networking core issuing the request. */
  clientImpl: string
  /** Stable identifier of the retry policy the request runs under. */
  retryPolicy: string
}

/** The networking core every dimension fetch routes through. */
export const ACCOUNT_FETCH_CLIENT_IMPL = 'metaGetPaged@src/meta/graphClient'

/**
 * The retry policy identifier — derived from the real constant so it tracks any
 * change to the ladder. The classes (429 / 5xx retried; 400/401/403 immediate)
 * are fixed in `getOnce`; only the bound is a variable.
 */
export const ACCOUNT_FETCH_RETRY_POLICY = `retry-on=429,5xx;immediate-fail=400,401,403;max-retries=${MAX_RETRIES}`

/**
 * Build the safe fingerprint of the account-dimension request implied by a
 * config. Pure: no env read, no network, no console. Both the diagnostic and
 * the preflight call THIS one function, so a divergence in what they would
 * request shows up as a divergence in the fingerprint they print.
 */
export function accountFetchFingerprint(
  config: AccountFetchInputs,
): RequestFingerprint {
  return {
    operation: 'fetchAdAccount',
    apiVersion: config.apiVersion,
    accountIdHasActPrefix: config.adAccountId.startsWith('act_'),
    accountIdLength: config.adAccountId.length,
    fieldCount: AD_ACCOUNT_FIELDS.length,
    clientImpl: ACCOUNT_FETCH_CLIENT_IMPL,
    retryPolicy: ACCOUNT_FETCH_RETRY_POLICY,
  }
}

/** Render the fingerprint as aligned, printable lines. Order is stable so two
 * runs can be diffed line-for-line. */
export function formatFingerprint(fp: RequestFingerprint): string[] {
  return [
    `operation:              ${fp.operation}`,
    `api version:            ${fp.apiVersion}`,
    `account id act_ prefix: ${fp.accountIdHasActPrefix}`,
    `account id length:      ${fp.accountIdLength}`,
    `requested field count:  ${fp.fieldCount}`,
    `client impl:            ${fp.clientImpl}`,
    `retry policy:           ${fp.retryPolicy}`,
  ]
}
