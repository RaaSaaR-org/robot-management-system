/**
 * @file platform-auth.ts
 * @description Credentials for requests to the configured NeoDEM platform only.
 * @feature core
 * @status live
 */
export const SERVICE_TOKEN_ENV = 'NEODEM_SERVICE_TOKEN';

/** Never apply these headers to sidecar, model, or arbitrary resource URLs. */
export function platformAuthHeaders(
  authToken: string = process.env[SERVICE_TOKEN_ENV] ?? '',
): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}
