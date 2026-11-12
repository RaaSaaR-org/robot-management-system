/**
 * @file datasetVideoTicket.test.ts
 * @description What a dataset video ticket asserts, and what it refuses (TASK-478).
 * @feature datasets
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DATASET_VIDEO_TICKET_TTL_MS,
  signDatasetVideoTicket,
  verifyDatasetVideoTicket,
} from '../datasetVideoTicket.js';
import { signCameraTicket, verifyCameraTicket } from '../cameraTicket.js';

const CLAIMS = { datasetId: 'ds-1', userId: 'user-7', tenantId: 'tenant-a', role: 'viewer' };

describe('dataset video tickets', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-for-video-tickets';
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('round-trips the claims it was given', () => {
    const claims = verifyDatasetVideoTicket(signDatasetVideoTicket(CLAIMS));
    expect(claims).toMatchObject({ ...CLAIMS, kind: 'dataset-video' });
    expect(claims!.exp).toBeGreaterThan(Date.now());
  });

  it('is a different string every time, for the same dataset', () => {
    expect(signDatasetVideoTicket(CLAIMS)).not.toBe(signDatasetVideoTicket(CLAIMS));
  });

  it('rejects a payload edited after signing', () => {
    const [payload, signature] = signDatasetVideoTicket(CLAIMS).split('.');
    const edited = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    edited.datasetId = 'ds-2';
    const forged = `${Buffer.from(JSON.stringify(edited), 'utf8').toString('base64url')}.${signature}`;
    expect(verifyDatasetVideoTicket(forged)).toBeNull();
  });

  it('rejects a ticket signed with a different secret', () => {
    const ticket = signDatasetVideoTicket(CLAIMS);
    process.env.JWT_SECRET = 'another-secret';
    expect(verifyDatasetVideoTicket(ticket)).toBeNull();
  });

  it('rejects an expired ticket', () => {
    const ticket = signDatasetVideoTicket(CLAIMS);
    expect(verifyDatasetVideoTicket(ticket, Date.now() + DATASET_VIDEO_TICKET_TTL_MS + 1)).toBeNull();
  });

  it('expires in minutes, not hours', () => {
    expect(DATASET_VIDEO_TICKET_TTL_MS).toBeLessThanOrEqual(15 * 60_000);
  });

  it('rejects anything that is not a ticket', () => {
    for (const junk of [undefined, null, '', 'abc', '.', 'a.', '.b', 42, ['a.b']]) {
      expect(verifyDatasetVideoTicket(junk)).toBeNull();
    }
  });

  it('is not a camera ticket, and a camera ticket is not one of these', () => {
    // One secret signs both families; the kind is what keeps a ticket for a
    // dataset's videos from opening a robot camera, and the reverse.
    expect(verifyCameraTicket(signDatasetVideoTicket(CLAIMS))).toBeNull();
    const camera = signCameraTicket({
      robotId: 'ds-1',
      cameraName: 'head_camera',
      userId: 'user-7',
      tenantId: 'tenant-a',
      role: 'viewer',
    });
    expect(verifyDatasetVideoTicket(camera)).toBeNull();
  });

  it('carries no secret in the ticket itself', () => {
    const payload = Buffer.from(signDatasetVideoTicket(CLAIMS).split('.')[0], 'base64url').toString('utf8');
    expect(payload).not.toContain('test-secret-for-video-tickets');
  });
});
