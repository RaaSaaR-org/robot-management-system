/**
 * @file platform-auth.ts
 * @description Credentials for requests to the configured NeoDEM platform only,
 *              plus the record of the last time the platform refused one.
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

/**
 * The platform refused the credential: 401 (none, or not valid) and 403 (valid,
 * but too weak for this write — a `viewer` service account on a fleet write).
 * Both mean the same thing to a robot: this call will keep failing until an
 * operator changes something, so it must never read as "nothing to report".
 */
export function isAuthRejection(status: number): boolean {
  return status === 401 || status === 403;
}

/** What the agent remembers about the last refusal, for `GET /api/v1/health`. */
export interface PlatformAuthRejection {
  /** ISO time the rejection was received. */
  at: string;
  /** Which client was refused, e.g. `SecureUpdateClient`. */
  client: string;
  status: number;
  url: string;
  /** Whether a token was configured at all — the two failures need different fixes. */
  tokenConfigured: boolean;
}

let lastRejection: PlatformAuthRejection | null = null;

/**
 * Remember a refusal. Module-level on purpose: the four clients that hit this
 * are spread across timers and request handlers with no shared owner, and the
 * health endpoint has to be able to answer "is this robot actually talking to
 * the platform?" without reaching into any of them.
 */
export function recordPlatformAuthRejection(client: string, status: number, url: string): void {
  lastRejection = {
    at: new Date().toISOString(),
    client,
    status,
    url,
    tokenConfigured: Boolean(process.env[SERVICE_TOKEN_ENV]),
  };
}

/** The last refusal, or null when the platform has never refused this process. */
export function lastPlatformAuthRejection(): PlatformAuthRejection | null {
  return lastRejection ? { ...lastRejection } : null;
}

/** Tests only: forget the recorded rejection so a case can start from "never". */
export function resetPlatformAuthRejection(): void {
  lastRejection = null;
}
