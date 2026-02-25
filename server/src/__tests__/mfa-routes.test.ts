/**
 * @file mfa-routes.test.ts
 * @description Integration tests for MFA routes — setup, validate, recovery, rate limiting
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-key-for-tests';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockMfaService, mockAuthService, mockUserRepository, mockRefreshTokenRepository } = vi.hoisted(() => ({
  mockMfaService: {
    generateTOTPSecret: vi.fn(),
    verifyTOTP: vi.fn(),
    enableTOTP: vi.fn(),
    disableTOTP: vi.fn(),
    getTOTPCredential: vi.fn(),
    validateTOTP: vi.fn(),
    getMFAStatus: vi.fn(),
    generateRecoveryCodes: vi.fn(),
    hashRecoveryCodes: vi.fn(),
    storeRecoveryCodes: vi.fn(),
    verifyRecoveryCode: vi.fn(),
    recordFailedAttempt: vi.fn(),
    resetLoginAttempts: vi.fn(),
    isLocked: vi.fn(),
    lockAccount: vi.fn(),
    checkPasswordComplexity: vi.fn(),
  },
  mockAuthService: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    refreshTokens: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
    generateAccessToken: vi.fn(),
    verifyAccessToken: vi.fn(),
  },
  mockUserRepository: {
    findByEmail: vi.fn(),
    findById: vi.fn(),
  },
  mockRefreshTokenRepository: {
    create: vi.fn(),
  },
}));

vi.mock('../services/MFAService.js', () => ({
  mfaService: mockMfaService,
}));

vi.mock('../services/AuthService.js', () => ({
  authService: mockAuthService,
}));

vi.mock('../repositories/index.js', () => ({
  userRepository: mockUserRepository,
  refreshTokenRepository: mockRefreshTokenRepository,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { authRoutes } from '../routes/auth.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes);
  return app;
}

describe('MFA Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // POST /auth/mfa/totp/setup
  // --------------------------------------------------------------------------

  describe('POST /auth/mfa/totp/setup', () => {
    it('requires auth and returns secret + otpauthUrl', async () => {
      mockMfaService.getTOTPCredential.mockResolvedValue(null);
      mockMfaService.generateTOTPSecret.mockReturnValue({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/RoboMindOS:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=RoboMindOS',
      });

      const app = createApp();
      const res = await request(app).post('/auth/mfa/totp/setup');

      expect(res.status).toBe(200);
      expect(res.body.secret).toBe('JBSWY3DPEHPK3PXP');
      expect(res.body.otpauthUrl).toContain('otpauth://totp/');
    });

    it('returns 409 if TOTP already configured', async () => {
      mockMfaService.getTOTPCredential.mockResolvedValue({ id: 'cred-1', type: 'totp' });

      const app = createApp();
      const res = await request(app).post('/auth/mfa/totp/setup');

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Conflict');
    });
  });

  // --------------------------------------------------------------------------
  // POST /auth/mfa/totp/validate
  // --------------------------------------------------------------------------

  describe('POST /auth/mfa/totp/validate', () => {
    it('validates token and returns access token on success', async () => {
      const mfaToken = jwt.sign({ userId: 'user-123', scope: 'mfa-pending' }, JWT_SECRET, { expiresIn: '5m' });

      mockMfaService.validateTOTP.mockResolvedValue(true);
      mockMfaService.resetLoginAttempts.mockResolvedValue(undefined);
      mockAuthService.getCurrentUser.mockResolvedValue({ id: 'user-123', email: 'test@example.com' });

      mockUserRepository.findById.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test',
        role: 'admin',
      } as any);
      mockRefreshTokenRepository.create.mockResolvedValue(undefined as any);

      mockAuthService.generateAccessToken.mockReturnValue('new-access-token');

      const app = createApp();
      const res = await request(app)
        .post('/auth/mfa/totp/validate')
        .send({ userId: 'user-123', code: '123456', mfaToken });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBe('new-access-token');
      expect(res.body.refreshToken).toBeDefined();
    });

    it('returns 401 on wrong TOTP code', async () => {
      const mfaToken = jwt.sign({ userId: 'user-123', scope: 'mfa-pending' }, JWT_SECRET, { expiresIn: '5m' });

      mockMfaService.validateTOTP.mockResolvedValue(false);
      mockMfaService.recordFailedAttempt.mockResolvedValue({ locked: false, attempts: 1 });

      const app = createApp();
      const res = await request(app)
        .post('/auth/mfa/totp/validate')
        .send({ userId: 'user-123', code: '000000', mfaToken });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid TOTP code');
    });

    it('returns 401 on invalid mfa token scope', async () => {
      // Regular access token without mfa-pending scope
      const regularToken = jwt.sign({ userId: 'user-123', email: 'test@example.com' }, JWT_SECRET, { expiresIn: '15m' });

      const app = createApp();
      const res = await request(app)
        .post('/auth/mfa/totp/validate')
        .send({ userId: 'user-123', code: '123456', mfaToken: regularToken });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid MFA token');
    });

    it('returns 401 on expired mfa token', async () => {
      const expiredToken = jwt.sign({ userId: 'user-123', scope: 'mfa-pending' }, JWT_SECRET, { expiresIn: '0s' });

      // Wait a moment for it to expire
      await new Promise(r => setTimeout(r, 50));

      const app = createApp();
      const res = await request(app)
        .post('/auth/mfa/totp/validate')
        .send({ userId: 'user-123', code: '123456', mfaToken: expiredToken });

      expect(res.status).toBe(401);
    });

    it('returns 400 when missing required fields', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/auth/mfa/totp/validate')
        .send({ userId: 'user-123' });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // POST /auth/mfa/recovery/use
  // --------------------------------------------------------------------------

  describe('POST /auth/mfa/recovery/use', () => {
    it('uses recovery code and returns access token', async () => {
      const mfaToken = jwt.sign({ userId: 'user-123', scope: 'mfa-pending' }, JWT_SECRET, { expiresIn: '5m' });

      mockMfaService.verifyRecoveryCode.mockResolvedValue(true);
      mockMfaService.resetLoginAttempts.mockResolvedValue(undefined);

      mockUserRepository.findById.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test',
        role: 'admin',
      } as any);
      mockRefreshTokenRepository.create.mockResolvedValue(undefined as any);

      mockAuthService.generateAccessToken.mockReturnValue('new-access-token');

      const app = createApp();
      const res = await request(app)
        .post('/auth/mfa/recovery/use')
        .send({ userId: 'user-123', code: 'ABCDEF1234', mfaToken });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBe('new-access-token');
    });

    it('returns 401 on invalid recovery code', async () => {
      const mfaToken = jwt.sign({ userId: 'user-123', scope: 'mfa-pending' }, JWT_SECRET, { expiresIn: '5m' });

      mockMfaService.verifyRecoveryCode.mockResolvedValue(false);

      const app = createApp();
      const res = await request(app)
        .post('/auth/mfa/recovery/use')
        .send({ userId: 'user-123', code: 'INVALIDCODE', mfaToken });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid recovery code');
    });
  });

  // --------------------------------------------------------------------------
  // Rate Limiting
  // --------------------------------------------------------------------------

  describe('Rate limiting', () => {
    it('returns 429 after exceeding validate rate limit', async () => {
      const mfaToken = jwt.sign({ userId: 'user-123', scope: 'mfa-pending' }, JWT_SECRET, { expiresIn: '5m' });

      mockMfaService.validateTOTP.mockResolvedValue(false);
      mockMfaService.recordFailedAttempt.mockResolvedValue({ locked: false, attempts: 1 });

      const app = createApp();

      // Send 10 requests (max allowed)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/auth/mfa/totp/validate')
          .send({ userId: 'user-123', code: '000000', mfaToken });
      }

      // 11th request should be rate limited
      const res = await request(app)
        .post('/auth/mfa/totp/validate')
        .send({ userId: 'user-123', code: '000000', mfaToken });

      expect(res.status).toBe(429);
    });

    it('returns 429 after exceeding setup rate limit', async () => {
      mockMfaService.getTOTPCredential.mockResolvedValue(null);
      mockMfaService.generateTOTPSecret.mockReturnValue({
        secret: 'TEST',
        otpauthUrl: 'otpauth://totp/test',
      });

      const app = createApp();

      // Send 5 requests (max allowed)
      for (let i = 0; i < 5; i++) {
        await request(app).post('/auth/mfa/totp/setup');
      }

      // 6th request should be rate limited
      const res = await request(app).post('/auth/mfa/totp/setup');
      expect(res.status).toBe(429);
    });
  });

  // --------------------------------------------------------------------------
  // GET /auth/mfa/status
  // --------------------------------------------------------------------------

  describe('GET /auth/mfa/status', () => {
    it('returns MFA status', async () => {
      mockMfaService.getMFAStatus.mockResolvedValue({
        mfaEnabled: true,
        totpConfigured: true,
        hasRecoveryCodes: true,
      });

      const app = createApp();
      const res = await request(app).get('/auth/mfa/status');

      expect(res.status).toBe(200);
      expect(res.body.mfaEnabled).toBe(true);
      expect(res.body.totpConfigured).toBe(true);
    });
  });
});
