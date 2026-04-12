/**
 * @file serviceAccount.types.ts
 * @description Types for service accounts and API tokens (TASK-165).
 * @feature team
 */

export type AssignableServiceRole = 'member' | 'viewer';

export interface ServiceAccount {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  kind: 'service';
  createdById: string | null;
  tokenCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdById: string;
}

export interface CreateServiceAccountInput {
  name: string;
  role: AssignableServiceRole;
}

export interface CreateTokenInput {
  name: string;
  expiresInDays?: number;
}

export interface CreateTokenResult {
  token: ApiTokenSummary;
  plaintext: string;
}

export interface RotateTokenResult {
  newToken: ApiTokenSummary;
  plaintext: string;
  oldTokenExpiresAt: string;
}
