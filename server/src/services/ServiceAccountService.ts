/**
 * @file ServiceAccountService.ts
 * @description Service account + API token management (TASK-165). Owners
 * create bot users with `kind='service'` and mint/rotate/revoke opaque
 * API tokens for them. Reuses the existing tenant isolation (Prisma
 * extension) and role middleware — service accounts are just User rows.
 * @feature auth
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../database/index.js';
import { complianceLogService } from './ComplianceLogService.js';
import { generateToken, hashToken, timingSafeEqualHex } from '../utils/tokens.js';
import { logger } from '../utils/logger.js';

// Service accounts max out at member. An owner creating a service
// account that could be owner → recursive privilege escalation.
const ASSIGNABLE_SERVICE_ROLES = ['member', 'viewer'] as const;
export type AssignableServiceRole = (typeof ASSIGNABLE_SERVICE_ROLES)[number];

const SA_AUDIT_ROBOT = 'platform-service-accounts';

const DEFAULT_EXPIRY_DAYS = 90;
const MAX_EXPIRY_DAYS = 365;
const ROTATION_GRACE_HOURS = 24;

// ============================================================================
// ERRORS
// ============================================================================

export class InvalidServiceRoleError extends Error {
  constructor(role: string) {
    super(`Invalid service account role "${role}". Must be one of: ${ASSIGNABLE_SERVICE_ROLES.join(', ')}.`);
    this.name = 'InvalidServiceRoleError';
  }
}

export class ServiceAccountNotFoundError extends Error {
  constructor() {
    super('Service account not found');
    this.name = 'ServiceAccountNotFoundError';
  }
}

export class TokenNotFoundError extends Error {
  constructor() {
    super('API token not found');
    this.name = 'TokenNotFoundError';
  }
}

export class DuplicateNameError extends Error {
  constructor(name: string) {
    super(`A service account named "${name}" already exists.`);
    this.name = 'DuplicateNameError';
  }
}

export class DuplicateTokenNameError extends Error {
  constructor(name: string) {
    super(`A token named "${name}" already exists for this service account.`);
    this.name = 'DuplicateTokenNameError';
  }
}

// ============================================================================
// DTOs
// ============================================================================

export interface ServiceAccountDto {
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

export interface ApiTokenDto {
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
  tenantId: string;
  name: string;
  role: AssignableServiceRole;
  actorId: string;
}

export interface CreateTokenInput {
  serviceAccountId: string;
  name: string;
  expiresInDays?: number;
  actorId: string;
}

export interface CreateTokenResult {
  token: ApiTokenDto;
  plaintext: string;
}

export interface RotateTokenResult {
  newToken: ApiTokenDto;
  plaintext: string;
  oldTokenExpiresAt: string;
}

// ============================================================================
// AUTH HELPER — used by auth middleware
// ============================================================================

export interface ServiceTokenAuthResult {
  userId: string;
  email: string;
  name: string;
  role: string;
  tenantId: string | null;
  tokenId: string;
}

/**
 * Authenticate a `Bearer ndsa_...` token. Returns the service account
 * user info if valid, null otherwise. Called by `auth.middleware.ts`.
 */
