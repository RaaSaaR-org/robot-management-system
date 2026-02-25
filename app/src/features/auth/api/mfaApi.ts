/**
 * @file mfaApi.ts
 * @description API calls for MFA endpoints
 * @feature auth
 * @apiCalls POST /auth/mfa/totp/setup, POST /auth/mfa/totp/verify-setup, POST /auth/mfa/totp/verify, GET /auth/mfa/recovery-codes, POST /auth/mfa/recovery-codes/generate, POST /auth/mfa/recovery-codes/verify, GET /auth/mfa/status, DELETE /auth/mfa/:id
 */

import { apiClient } from '@/api/client';
import type {
  TOTPSetupResponse,
  TOTPVerifySetupResponse,
  RecoveryCodeInfo,
  RecoveryCodeGenerateResponse,
  MFAVerifyResponse,
  MFAStatus,
} from '../types/auth.types';

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  totpSetup: '/auth/mfa/totp/setup',
  totpVerifySetup: '/auth/mfa/totp/verify-setup',
  totpVerify: '/auth/mfa/totp/verify',
  recoveryCodes: '/auth/mfa/recovery-codes',
  recoveryCodesGenerate: '/auth/mfa/recovery-codes/generate',
  recoveryCodesVerify: '/auth/mfa/recovery-codes/verify',
  status: '/auth/mfa/status',
  credential: (id: string) => `/auth/mfa/${id}`,
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const mfaApi = {
  /**
   * Initiate TOTP enrollment — returns secret and QR code URL.
   */
  async setupTOTP(): Promise<TOTPSetupResponse> {
    const response = await apiClient.post<TOTPSetupResponse>(ENDPOINTS.totpSetup);
    return response.data;
  },

  /**
   * Verify first TOTP code to complete enrollment.
   */
  async verifySetupTOTP(
    secret: string,
    token: string,
    name?: string
  ): Promise<TOTPVerifySetupResponse> {
    const response = await apiClient.post<TOTPVerifySetupResponse>(
      ENDPOINTS.totpVerifySetup,
      { secret, token, name }
    );
    return response.data;
  },

  /**
   * Verify TOTP code during login.
   */
  async verifyTOTP(userId: string, token: string): Promise<MFAVerifyResponse> {
    const response = await apiClient.post<MFAVerifyResponse>(ENDPOINTS.totpVerify, {
      userId,
      token,
    });
    return response.data;
  },

  /**
   * Get recovery code count.
   */
  async getRecoveryCodes(): Promise<RecoveryCodeInfo> {
    const response = await apiClient.get<RecoveryCodeInfo>(ENDPOINTS.recoveryCodes);
    return response.data;
  },

  /**
   * Generate new recovery codes (invalidates old ones).
   */
  async generateRecoveryCodes(): Promise<RecoveryCodeGenerateResponse> {
    const response = await apiClient.post<RecoveryCodeGenerateResponse>(
      ENDPOINTS.recoveryCodesGenerate
    );
    return response.data;
  },

  /**
   * Verify a recovery code during login.
   */
  async verifyRecoveryCode(
    userId: string,
    code: string
  ): Promise<MFAVerifyResponse> {
    const response = await apiClient.post<MFAVerifyResponse>(
      ENDPOINTS.recoveryCodesVerify,
      { userId, code }
    );
    return response.data;
  },

  /**
   * Get MFA status for current user.
   */
  async getStatus(): Promise<MFAStatus> {
    const response = await apiClient.get<MFAStatus>(ENDPOINTS.status);
    return response.data;
  },

  /**
   * Remove an MFA credential.
   */
  async removeCredential(credentialId: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.credential(credentialId));
  },
};
