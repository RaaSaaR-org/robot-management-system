/**
 * @file seedTenant.ts
 * @description Seeds the DEFAULT tenant and backfills existing pilot-model
 * rows when row-level multi-tenancy is enabled. No-op when
 * MULTI_TENANCY_ENABLED=false. Safe to run on every boot — upsert semantics
 * + WHERE tenantId IS NULL guards prevent duplicate work.
 *
 * Runs outside any request scope, so the Prisma client extension's
 * `getTenantId()` returns undefined and queries pass through untouched —
 * which is exactly what we need for seeding and backfilling.
 *
 * Wave 1 scope: User, Robot, Dataset, TrainingJob.
 * Wave 3a scope: Alert, Incident, RobotTask, RobotCommand.
 * Wave 3b scope: ProcessDefinition, ProcessInstance, ApprovalRequest, Event.
 * Wave 3c scope: ModelVersion, Deployment, SimulationJob, SyntheticJob.
 * Wave 3d scope: Zone, Conversation.
 *
 * @feature multi-tenancy
 */

import { prisma } from './client.js';
import { MULTI_TENANCY_ENABLED, DEFAULT_TENANT_ID } from '../config/features.js';
import { logger } from '../utils/logger.js';

export async function seedDefaultTenant(): Promise<void> {
  if (!MULTI_TENANCY_ENABLED) {
    return;
  }

  // Upsert DEFAULT tenant — id stays stable so the backfill below always
  // targets the same row, even if a slug/name change lands later.
  await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    create: {
      id: DEFAULT_TENANT_ID,
      slug: DEFAULT_TENANT_ID,
      name: 'Default Organization',
      settings: '{}',
    },
    update: {},
  });

  // Backfill each scoped model. `updateMany` with `where: { tenantId: null }`
  // is idempotent — subsequent boots see zero rows to update.
  const backfill = (model: { updateMany: (args: { where: { tenantId: null }; data: { tenantId: string } }) => Promise<{ count: number }> }) =>
    model.updateMany({ where: { tenantId: null }, data: { tenantId: DEFAULT_TENANT_ID } });

  const results = await Promise.all([
    // Wave 1
    backfill(prisma.user),
    backfill(prisma.robot),
    backfill(prisma.dataset),
    backfill(prisma.trainingJob),
    // Wave 3a
    backfill(prisma.alert),
    backfill(prisma.incident),
    backfill(prisma.robotTask),
    backfill(prisma.robotCommand),
    // Wave 3b
    backfill(prisma.processDefinition),
    backfill(prisma.processInstance),
    backfill(prisma.approvalRequest),
    backfill(prisma.event),
    // Wave 3c
    backfill(prisma.modelVersion),
    backfill(prisma.deployment),
    backfill(prisma.simulationJob),
    backfill(prisma.syntheticJob),
    // Wave 3d
    backfill(prisma.zone),
    backfill(prisma.conversation),
  ]);

  const labels = [
    'users', 'robots', 'datasets', 'trainingJobs',
    'alerts', 'incidents', 'robotTasks', 'robotCommands',
    'processDefinitions', 'processInstances', 'approvalRequests', 'events',
    'modelVersions', 'deployments', 'simulationJobs', 'syntheticJobs',
    'zones', 'conversations',
  ];

  const total = results.reduce((sum, r) => sum + r.count, 0);

  if (total > 0) {
    const counts: Record<string, number> = {};
    labels.forEach((label, i) => { counts[label] = results[i].count; });
    logger.info(
      counts,
      `[MULTI_TENANCY] backfilled ${total} row(s) to DEFAULT tenant`
    );
  } else {
    logger.info('[MULTI_TENANCY] DEFAULT tenant ready (nothing to backfill)');
  }
}
