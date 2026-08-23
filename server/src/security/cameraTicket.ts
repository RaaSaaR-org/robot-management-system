/**
 * @file cameraTicket.ts
 * @description Short-lived, single-camera tickets for the MJPEG stream URL.
 * @feature robots
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * WHY A TICKET AND NOT THE ACCESS TOKEN.
 *
 * `/api/robots/:id/camera/:name` is rendered in an `<img>` — the only way a
 * page can show `multipart/x-mixed-replace` — and an `<img>` cannot set an
 * `Authorization` header. The first version of this feature (PR #236) closed
 * that gap by accepting `?access_token=`, deliberately, as the smallest change
 * that made cameras work at all. What sat in the URL was then the user's real
 * access token: valid for every endpoint, for its whole lifetime, in the one
 * place URLs are copied, logged and proxied.
 *
 * A ticket is the same shape of credential with none of that reach. It opens
 * ONE camera on ONE robot for about two minutes and authorises nothing else —
 * not another camera, not another robot, not a mutating call, not the API at
 * large. Leaking one costs a view of a camera the holder could already see when
 * they asked for it.
 *
 * It is signed rather than stored: the server keeps no ticket table, so there
 * is nothing to clean up, nothing to grow, and no lookup on the hot path of a
 * stream that re-arms every few seconds.
 */

/** Ticket lifetime. Long enough to open a stream, short enough to be worthless. */
export const CAMERA_TICKET_TTL_MS = 120_000;

/** What a ticket asserts. Everything here is signed. */
export interface CameraTicketClaims {
  /** The one robot this ticket opens. */
  robotId: string;
  /** The one camera on it. */
  cameraName: string;
  /** Who asked, so the stream request carries the same identity the ticket did. */
  userId: string;
  /** Their tenant, so a stream stays inside its tenant's row-level isolation. */
  tenantId: string | null;
  /** Their role at issue time — the stream reconstructs a user, not a superuser. */
  role: string;
  /** Expiry, epoch ms. */
  exp: number;
  /**
   * Random per ticket. Two tickets issued in the same millisecond for the same
   * camera are still different strings, so one appearing in a log cannot be
   * confused with another, and a replay is bounded by `exp` alone rather than
   * by anything guessable.
   */
  nonce: string;
}

/**
 * Signing key. `JWT_SECRET`, because a camera ticket is exactly as trusted as
 * the access token it replaces, and tying it to that one secret means there is
 * no second key an operator can forget to set — a deployment that can issue
 * logins can issue tickets.
 *
 * Read per call rather than cached at import: the test suite stubs the env per
 * case, and a module-level capture would freeze whichever value happened to be
 * set when the first test imported this file.
 */
function signingKey(): string {
  return process.env.JWT_SECRET || 'dev-secret-change-in-production';
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('hex');
}

/** Base64url, without the `=` padding that would need escaping in a URL. */
function encodeSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeSegment(segment: string): string {
  return Buffer.from(segment, 'base64url').toString('utf8');
}

/**
 * Issue a ticket for one camera on one robot.
 *
 * @param claims Everything except `exp`/`nonce`, which this function stamps.
 * @param ttlMs  Lifetime; defaults to {@link CAMERA_TICKET_TTL_MS}.
 */
export function signCameraTicket(
  claims: Omit<CameraTicketClaims, 'exp' | 'nonce'>,
  ttlMs: number = CAMERA_TICKET_TTL_MS
): string {
  const full: CameraTicketClaims = {
    ...claims,
    exp: Date.now() + ttlMs,
    nonce: randomBytes(9).toString('base64url'),
  };
  const payload = encodeSegment(JSON.stringify(full));
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a ticket and return what it asserts, or null.
 *
 * Null for every rejection — a forged signature, a tampered payload, an expired
 * ticket, a malformed string. The caller answers 401 either way, so a verifier
 * that distinguished them would only help someone probing it.
 *
 * This checks that the ticket is authentic and current. It does NOT check that
 * it is the right ticket for the request: comparing `robotId`/`cameraName`
 * against the path is the caller's job, and skipping it would leave any valid
 * ticket good for any camera.
 */
export function verifyCameraTicket(ticket: unknown, now: number = Date.now()): CameraTicketClaims | null {
  if (typeof ticket !== 'string' || ticket.length === 0) return null;

  const separator = ticket.lastIndexOf('.');
  if (separator <= 0 || separator === ticket.length - 1) return null;
  const payload = ticket.slice(0, separator);
  const signature = ticket.slice(separator + 1);

  const expected = sign(payload);
  // Constant-time: a byte-by-byte compare on a signature is how a forgery gets
  // built one character at a time. Lengths must match first — timingSafeEqual
  // throws on a mismatch, and the length is not the secret.
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'))) return null;

  let claims: CameraTicketClaims;
  try {
    claims = JSON.parse(decodeSegment(payload)) as CameraTicketClaims;
  } catch {
    return null;
  }

  if (
    typeof claims?.robotId !== 'string' ||
    typeof claims.cameraName !== 'string' ||
    typeof claims.userId !== 'string' ||
    typeof claims.role !== 'string' ||
    typeof claims.exp !== 'number'
  ) {
    return null;
  }
  if (!(claims.exp > now)) return null;

  return claims;
}
