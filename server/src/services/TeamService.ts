/**
 * @file TeamService.ts
 * @description Tenant-scoped user management (TASK-163). Owners add,
 * role-change, and deactivate teammates via the Team page. Auto-scoped
 * by the Prisma isolation extension — every call runs inside the
 * caller's tenant ALS context, so `prisma.user.findMany()` already
 * filters by tenantId. We still pass `tenantId` explicitly on creates
 * (required by the schema) and on lookups so that platform super-admin
 * callers (running under `runAsPlatform`) also work.
 *
 * This service is deliberately free of any email delivery. The add
 * flow generates a temporary password and returns it in the response
 * once; the owner is responsible for handing it off out-of-band.
 * First-login force-password-change is wired up in TASK-164.
 * @feature team
 */

import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../database/index.js';
import { complianceLogService } from './ComplianceLogService.js';
import type { UserRole } from '../middleware/auth.middleware.js';

// Roles a tenant owner is allowed to assign. `super-admin` is
// intentionally NOT in this list — platform role management is a
// seeder + impersonation concern (TASK-160).
const ASSIGNABLE_ROLES = ['owner', 'member', 'viewer'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Constant "robot" used as the correlation key for team management audit events. */
const TEAM_AUDIT_ROBOT = 'platform-team-management';

// ============================================================================
// ERRORS
// ============================================================================

export class LastOwnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LastOwnerError';
  }
}

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`A user with email "${email}" already exists.`);
    this.name = 'EmailTakenError';
  }
}

export class InvalidRoleError extends Error {
  constructor(role: string) {
    super(
      `Invalid role "${role}". Must be one of: ${ASSIGNABLE_ROLES.join(', ')}.`
    );
    this.name = 'InvalidRoleError';
  }
}

export class TeamMemberNotFoundError extends Error {
  constructor() {
    super('Team member not found');
    this.name = 'TeamMemberNotFoundError';
  }
}

// ============================================================================
// DTO
// ============================================================================

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AddTeamMemberInput {
  tenantId: string;
  name: string;
  email: string;
  role: AssignableRole;
  /** If omitted, a temporary password is auto-generated. */
  tempPassword?: string;
  /** ID of the user performing the action (for audit). */
  actorId: string;
}

export interface AddTeamMemberResult {
  member: TeamMember;
  /**
   * Plaintext temporary password — returned exactly once so the owner
   * can copy it out-of-band. Never persisted anywhere else.
   */
  tempPassword: string;
}

function toDto(row: {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}): TeamMember {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as UserRole,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ============================================================================
// LAST-OWNER GUARD (transaction-aware)
// ============================================================================

/**
 * Refuse to leave a tenant with zero active owners. Runs inside the
 * caller's Prisma transaction so that the `count` and the subsequent
 * `update` are atomic — otherwise two concurrent requests could each
 * see `count > 0` (the target + the other caller's target) and both
 * demote/deactivate, ending up with zero owners.
 */
async function assertNotLastOwnerTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  targetUserId: string
): Promise<void> {
  const activeOwners = await tx.user.count({
    where: {
      tenantId,
      role: 'owner',
      isActive: true,
      NOT: { id: targetUserId },
    },
  });
  if (activeOwners === 0) {
    throw new LastOwnerError(
      'Cannot leave this tenant without an active owner. Promote another member to owner first.'
    );
  }
}

// ============================================================================
// PASSWORD GENERATION
// ============================================================================

/**
 * Generate a 12-character, reasonably-readable temp password using a
 * CSPRNG (`crypto.randomInt`). Excludes ambiguous glyphs (0/O, 1/l/I)
 * and guarantees at least one lowercase, uppercase, digit, and symbol.
 *
 * `Math.random` is NOT cryptographically secure — a compromised client
 * could brute-force the seeded sequence. `crypto.randomInt` is uniform
 * and seeded from the OS entropy pool.
 */
export function generateTempPassword(): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz'; // no i, l, o
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O
  const digits = '23456789'; // no 0, 1
  const symbols = '!@#$%^&*';
  const all = lower + upper + digits + symbols;

  function pick(set: string): string {
    return set[randomInt(0, set.length)];
  }

  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (chars.length < 12) chars.push(pick(all));

  // Fisher-Yates shuffle with crypto RNG
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ============================================================================
// SERVICE
// ============================================================================

