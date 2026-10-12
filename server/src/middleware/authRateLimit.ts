/**
 * @file authRateLimit.ts
 * @description The strict brute-force limiter for `/api/auth`, counting only the
 *   endpoints that take a credential (TASK-362). Session upkeep — `/me`,
 *   `/refresh`, `/logout`, `/mfa/status` — is not a guessing surface and stays
 *   under the general API limiter; limiting it at 5/min ended live sessions.
 * @feature auth
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

/**
 * Paths under `/api/auth` that accept a password, an e-mail to enumerate, or a
 * reset token. MFA code entry has its own limiters in `auth.routes.ts`.
 */
export const CREDENTIAL_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/change-password',
]);

/** Whether a request (path relative to the `/api/auth` mount) is a credential attempt. */
export function isCredentialAuthRequest(path: string): boolean {
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return CREDENTIAL_AUTH_PATHS.has(normalized);
}

export interface AuthLimiterOptions {
  /** Attempts per window per client. Default 5. */
  max?: number;
  /** Window length in ms. Default one minute. */
  windowMs?: number;
  /** Skip all limiting (RATE_LIMIT_DISABLED). */
  disabled?: boolean;
}

/** Build the credential-endpoint limiter to mount on `/api/auth`. */
export function createAuthLimiter(options: AuthLimiterOptions = {}): RateLimitRequestHandler {
  const { max = 5, windowMs = 60 * 1000, disabled = false } = options;
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again later.' },
    skip: (req) => disabled || !isCredentialAuthRequest(req.path),
  });
}