export async function authenticateServiceToken(
  rawToken: string
): Promise<ServiceTokenAuthResult | null> {
  const prefix = rawToken.slice(0, 12);
  const expectedHash = hashToken(rawToken);

  const candidates = await prisma.apiToken.findMany({
    where: { prefix, revokedAt: null },
    include: { user: true },
  });

  for (const t of candidates) {
    if (
      t.user.isActive &&
      t.user.kind === 'service' &&
      timingSafeEqualHex(t.hash, expectedHash) &&
      (!t.expiresAt || t.expiresAt > new Date())
    ) {
      // Best-effort lastUsedAt stamp — never blocks the request
      prisma.apiToken
        .update({ where: { id: t.id }, data: { lastUsedAt: new Date() } })
        .catch((err) => logger.warn({ err, tokenId: t.id }, 'lastUsedAt stamp failed'));

      return {
        userId: t.user.id,
        email: t.user.email,
        name: t.user.name,
        role: t.user.role,
        tenantId: t.user.tenantId,
        tokenId: t.id,
      };
    }
  }

  return null;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ServiceAccountService {
  /**
   * List service accounts for a tenant with their token counts.
   */
  async list(tenantId: string): Promise<ServiceAccountDto[]> {
    const rows = await prisma.user.findMany({
      where: { tenantId, kind: 'service' },
      include: {
        apiTokens: {
          where: { revokedAt: null },
          select: { lastUsedAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => {
      const lastUsed = r.apiTokens
        .map((t) => t.lastUsedAt)
        .filter(Boolean)
        .sort((a, b) => (b?.getTime() ?? 0) - (a?.getTime() ?? 0))[0];

      return {
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        isActive: r.isActive,
        kind: 'service' as const,
        createdById: r.createdById,
        tokenCount: r.apiTokens.length,
        lastUsedAt: lastUsed?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /**
   * Create a service account (a User with kind='service').
   */
  async create(input: CreateServiceAccountInput): Promise<ServiceAccountDto> {
    if (!ASSIGNABLE_SERVICE_ROLES.includes(input.role)) {
      throw new InvalidServiceRoleError(input.role);
    }

    const slug = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const email = `${slug}@service.local`;

    let created;
    try {
      created = await prisma.user.create({
        data: {
          email,
          name: input.name.trim(),
          role: input.role,
          passwordHash: '', // service accounts don't have passwords
          kind: 'service',
          tenantId: input.tenantId,
          isActive: true,
          forcePasswordChange: false,
          createdById: input.actorId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new DuplicateNameError(input.name);
      }
      throw err;
    }

    await this.auditLog({
      actorId: input.actorId,
      action: 'service_account.create',
      targetId: created.id,
      result: 'allowed',
      payload: { name: input.name, role: input.role, tenantId: input.tenantId },
    });

    return {
      id: created.id,
      name: created.name,
      email: created.email,
      role: created.role,
      isActive: created.isActive,
      kind: 'service',
      createdById: created.createdById,
      tokenCount: 0,
      lastUsedAt: null,
      createdAt: created.createdAt.toISOString(),
    };
  }

  /**
   * Soft-delete a service account (isActive=false). All its tokens
   * become invalid via the auth middleware's user.isActive check.
   */
  async delete(params: {
    tenantId: string;
    serviceAccountId: string;
    actorId: string;
  }): Promise<void> {
    const existing = await prisma.user.findFirst({
      where: {
        id: params.serviceAccountId,
        tenantId: params.tenantId,
        kind: 'service',
      },
    });
    if (!existing) throw new ServiceAccountNotFoundError();

    await prisma.user.update({
      where: { id: params.serviceAccountId },
      data: { isActive: false },
    });

    await this.auditLog({
      actorId: params.actorId,
      action: 'service_account.delete',
      targetId: params.serviceAccountId,
      result: 'allowed',
      payload: { name: existing.name, tenantId: params.tenantId },
    });
  }

  /**
   * List tokens for a service account.
   */
  async listTokens(serviceAccountId: string): Promise<ApiTokenDto[]> {
    const tokens = await prisma.apiToken.findMany({
      where: { userId: serviceAccountId },
      orderBy: { createdAt: 'desc' },
    });

    return tokens.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      expiresAt: t.expiresAt?.toISOString() ?? null,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      createdById: t.createdById,
    }));
  }

  /**
   * Mint a new API token for a service account.
   */
  async createToken(input: CreateTokenInput): Promise<CreateTokenResult> {
    // Verify the service account exists
    const sa = await prisma.user.findFirst({
      where: { id: input.serviceAccountId, kind: 'service' },
    });
    if (!sa) throw new ServiceAccountNotFoundError();

    const expiryDays = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
    if (expiryDays < 1 || expiryDays > MAX_EXPIRY_DAYS) {
      throw new Error(`Token expiry must be between 1 and ${MAX_EXPIRY_DAYS} days`);
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    const { plaintext, prefix, hash } = generateToken();

    let created;
    try {
      created = await prisma.apiToken.create({
        data: {
          userId: input.serviceAccountId,
          name: input.name.trim(),
          prefix,
          hash,
          expiresAt,
          createdById: input.actorId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new DuplicateTokenNameError(input.name);
      }
      throw err;
    }

    await this.auditLog({
      actorId: input.actorId,
      action: 'token.create',
      targetId: created.id,
      result: 'allowed',
      payload: {
        serviceAccountId: input.serviceAccountId,
        tokenName: input.name,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      token: {
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        expiresAt: created.expiresAt?.toISOString() ?? null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: created.createdAt.toISOString(),
        createdById: created.createdById,
      },
      plaintext,
    };
  }

  /**
   * Revoke a token. Sets revokedAt, doesn't delete the row.
   */
  async revokeToken(params: {
    tokenId: string;
    serviceAccountId: string;
    actorId: string;
  }): Promise<ApiTokenDto> {
    const token = await prisma.apiToken.findFirst({
      where: { id: params.tokenId, userId: params.serviceAccountId },
    });
    if (!token) throw new TokenNotFoundError();

    const updated = await prisma.apiToken.update({
      where: { id: params.tokenId },
      data: { revokedAt: new Date() },
    });

    await this.auditLog({
      actorId: params.actorId,
      action: 'token.revoke',
      targetId: params.tokenId,
      result: 'allowed',
      payload: {
        serviceAccountId: params.serviceAccountId,
        tokenName: token.name,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      prefix: updated.prefix,
      expiresAt: updated.expiresAt?.toISOString() ?? null,
      lastUsedAt: updated.lastUsedAt?.toISOString() ?? null,
      revokedAt: updated.revokedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      createdById: updated.createdById,
    };
  }

  /**
   * Rotate a token: create a new one and give the old one a 24h grace window.
   */
  async rotateToken(params: {
    tokenId: string;
    serviceAccountId: string;
    actorId: string;
  }): Promise<RotateTokenResult> {
    const oldToken = await prisma.apiToken.findFirst({
      where: { id: params.tokenId, userId: params.serviceAccountId },
    });
    if (!oldToken) throw new TokenNotFoundError();

    // Grace window: old token expires in 24h
    const graceExpiry = new Date();
    graceExpiry.setHours(graceExpiry.getHours() + ROTATION_GRACE_HOURS);

    await prisma.apiToken.update({
      where: { id: params.tokenId },
      data: { expiresAt: graceExpiry },
    });

    // Mint new token with same name (suffix -rotated to avoid unique conflict)
    const { plaintext, prefix, hash } = generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULT_EXPIRY_DAYS);

    const newTokenName = `${oldToken.name} (rotated)`;
    const created = await prisma.apiToken.create({
      data: {
        userId: params.serviceAccountId,
        name: newTokenName,
        prefix,
        hash,
        expiresAt,
        createdById: params.actorId,
      },
    });

    await this.auditLog({
      actorId: params.actorId,
      action: 'token.rotate',
      targetId: params.tokenId,
      result: 'allowed',
      payload: {
        serviceAccountId: params.serviceAccountId,
        oldTokenId: params.tokenId,
        newTokenId: created.id,
        graceExpiresAt: graceExpiry.toISOString(),
      },
    });

    return {
      newToken: {
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        expiresAt: created.expiresAt?.toISOString() ?? null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: created.createdAt.toISOString(),
        createdById: created.createdById,
      },
      plaintext,
      oldTokenExpiresAt: graceExpiry.toISOString(),
    };
  }

  // ==========================================================================
  // INTERNAL
  // ==========================================================================

  private async auditLog(params: {
    actorId: string;
    action: string;
    targetId: string;
    result: 'allowed' | 'denied';
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      const { sessionId } = complianceLogService.getOrCreateSession(SA_AUDIT_ROBOT);
      await complianceLogService.logAccess({
        sessionId,
        robotId: SA_AUDIT_ROBOT,
        operatorId: params.actorId,
        payload: {
          description: `Service accounts: ${params.action}`,
          resourceType: 'api-token',
          resourceId: params.targetId,
          action: params.action,
          result: params.result,
          metadata: params.payload,
        },
      });
    } catch (err) {
      console.error('[ServiceAccountService] audit log failed:', err);
    }
  }
}

export const serviceAccountService = new ServiceAccountService();
