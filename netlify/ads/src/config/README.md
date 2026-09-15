# `config/` — configuration & environment access

Centralised, typed access to configuration and environment variables, plus
constants that must have a single source of truth.

- `env.ts` — **browser-safe** config only (`VITE_`-prefixed vars). Server-only
  secrets are never read here; Netlify Functions read them on the server.
- `metaApiVersion.ts` — the single Meta API version constant.
- Data-volume label thresholds and other tunables live here too.
