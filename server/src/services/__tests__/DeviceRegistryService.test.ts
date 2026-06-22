/**
 * @file DeviceRegistryService.test.ts
 * @description Unit tests for DeviceRegistryService — device X.509 certificate
 *   registration, verification, challenge-response, revocation, and listing.
 * @feature security
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

// The service imports `prisma` from '../database/client.js' — mock that exact path.
vi.mock('../../database/client.js', () => ({
  prisma: {
    deviceCertificate: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { DeviceRegistryService, deviceRegistryService } from '../DeviceRegistryService.js';
import { prisma as _prisma } from '../../database/client.js';

const prisma = vi.mocked(_prisma, true);

// ---------------------------------------------------------------------------
// Fixtures — generated against the service's real crypto helpers so that
// fingerprint + signature checks exercise actual logic (DB is mocked).
// ---------------------------------------------------------------------------

const CERT_PEM =
  '-----BEGIN CERTIFICATE-----\naGVsbG8tY2VydC1ieXRlcy1mb3ItdGVzdA==\n-----END CERTIFICATE-----';

const PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw63v0CaOr16Gt7f6Qv/F\n' +
  'j8XVyztC09AwiykUldToRraT9QZYfKM44MP/T/m2WZcFtivPYdIQOZDZtIsb84OW\n' +
  'QIsWFCnT3lLBmMTa0iE1W7YV/NrygtSJ9ddtnAw3P891z27EBFbqavHpkNmvFriB\n' +
  'fHqaXOhVVl0TyCMjIMvto1XhHFT3GtxldztR6xPcfHZEHOeQkGkqtNeZbHiernLa\n' +
  '25kxUrRQQCINKObJUXeN7tZT8fd1u3GL+DMCTE0XhDou0+BO3rHW/qfkIZfw5a8I\n' +
  'mqLDPuZcO8gScoTgJLUeR+5s9Gm3Ct/P2bTqBX9rUSy0XfoNJSpWk0iAzRZhvDjk\n' +
  'bQIDAQAB\n-----END PUBLIC KEY-----\n';

// SHA-256 fingerprint of the DER bytes of CERT_PEM (colon-separated, upper).
const FINGERPRINT =
  '92:E1:5B:BD:FD:07:03:AA:F8:2A:E6:90:0D:98:B3:E9:32:2D:BA:9E:71:40:CC:76:B8:7A:14:9F:98:05:52:6D';

const NONCE = 'test-nonce-123';
const SIGNATURE =
  'pVbkIfqqud6K1PMSUtUanLv7Ma1LFouy5eY2GDxpp1z8rmZT68GS4tiBtA059g9PvY4901XSkt/za6bjrRkG+7JZzt69rJCOPMFhsWJJ0YH7OLoK/kklqDlXpdhW8LDi1W2uorFLbCGkw7ESMtD3yHVXLnvKBrvnl8V5d838pTyDpYS2hEOv5OyvIhvtNXar3DYpkboALgev2wfo29S3EW6vyRGnVWTw6PBbgC3sWm+rWsAmtT93+2LguvofEDxnVDuWTOLTVJ0wrQ6uBXl+S2LPt2YKK4Zqcc9IaY5PMgfF2JW7juTqqD4VUaEHWNEj50SpIts2wulxaCwE3m/fkg==';

interface CertRow {
  id: string;
  robotId: string;
  fingerprint: string;
  publicKey: string;
  certificate: string;
  issuedAt: Date;
  expiresAt: Date | null;
  status: string;
}

function makeRow(overrides: Partial<CertRow> = {}): CertRow {
  return {
    id: 'cert-1',
    robotId: 'robot-1',
    fingerprint: FINGERPRINT,
    publicKey: PUBLIC_KEY,
    certificate: CERT_PEM,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
    status: 'active',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// registerCertificate
// ===========================================================================

describe('registerCertificate', () => {
  it('upserts and returns a record when the fingerprint matches the certificate', async () => {
    prisma.deviceCertificate.upsert.mockResolvedValue(makeRow() as never);

    const result = await deviceRegistryService.registerCertificate({
      robotId: 'robot-1',
      certificate: CERT_PEM,
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
    });

    expect(result.robotId).toBe('robot-1');
    expect(result.fingerprint).toBe(FINGERPRINT);
    expect(result.status).toBe('active');
    expect(result.issuedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.expiresAt).toBeNull();

    expect(prisma.deviceCertificate.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.deviceCertificate.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ robotId: 'robot-1' });
  });

  it('passes a parsed expiresAt Date through to the create/update payloads', async () => {
    prisma.deviceCertificate.upsert.mockResolvedValue(
      makeRow({ expiresAt: new Date('2027-01-01T00:00:00.000Z') }) as never,
    );

    const result = await deviceRegistryService.registerCertificate({
      robotId: 'robot-1',
      certificate: CERT_PEM,
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      expiresAt: '2027-01-01T00:00:00.000Z',
    });

    const arg = prisma.deviceCertificate.upsert.mock.calls[0][0];
    expect(arg.create.expiresAt).toBeInstanceOf(Date);
    expect(arg.update.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('throws and does not touch the DB when the fingerprint does not match', async () => {
    await expect(
      deviceRegistryService.registerCertificate({
        robotId: 'robot-1',
        certificate: CERT_PEM,
        publicKey: PUBLIC_KEY,
        fingerprint: 'AA:BB:CC',
      }),
    ).rejects.toThrow(/Fingerprint mismatch/);

    expect(prisma.deviceCertificate.upsert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// verifyDevice
// ===========================================================================

describe('verifyDevice', () => {
  it('returns invalid when no certificate is registered', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(null as never);

    const result = await deviceRegistryService.verifyDevice('robot-1', FINGERPRINT);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No certificate registered for this device');
  });

  it('returns invalid when the certificate is revoked', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(
      makeRow({ status: 'revoked' }) as never,
    );

    const result = await deviceRegistryService.verifyDevice('robot-1', FINGERPRINT);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Certificate has been revoked');
  });

  it('returns invalid when the certificate has an expiry in the past', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(
      makeRow({ expiresAt: new Date('2000-01-01T00:00:00.000Z') }) as never,
    );

    const result = await deviceRegistryService.verifyDevice('robot-1', FINGERPRINT);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Certificate has expired');
  });

  it('returns invalid when the fingerprint does not match the stored one', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(makeRow() as never);

    const result = await deviceRegistryService.verifyDevice('robot-1', 'DE:AD:BE:EF');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Fingerprint does not match registered certificate');
  });

  it('returns valid for an active, unexpired, matching certificate', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(makeRow() as never);

    const result = await deviceRegistryService.verifyDevice('robot-1', FINGERPRINT);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

// ===========================================================================
// verifyChallengeResponse
// ===========================================================================

describe('verifyChallengeResponse', () => {
  it('returns invalid when no certificate is registered', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(null as never);

    const result = await deviceRegistryService.verifyChallengeResponse(
      'robot-1',
      NONCE,
      SIGNATURE,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No certificate registered for this device');
  });

  it('returns invalid when the certificate is not active', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(
      makeRow({ status: 'revoked' }) as never,
    );

    const result = await deviceRegistryService.verifyChallengeResponse(
      'robot-1',
      NONCE,
      SIGNATURE,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Certificate status: revoked');
  });

  it('verifies a genuine signature against the stored public key', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(makeRow() as never);

    const result = await deviceRegistryService.verifyChallengeResponse(
      'robot-1',
      NONCE,
      SIGNATURE,
    );
    expect(result.valid).toBe(true);
  });

  it('returns invalid for a signature over the wrong nonce', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(makeRow() as never);

    const result = await deviceRegistryService.verifyChallengeResponse(
      'robot-1',
      'a-different-nonce',
      SIGNATURE,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature verification failed');
  });

  it('returns a verification error reason when the public key is malformed', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(
      makeRow({ publicKey: 'not-a-real-key' }) as never,
    );

    const result = await deviceRegistryService.verifyChallengeResponse(
      'robot-1',
      NONCE,
      SIGNATURE,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature verification error');
  });
});

// ===========================================================================
// revokeCertificate
// ===========================================================================

describe('revokeCertificate', () => {
  it('returns null when no certificate exists for the robot', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(null as never);

    const result = await deviceRegistryService.revokeCertificate('robot-x');
    expect(result).toBeNull();
    expect(prisma.deviceCertificate.update).not.toHaveBeenCalled();
  });

  it('updates the status to revoked and returns the record', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(makeRow() as never);
    prisma.deviceCertificate.update.mockResolvedValue(
      makeRow({ status: 'revoked' }) as never,
    );

    const result = await deviceRegistryService.revokeCertificate('robot-1');
    expect(result?.status).toBe('revoked');
    expect(prisma.deviceCertificate.update).toHaveBeenCalledWith({
      where: { robotId: 'robot-1' },
      data: { status: 'revoked' },
    });
  });
});

// ===========================================================================
// listCertificates
// ===========================================================================

describe('listCertificates', () => {
  it('lists all certificates with no status filter', async () => {
    prisma.deviceCertificate.findMany.mockResolvedValue([
      makeRow({ id: 'a', robotId: 'r-a' }),
      makeRow({ id: 'b', robotId: 'r-b' }),
    ] as never);

    const result = await deviceRegistryService.listCertificates();
    expect(result).toHaveLength(2);
    expect(prisma.deviceCertificate.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { issuedAt: 'desc' },
    });
  });

  it('applies a status filter when provided', async () => {
    prisma.deviceCertificate.findMany.mockResolvedValue([] as never);

    const result = await deviceRegistryService.listCertificates('revoked');
    expect(result).toHaveLength(0);
    expect(prisma.deviceCertificate.findMany).toHaveBeenCalledWith({
      where: { status: 'revoked' },
      orderBy: { issuedAt: 'desc' },
    });
  });
});

// ===========================================================================
// getCertificate
// ===========================================================================

describe('getCertificate', () => {
  it('returns null when there is no certificate for the robot', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(null as never);

    const result = await deviceRegistryService.getCertificate('robot-x');
    expect(result).toBeNull();
  });

  it('returns a mapped record when a certificate exists', async () => {
    prisma.deviceCertificate.findUnique.mockResolvedValue(makeRow() as never);

    const result = await deviceRegistryService.getCertificate('robot-1');
    expect(result?.robotId).toBe('robot-1');
    expect(result?.fingerprint).toBe(FINGERPRINT);
    expect(result?.issuedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ===========================================================================
// Singleton + class shape
// ===========================================================================

describe('module exports', () => {
  it('exposes a singleton that is an instance of the service class', () => {
    expect(deviceRegistryService).toBeInstanceOf(DeviceRegistryService);
  });
});
