/**
 * @file features.ts
 * @description Feature flags for optional subsystems. Mirrors the
 * NATS/RustFS pattern — each flag defaults to a safe value, is read
 * at startup, and lets the rest of the codebase gate behaviour behind
 * a simple boolean without reading `process.env` in hot paths.
 * @feature config
 */

function readBoolFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw === 'true' || raw === '1';
}

/**
 * Row-level multi-tenancy (TASK-155).
 *
 * When `false` (default): single-tenant mode. Prisma extension is a
 * no-op, tenantId columns stay NULL, no auth/UI changes are visible.
 * When `true`: every query against an allowlisted model is scoped
 * by the caller's tenantId, sourced from AsyncLocalStorage.
 */
export const MULTI_TENANCY_ENABLED = readBoolFlag('MULTI_TENANCY_ENABLED', false);

/**
 * Default tenant slug used by the backfill migration and by dev-mode
 * auth (AUTH_DISABLED=true) so local development stays single-tenant
 * even when the flag is on.
 */
export const DEFAULT_TENANT_ID = 'default';

/**
 * Snapshot of every feature flag — exposed via /api/config/features so
 * the frontend can decide which UI to render before login.
 */
export function getFeatureFlags(): Record<string, boolean> {
  return {
    multiTenancyEnabled: MULTI_TENANCY_ENABLED,
    natsEnabled: process.env.NATS_URL !== undefined,
    rustfsEnabled: process.env.RUSTFS_ENDPOINT !== undefined,
  };
}
