/**
 * @file datasetVideoTicket.ts
 * @description Short-lived, single-dataset tickets for the episode video URL.
 * @feature datasets
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * WHY A TICKET (TASK-478).
 *
 * `/api/datasets/:id/episodes/:index/video/:camera` is played by a `<video>`,
 * and a `<video>` cannot set an `Authorization` header — neither on the first
 * request nor on the Range requests it makes while seeking. With sign-in on,
 * every one of them was a 401 and the player a black box.
 *
 * This is the camera stream's answer (`cameraTicket.ts`, TASK-214) applied to
 * the second place it is needed: a signed assertion in the query string rather
 * than the caller's access token. A ticket opens the videos of ONE dataset,
 * for GET only, for a quarter of an hour — not another dataset, not the
 * dataset's parquet or metadata, not a mutating call, not the API at large.
 *
 * It is scoped to a dataset rather than to one episode and camera because a
 * player shows several cameras at once and steps through hundreds of episodes;
 * a ticket per file would be a round-trip per click for no narrower a grant —
 * whoever may watch one episode of a dataset may watch them all.
 *
 * It is a separate kind of ticket from the camera one, not a reuse of its
 * verifier: the signature covers a kind prefix, so a camera ticket can never
 * verify here and a video ticket can never open a camera.
 */

/**
 * Ticket lifetime. Longer than a camera ticket's two minutes because a video is
 * not one long response: the browser comes back with a Range request every time
 * the viewer seeks, and each of those presents the ticket again.
 */
export const DATASET_VIDEO_TICKET_TTL_MS = 15 * 60_000;

/** Signed into every ticket; what keeps the two ticket families apart. */
const KIND = 'dataset-video';

/** What a ticket asserts. Everything here is signed. */
export interface DatasetVideoTicketClaims {
  kind: typeof KIND;
  /** The one dataset whose videos this ticket opens. */
  datasetId: string;
  /** Who asked, so the video request carries the same identity the ticket did. */
  userId: string;
  /** The tenant scope the ticket was asked for in — the video request runs in it. */
  tenantId: string | null;
  /** Their role at issue time. */
  role: string;
  /** Expiry, epoch ms. */
  exp: number;
  /** Random per ticket, so two tickets for one dataset are different strings. */
  nonce: string;
}

/** `JWT_SECRET`, read per call — see `cameraTicket.ts` for why both. */
function signingKey(): string {
  return process.env.JWT_SECRET || 'dev-secret-change-in-production';
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(`${KIND}:${payload}`).digest('hex');
}

/** Issue a ticket for the videos of one dataset. */
export function signDatasetVideoTicket(
  claims: Omit<DatasetVideoTicketClaims, 'kind' | 'exp' | 'nonce'>,
  ttlMs: number = DATASET_VIDEO_TICKET_TTL_MS
): string {
  const full: DatasetVideoTicketClaims = {
    ...claims,
    kind: KIND,
    exp: Date.now() + ttlMs,
    nonce: randomBytes(9).toString('base64url'),
  };
  const payload = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a ticket and return what it asserts, or null — one answer for every
 * rejection (forged, tampered, expired, malformed, the wrong kind).
 *
 * This checks that the ticket is authentic and current. Comparing `datasetId`
 * against the path it arrived on is the caller's job.
 */
export function verifyDatasetVideoTicket(
  ticket: unknown,
  now: number = Date.now()
): DatasetVideoTicketClaims | null {
  if (typeof ticket !== 'string' || ticket.length === 0) return null;

  const separator = ticket.lastIndexOf('.');
  if (separator <= 0 || separator === ticket.length - 1) return null;
  const payload = ticket.slice(0, separator);
  const signature = ticket.slice(separator + 1);

  const expected = sign(payload);
  // Constant-time; lengths first, because timingSafeEqual throws on a mismatch.
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'))) return null;

  let claims: DatasetVideoTicketClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DatasetVideoTicketClaims;
  } catch {
    return null;
  }

  if (
    claims?.kind !== KIND ||
    typeof claims.datasetId !== 'string' ||
    typeof claims.userId !== 'string' ||
    typeof claims.role !== 'string' ||
    typeof claims.exp !== 'number'
  ) {
    return null;
  }
  if (!(claims.exp > now)) return null;

  return claims;
}