export class TeamService {
  /**
   * List all members of a tenant (active + inactive, active first).
   *
   * NOTE: the Prisma isolation extension already filters by caller's
   * tenantId. We pass `tenantId` explicitly as well so that (a) the
   * where clause is self-documenting and (b) platform callers running
   * under `runAsPlatform` still get a scoped result.
   */
  async list(tenantId: string): Promise<TeamMember[]> {
    const rows = await prisma.user.findMany({
      where: { tenantId, kind: 'human' },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  async add(input: AddTeamMemberInput): Promise<AddTeamMemberResult> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!email || !name) {
      throw new Error('name and email are required');
    }
    if (!ASSIGNABLE_ROLES.includes(input.role)) {
      throw new InvalidRoleError(input.role);
    }

    const tempPassword = input.tempPassword?.trim() || generateTempPassword();
    if (tempPassword.length < 8) {
      throw new Error('Temporary password must be at least 8 characters');
    }

    const passwordHash = await bcrypt.hash(tempPassword, 10);

    let created;
    try {
      created = await prisma.user.create({
        data: {
          email,
          name,
          role: input.role,
          passwordHash,
          isActive: true,
          forcePasswordChange: true,
          tenantId: input.tenantId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new EmailTakenError(email);
      }
      throw err;
    }

    await this.auditLog({
      actorId: input.actorId,
      action: 'team.add',
      targetId: created.id,
      result: 'allowed',
      payload: { email, role: input.role, tenantId: input.tenantId },
    });

    return { member: toDto(created), tempPassword };
  }

  async changeRole(params: {
    tenantId: string;
    userId: string;
    newRole: AssignableRole;
    actorId: string;
  }): Promise<TeamMember> {
    if (!ASSIGNABLE_ROLES.includes(params.newRole)) {
      throw new InvalidRoleError(params.newRole);
    }

    // Wrap lookup + last-owner guard + update in a single transaction
    // so two concurrent requests can't both see a valid count of
    // active owners and both demote the last one.
    const { before, updated } = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { id: params.userId, tenantId: params.tenantId },
      });
      if (!existing) throw new TeamMemberNotFoundError();

      if (existing.role === 'owner' && params.newRole !== 'owner') {
        await assertNotLastOwnerTx(tx, params.tenantId, params.userId);
      }

      const updated = await tx.user.update({
        where: { id: params.userId },
        data: { role: params.newRole },
      });
      return { before: existing.role, updated };
    });

    await this.auditLog({
      actorId: params.actorId,
      action: 'team.change_role',
      targetId: params.userId,
      result: 'allowed',
      payload: {
        tenantId: params.tenantId,
        before,
        after: params.newRole,
      },
    });

    return toDto(updated);
  }

  async deactivate(params: {
    tenantId: string;
    userId: string;
    actorId: string;
  }): Promise<TeamMember> {
    const { existing, updated } = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { id: params.userId, tenantId: params.tenantId },
      });
      if (!existing) throw new TeamMemberNotFoundError();

      if (existing.role === 'owner') {
        await assertNotLastOwnerTx(tx, params.tenantId, params.userId);
      }

      const updated = await tx.user.update({
        where: { id: params.userId },
        data: { isActive: false },
      });
      return { existing, updated };
    });

    await this.auditLog({
      actorId: params.actorId,
      action: 'team.deactivate',
      targetId: params.userId,
      result: 'allowed',
      payload: { tenantId: params.tenantId, email: existing.email },
    });

    return toDto(updated);
  }

  async reactivate(params: {
    tenantId: string;
    userId: string;
    actorId: string;
  }): Promise<TeamMember> {
    const existing = await prisma.user.findFirst({
      where: { id: params.userId, tenantId: params.tenantId },
    });
    if (!existing) throw new TeamMemberNotFoundError();

    const updated = await prisma.user.update({
      where: { id: params.userId },
      data: { isActive: true },
    });

    await this.auditLog({
      actorId: params.actorId,
      action: 'team.reactivate',
      targetId: params.userId,
      result: 'allowed',
      payload: { tenantId: params.tenantId, email: existing.email },
    });

    return toDto(updated);
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
      const { sessionId } = complianceLogService.getOrCreateSession(
        TEAM_AUDIT_ROBOT
      );
      await complianceLogService.logAccess({
        sessionId,
        robotId: TEAM_AUDIT_ROBOT,
        operatorId: params.actorId,
        payload: {
          description: `Team management: ${params.action}`,
          resourceType: 'user',
          resourceId: params.targetId,
          action: params.action,
          result: params.result,
          metadata: params.payload,
        },
      });
    } catch (err) {
      // Audit logging must never block the primary mutation. Log and
      // continue — a failed audit write is a monitoring problem, not a
      // reason to refuse the user's action.
      console.error('[TeamService] audit log failed:', err);
    }
  }
}

export const teamService = new TeamService();
