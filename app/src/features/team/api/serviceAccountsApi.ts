/**
 * @file serviceAccountsApi.ts
 * @description REST client for `/api/team/service-accounts` endpoints (TASK-165).
 * @feature team
 */

import { apiClient } from '@/api/client';
import type {
  ServiceAccount,
  CreateServiceAccountInput,
  ApiTokenSummary,
  CreateTokenInput,
  CreateTokenResult,
  RotateTokenResult,
} from '../types/serviceAccount.types';

const BASE = '/team/service-accounts';

export const serviceAccountsApi = {
  async list(): Promise<ServiceAccount[]> {
    const res = await apiClient.get<{ accounts: ServiceAccount[] }>(BASE);
    return res.data.accounts;
  },

  async create(input: CreateServiceAccountInput): Promise<ServiceAccount> {
    const res = await apiClient.post<ServiceAccount>(BASE, input);
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`${BASE}/${id}`);
  },

  async listTokens(serviceAccountId: string): Promise<ApiTokenSummary[]> {
    const res = await apiClient.get<{ tokens: ApiTokenSummary[] }>(
      `${BASE}/${serviceAccountId}/tokens`
    );
    return res.data.tokens;
  },

  async createToken(
    serviceAccountId: string,
    input: CreateTokenInput
  ): Promise<CreateTokenResult> {
    const res = await apiClient.post<CreateTokenResult>(
      `${BASE}/${serviceAccountId}/tokens`,
      input
    );
    return res.data;
  },

  async revokeToken(
    serviceAccountId: string,
    tokenId: string
  ): Promise<ApiTokenSummary> {
    const res = await apiClient.delete<ApiTokenSummary>(
      `${BASE}/${serviceAccountId}/tokens/${tokenId}`
    );
    return res.data;
  },

  async rotateToken(
    serviceAccountId: string,
    tokenId: string
  ): Promise<RotateTokenResult> {
    const res = await apiClient.post<RotateTokenResult>(
      `${BASE}/${serviceAccountId}/tokens/${tokenId}/rotate`
    );
    return res.data;
  },
};
