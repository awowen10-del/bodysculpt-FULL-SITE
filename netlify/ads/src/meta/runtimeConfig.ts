/**
 * SERVER-ONLY runtime Meta configuration (Stage 7).
 *
 * Reads `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, and (optionally)
 * `META_API_VERSION` from `process.env` at CALL time — never at import, never
 * through a browser-safe config module. `META_API_VERSION` may ONLY equal the
 * single supported version from `src/config/metaApiVersion.ts`; an arbitrary
 * version string is rejected, never silently applied.
 *
 * Must never be imported by browser-reachable code (enforced by the server-only
 * boundary test).
 */
import { META_API_VERSION } from '../config/metaApiVersion.ts'
import {
  requireAccessToken,
  normalizeAdAccountId,
  type MetaConfig,
} from './graphClient.ts'

export interface RuntimeMetaConfig extends MetaConfig {
  apiVersion: string
}

/** Accept only the single supported API version; reject anything else. */
export function resolveApiVersion(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return META_API_VERSION
  if (raw.trim() !== META_API_VERSION) {
    throw new Error(
      `META_API_VERSION is not the supported version (expected ${META_API_VERSION})`,
    )
  }
  return META_API_VERSION
}

export function getRuntimeMetaConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeMetaConfig {
  return {
    accessToken: requireAccessToken(env.META_ACCESS_TOKEN),
    adAccountId: normalizeAdAccountId(env.META_AD_ACCOUNT_ID),
    apiVersion: resolveApiVersion(env.META_API_VERSION),
  }
}
