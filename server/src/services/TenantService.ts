/**
 * @file TenantService.ts
 * @description CRUD + count aggregation for Tenant rows. Thin wrapper
 * over the Prisma client — the row-level isolation extension already
 * handles tenantId injection on scoped models, so this service only
 * deals with the Tenant table itself (which is intentionally NOT in
 * TENANT_SCOPED_MODELS — tenants are platform-level, not tenant-level).
 *
 * Wave 2 of TASK-155 (demo UI).
 * @feature multi-tenancy
 */

import bcrypt from 'bcryptjs';
import { prisma } from '../database/index.js';
import { DEFAULT_TENANT_ID } from '../config/features.js';
import { runAsPlatform } from '../middleware/tenantContext.js';
import { logger } from '../utils/logger.js';

export interface TenantCounts {
  users: number;
  robots: number;
  datasets: number;
  trainingJobs: number;
}

export interface TenantWithCounts {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  plan: string | null;
  settings: string;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
  counts: TenantCounts;
}

export interface CreateTenantInput {
  name: string;
  slug?: string;
  logoUrl?: string | null;
  plan?: string | null;
}

export interface UpdateTenantInput {
  name?: string;
  logoUrl?: string | null;
  plan?: string | null;
  settings?: Record<string, unknown>;
}

export class TenantNotEmptyError extends Error {
  constructor(public counts: TenantCounts) {
    super('Tenant is not empty');
    this.name = 'TenantNotEmptyError';
  }
}

export class TenantSlugTakenError extends Error {
  constructor(slug: string) {
    super(`Slug "${slug}" is already in use`);
    this.name = 'TenantSlugTakenError';
  }
}

