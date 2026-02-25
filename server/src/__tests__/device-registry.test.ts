/**
 * @file device-registry.test.ts
 * @description Tests for device certificate registry routes
 * @feature security
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock DeviceRegistryService before import
const mockDeviceRegistryService = {
  registerCertificate: vi.fn(),
  verifyDevice: vi.fn(),
  verifyChallengeResponse: vi.fn(),
  revokeCertificate: vi.fn(),
  listCertificates: vi.fn(),
  getCertificate: vi.fn(),
};

vi.mock('../services/DeviceRegistryService.js', () => ({
  deviceRegistryService: mockDeviceRegistryService,
  DeviceRegistryService: vi.fn(),
}));

const { securityRoutes } = await import('../routes/security.routes.js');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/security', securityRoutes);
  return app;
}

const mockCertRecord = {
  id: 'cert-001',
  robotId: 'robot-001',
  fingerprint: 'AA:BB:CC:DD:EE:FF',
  publicKey: '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----',
  certificate: '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----',
  issuedAt: '2026-02-25T00:00:00.000Z',
  expiresAt: '2027-02-25T00:00:00.000Z',
  status: 'active',
};

describe('Security Routes', () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/security/devices/register', () => {
    it('registers a device certificate', async () => {
      mockDeviceRegistryService.registerCertificate.mockResolvedValue(mockCertRecord);

      const res = await request(app)
        .post('/api/security/devices/register')
        .send({
          robotId: 'robot-001',
          certificate: mockCertRecord.certificate,
          publicKey: mockCertRecord.publicKey,
          fingerprint: mockCertRecord.fingerprint,
        });

      expect(res.status).toBe(201);
      expect(res.body.robotId).toBe('robot-001');
      expect(res.body.fingerprint).toBe('AA:BB:CC:DD:EE:FF');
      expect(mockDeviceRegistryService.registerCertificate).toHaveBeenCalledOnce();
    });

    it('returns 400 on missing fields', async () => {
      const res = await request(app)
        .post('/api/security/devices/register')
        .send({ robotId: 'robot-001' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });

    it('returns 400 on fingerprint mismatch', async () => {
      mockDeviceRegistryService.registerCertificate.mockRejectedValue(
        new Error('Fingerprint mismatch')
      );

      const res = await request(app)
        .post('/api/security/devices/register')
        .send({
          robotId: 'robot-001',
          certificate: 'cert',
          publicKey: 'key',
          fingerprint: 'wrong',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Fingerprint mismatch');
    });
  });

  describe('GET /api/security/devices', () => {
    it('lists all certificates', async () => {
      mockDeviceRegistryService.listCertificates.mockResolvedValue([mockCertRecord]);

      const res = await request(app).get('/api/security/devices');

      expect(res.status).toBe(200);
      expect(res.body.certificates).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });

    it('filters by status', async () => {
      mockDeviceRegistryService.listCertificates.mockResolvedValue([]);

      const res = await request(app).get('/api/security/devices?status=revoked');

      expect(res.status).toBe(200);
      expect(mockDeviceRegistryService.listCertificates).toHaveBeenCalledWith('revoked');
    });
  });

  describe('GET /api/security/devices/:robotId', () => {
    it('returns a specific certificate', async () => {
      mockDeviceRegistryService.getCertificate.mockResolvedValue(mockCertRecord);

      const res = await request(app).get('/api/security/devices/robot-001');

      expect(res.status).toBe(200);
      expect(res.body.robotId).toBe('robot-001');
    });

    it('returns 404 for unknown device', async () => {
      mockDeviceRegistryService.getCertificate.mockResolvedValue(null);

      const res = await request(app).get('/api/security/devices/unknown');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/security/devices/:robotId/verify', () => {
    it('verifies by fingerprint', async () => {
      mockDeviceRegistryService.verifyDevice.mockResolvedValue({ valid: true });

      const res = await request(app)
        .post('/api/security/devices/robot-001/verify')
        .send({ fingerprint: 'AA:BB:CC:DD:EE:FF' });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    });

    it('verifies by challenge-response', async () => {
      mockDeviceRegistryService.verifyChallengeResponse.mockResolvedValue({ valid: true });

      const res = await request(app)
        .post('/api/security/devices/robot-001/verify')
        .send({ nonce: 'test-nonce', signature: 'base64sig', algorithm: 'RSA-SHA256' });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(mockDeviceRegistryService.verifyChallengeResponse).toHaveBeenCalledWith(
        'robot-001',
        'test-nonce',
        'base64sig',
        'RSA-SHA256'
      );
    });

    it('rejects invalid fingerprint', async () => {
      mockDeviceRegistryService.verifyDevice.mockResolvedValue({
        valid: false,
        reason: 'Fingerprint does not match',
      });

      const res = await request(app)
        .post('/api/security/devices/robot-001/verify')
        .send({ fingerprint: 'WRONG' });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.reason).toContain('Fingerprint');
    });

    it('returns 400 when no verification data provided', async () => {
      const res = await request(app)
        .post('/api/security/devices/robot-001/verify')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/security/devices/:robotId', () => {
    it('revokes a certificate', async () => {
      mockDeviceRegistryService.revokeCertificate.mockResolvedValue({
        ...mockCertRecord,
        status: 'revoked',
      });

      const res = await request(app).delete('/api/security/devices/robot-001');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Certificate revoked');
      expect(res.body.certificate.status).toBe('revoked');
    });

    it('returns 404 for unknown device', async () => {
      mockDeviceRegistryService.revokeCertificate.mockResolvedValue(null);

      const res = await request(app).delete('/api/security/devices/unknown');

      expect(res.status).toBe(404);
    });
  });
});
