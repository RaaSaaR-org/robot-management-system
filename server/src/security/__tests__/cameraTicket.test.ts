/**
 * @file cameraTicket.test.ts
 * @description Sign/verify for the camera stream ticket (TASK-214).
 * @feature robots
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  signCameraTicket,
  verifyCameraTicket,
  CAMERA_TICKET_TTL_MS,
} from '../cameraTicket.js';

const CLAIMS = {
  robotId: 'robot-001',
  cameraName: 'head_camera',
  userId: 'user-7',
  tenantId: 'tenant-a',
  role: 'operator',
};

describe('camera stream tickets', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'test-secret-for-camera-tickets');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips the claims it was given', () => {
    const claims = verifyCameraTicket(signCameraTicket(CLAIMS));

    expect(claims).toMatchObject(CLAIMS);
    // The identity has to survive: the stream request is authenticated FROM
    // this, so a ticket that lost its tenant would put a stream outside the
    // row-level isolation the request that asked for it ran inside.
    expect(claims?.tenantId).toBe('tenant-a');
    expect(claims?.exp).toBeGreaterThan(Date.now());
  });

  it('is a different string every time, for the same camera', () => {
    // The nonce. Two tickets minted in the same millisecond must not be the
    // same string — one turning up in a log should not identify another.
    const a = signCameraTicket(CLAIMS);
    const b = signCameraTicket(CLAIMS);
    expect(a).not.toBe(b);
  });

  it('rejects a payload edited after signing', () => {
    // The attack this exists to stop: take a ticket for your own camera, edit
    // the robot id, keep the signature.
    const ticket = signCameraTicket(CLAIMS);
    const [payload, signature] = ticket.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claims.robotId = 'robot-999';
    const forged = `${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}.${signature}`;

    expect(verifyCameraTicket(forged)).toBeNull();
  });

  it('rejects a ticket signed with a different secret', () => {
    const ticket = signCameraTicket(CLAIMS);
    vi.stubEnv('JWT_SECRET', 'a-completely-different-secret');

    expect(verifyCameraTicket(ticket)).toBeNull();
  });

  it('rejects an expired ticket', () => {
    const ticket = signCameraTicket(CLAIMS, 1_000);

    expect(verifyCameraTicket(ticket, Date.now() + 500)).not.toBeNull();
    expect(verifyCameraTicket(ticket, Date.now() + 1_500)).toBeNull();
  });

  it('expires in minutes, not hours', () => {
    // The whole argument for a ticket over the access token is its reach. A
    // long-lived one is the thing it replaced, wearing a different name.
    expect(CAMERA_TICKET_TTL_MS).toBeLessThanOrEqual(300_000);

    const claims = verifyCameraTicket(signCameraTicket(CLAIMS));
    expect(claims!.exp - Date.now()).toBeLessThanOrEqual(CAMERA_TICKET_TTL_MS);
  });

  it.each([
    ['an empty string', ''],
    ['a non-string', 42],
    ['null', null],
    ['undefined', undefined],
    ['no separator', 'abcdef'],
    ['an empty signature', 'abcdef.'],
    ['an empty payload', '.abcdef'],
    ['a signature of the wrong length', 'abcdef.00'],
    ['unparseable payload with a valid-looking shape', 'bm90LWpzb24.' + 'a'.repeat(64)],
  ])('rejects %s', (_label, candidate) => {
    expect(verifyCameraTicket(candidate)).toBeNull();
  });

  it('carries no secret in the ticket itself', () => {
    // A ticket ends up in a URL, which is the place this whole task exists to
    // clean up. It must not contain the signing key or a bearer credential.
    const secret = 'test-secret-for-camera-tickets';
    const ticket = signCameraTicket(CLAIMS);
    const payload = Buffer.from(ticket.split('.')[0], 'base64url').toString('utf8');

    expect(ticket).not.toContain(secret);
    expect(payload).not.toContain(secret);
  });
});