/** Slugify a tenant name — lowercase, alphanumerics + hyphens only. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug) && slug.length <= 64;
}

async function countsFor(tenantId: string): Promise<TenantCounts> {
  // Run as platform so the tenant-isolation extension doesn't override
  // our explicit `where.tenantId` filter with the caller's ALS context.
  // We deliberately want per-tenant counts here — this is the operator
  // view, not a tenant-scoped query.
  return runAsPlatform(async () => {
    const [users, robots, datasets, trainingJobs] = await Promise.all([
      prisma.user.count({ where: { tenantId } }),
      prisma.robot.count({ where: { tenantId } }),
      prisma.dataset.count({ where: { tenantId } }),
      prisma.trainingJob.count({ where: { tenantId } }),
    ]);
    return { users, robots, datasets, trainingJobs };
  }) as Promise<TenantCounts>;
}

function toDto(
  row: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    plan: string | null;
    settings: string;
    createdAt: Date;
    updatedAt: Date;
  },
  counts: TenantCounts
): TenantWithCounts {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logoUrl: row.logoUrl,
    plan: row.plan,
    settings: row.settings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isDefault: row.id === DEFAULT_TENANT_ID,
    counts,
  };
}

export class TenantService {
  async list(): Promise<TenantWithCounts[]> {
    const rows = await prisma.tenant.findMany({
      orderBy: [{ createdAt: 'asc' }],
    });
    const dtos = await Promise.all(
      rows.map(async (row) => toDto(row, await countsFor(row.id)))
    );
    return dtos;
  }

  async get(id: string): Promise<TenantWithCounts | null> {
    const row = await prisma.tenant.findUnique({ where: { id } });
    if (!row) return null;
    return toDto(row, await countsFor(row.id));
  }

  async getBySlug(slug: string): Promise<TenantWithCounts | null> {
    const row = await prisma.tenant.findUnique({ where: { slug } });
    if (!row) return null;
    return toDto(row, await countsFor(row.id));
  }

  async create(input: CreateTenantInput): Promise<TenantWithCounts> {
    const name = input.name.trim();
    if (!name) {
      throw new Error('name is required');
    }

    const slug = (input.slug?.trim() || slugify(name)).toLowerCase();
    if (!isValidSlug(slug)) {
      throw new Error(
        'slug must be lowercase alphanumerics + hyphens (e.g. "acme-robotics")'
      );
    }

    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
      throw new TenantSlugTakenError(slug);
    }

    const row = await prisma.tenant.create({
      data: {
        slug,
        name,
        logoUrl: input.logoUrl ?? null,
        plan: input.plan ?? null,
      },
    });
    return toDto(row, await countsFor(row.id));
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantWithCounts> {
    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Tenant not found');
    }

    const data: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error('name cannot be empty');
      data.name = name;
    }

    if (input.logoUrl !== undefined) {
      if (input.logoUrl !== null && input.logoUrl !== '') {
        try { new URL(input.logoUrl); } catch {
          throw new Error('logoUrl must be a valid URL');
        }
      }
      data.logoUrl = input.logoUrl || null;
    }

    if (input.plan !== undefined) {
      data.plan = input.plan;
    }

    if (input.settings !== undefined) {
      data.settings = JSON.stringify(input.settings);
    }

    const row = await prisma.tenant.update({ where: { id }, data });
    return toDto(row, await countsFor(row.id));
  }

  /**
   * Delete a tenant. Refuses to delete:
   *   - the DEFAULT tenant (system-protected)
   *   - any tenant that still owns users/robots/datasets/training jobs
   *     (caller must migrate or delete those first).
   */
  async delete(id: string): Promise<void> {
    if (id === DEFAULT_TENANT_ID) {
      throw new Error('Cannot delete the DEFAULT tenant');
    }

    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Tenant not found');
    }

    const counts = await countsFor(id);
    const total =
      counts.users + counts.robots + counts.datasets + counts.trainingJobs;
    if (total > 0) {
      throw new TenantNotEmptyError(counts);
    }

    await prisma.tenant.delete({ where: { id } });
  }

  /**
   * Atomic onboarding: create tenant + first admin user + optional starter
   * resources in a single transaction. Rolls back everything if any step fails.
   */
  async onboard(input: {
    tenant: CreateTenantInput;
    adminUser: { email: string; name: string; password: string };
    starterResources?: { cloneRobots?: boolean };
  }): Promise<{
    tenant: TenantWithCounts;
    adminUser: { id: string; email: string };
  }> {
    const slug = (input.tenant.slug?.trim() || slugify(input.tenant.name)).toLowerCase();
    if (!isValidSlug(slug)) {
      throw new Error('slug must be lowercase alphanumerics + hyphens');
    }

    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
      throw new TenantSlugTakenError(slug);
    }

    const passwordHash = await bcrypt.hash(input.adminUser.password, 12);

    const result = await prisma.$transaction(async (tx) => {
      // Step 1: Create tenant
      const tenantRow = await tx.tenant.create({
        data: {
          slug,
          name: input.tenant.name.trim(),
          logoUrl: input.tenant.logoUrl ?? null,
          plan: input.tenant.plan ?? null,
        },
      });

      // Step 2: Create first admin user (owner role, force password change)
      const userRow = await tx.user.create({
        data: {
          email: input.adminUser.email.trim().toLowerCase(),
          name: input.adminUser.name.trim(),
          passwordHash,
          role: 'owner',
          tenantId: tenantRow.id,
          forcePasswordChange: true,
        },
      });

      // Step 3: Optionally clone robots from DEFAULT tenant
      if (input.starterResources?.cloneRobots) {
        const defaultRobots = await tx.robot.findMany({
          where: { tenantId: DEFAULT_TENANT_ID },
          select: { name: true, model: true, serialNumber: true },
        });
        if (defaultRobots.length > 0) {
          await tx.robot.createMany({
            data: defaultRobots.map((r) => ({
              name: r.name,
              model: r.model,
              tenantId: tenantRow.id,
            })),
          });
          logger.info(
            { tenantId: tenantRow.id, count: defaultRobots.length },
            '[ONBOARD] Cloned robots from DEFAULT'
          );
        }
      }

      return { tenantRow, userRow };
    });

    const counts = await countsFor(result.tenantRow.id);
    return {
      tenant: toDto(result.tenantRow, counts),
      adminUser: {
        id: result.userRow.id,
        email: result.userRow.email,
      },
    };
  }
}

export const tenantService = new TenantService();
