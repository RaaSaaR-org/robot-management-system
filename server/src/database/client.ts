/**
 * @file client.ts
 * @description Prisma client singleton + tenant-isolation extension.
 *
 * When `MULTI_TENANCY_ENABLED=true` and a request is inside a
 * `withTenantContext` scope, the extension automatically:
 *   - scopes reads on allowlisted models by the caller's tenantId,
 *   - stamps writes with the caller's tenantId,
 *   - guards updates/deletes so they can't cross tenant boundaries.
 *
 * When the flag is off OR `getTenantId()` returns undefined (background
 * jobs, seeds, workers), the extension is a passthrough — behaviour is
 * identical to a plain PrismaClient, so single-tenant deployments pay
 * zero cost.
 *
 * Wave 1 allowlist: User, Robot, Dataset, TrainingJob (TASK-155).
 * Wave 3a: Alert, Incident, RobotTask, RobotCommand (TASK-158).
 * Wave 3b: ProcessDefinition, ProcessInstance, ApprovalRequest, Event.
 * Wave 3c: ModelVersion, Deployment, SimulationJob, SyntheticJob.
 * Wave 3d: Zone, Conversation.
 */

import { PrismaClient } from '@prisma/client';
import { MULTI_TENANCY_ENABLED } from '../config/features.js';
import { getTenantId } from '../middleware/tenantContext.js';

/**
 * Models that carry a `tenantId` column AND should be tenant-scoped.
 * Keep this in sync with the Prisma schema — adding a model here without
 * adding the column will blow up at runtime.
 */
const TENANT_SCOPED_MODELS = new Set<string>([
  // Wave 1 (TASK-155)
  'User',
  'Robot',
  'Dataset',
  'TrainingJob',
  // Wave 3a (TASK-158)
  'Alert',
  'Incident',
  'RobotTask',
  'RobotCommand',
  // Wave 3b
  'ProcessDefinition',
  'ProcessInstance',
  'ApprovalRequest',
  'Event',
  // Wave 3c
  'ModelVersion',
  'Deployment',
  'SimulationJob',
  'SyntheticJob',
  // Wave 3d
  'Zone',
  'Conversation',
]);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function buildPrisma(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  // If multi-tenancy is disabled, skip the extension entirely so there's
  // zero overhead in the hot path. Return the raw client.
  if (!MULTI_TENANCY_ENABLED) {
    return base;
  }

  // Apply tenant-isolation extension. The extended client is structurally
  // compatible with PrismaClient for the operations repositories use; we
  // cast back to PrismaClient so callers keep their existing types
  // (Prisma's $extends widens model types in ways that break .groupBy()
  // and transactional calls across our 20 repositories).
  const extended = base.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Skip non-scoped models: pass through untouched.
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          // Skip when outside a request scope (workers, seeds, jobs):
          // getTenantId() returns undefined and we let the caller decide.
          const tenantId = getTenantId();
          if (tenantId === undefined) {
            return query(args);
          }

          // `args` is shaped per operation. We cast to the minimum we need.
          const a = (args ?? {}) as Record<string, unknown>;

          switch (operation) {
            // READS — inject where.tenantId
            case 'findMany':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'count':
            case 'aggregate':
            case 'groupBy': {
              const where = (a.where as Record<string, unknown>) ?? {};
              a.where = { ...where, tenantId };
              return query(a);
            }

            // findUnique cannot take non-unique filters, so we can't
            // inject where.tenantId directly. Run the query and post-filter.
            case 'findUnique':
            case 'findUniqueOrThrow': {
              const result = (await query(a)) as
                | { tenantId?: string | null }
                | null;
              if (result && result.tenantId !== tenantId) {
                if (operation === 'findUniqueOrThrow') {
                  throw new Error(
                    `[tenant-isolation] ${model} not found in tenant ${tenantId}`
                  );
                }
                return null;
              }
              return result;
            }

            // WRITES — stamp data.tenantId
            case 'create': {
              const data = (a.data as Record<string, unknown>) ?? {};
              a.data = { ...data, tenantId };
              return query(a);
            }

            case 'createMany': {
              const data = a.data;
              if (Array.isArray(data)) {
                a.data = data.map((row: Record<string, unknown>) => ({
                  ...row,
                  tenantId,
                }));
              } else if (data && typeof data === 'object') {
                a.data = { ...(data as Record<string, unknown>), tenantId };
              }
              return query(a);
            }

            // upsert: scope lookup AND stamp the create payload
            case 'upsert': {
              const where = (a.where as Record<string, unknown>) ?? {};
              const create = (a.create as Record<string, unknown>) ?? {};
              a.where = { ...where, tenantId };
              a.create = { ...create, tenantId };
              return query(a);
            }

            // MUTATIONS — guard where.tenantId so cross-tenant ops 404
            case 'update':
            case 'delete': {
              // These use a unique `where` which can't accept tenantId
              // directly. Verify ownership via findUnique on the base
              // client before allowing the mutation through.
              const where = (a.where as Record<string, unknown>) ?? {};
              const modelKey =
                model.charAt(0).toLowerCase() + model.slice(1);
              const repo = (base as unknown as Record<
                string,
                {
                  findUnique: (opts: {
                    where: Record<string, unknown>;
                  }) => Promise<{ tenantId?: string | null } | null>;
                }
              >)[modelKey];
              const found = await repo.findUnique({ where });
              if (!found || found.tenantId !== tenantId) {
                throw new Error(
                  `[tenant-isolation] ${model} ${operation} denied: not found in tenant ${tenantId}`
                );
              }
              return query(a);
            }

            case 'updateMany':
            case 'deleteMany': {
              const where = (a.where as Record<string, unknown>) ?? {};
              a.where = { ...where, tenantId };
              return query(a);
            }

            default:
              // Unknown op — pass through rather than silently drop filtering.
              return query(args);
          }
        },
      },
    },
  });

  return extended as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? buildPrisma();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
