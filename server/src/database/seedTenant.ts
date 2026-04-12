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
  const [users, robots, datasets, trainingJobs, alerts, incidents, robotTasks, robotCommands] = await Promise.all([
    prisma.user.updateMany({
      where: { tenantId: null },
      data: { tenantId: DEFAULT_TENANT_ID },
    }),
    prisma.robot.updateMany({
      where: { tenantId: null },
      data: { tenantId: DEFAULT_TENANT_ID },
    }),
    prisma.dataset.updateMany({
      where: { tenantId: null },
      data: { tenantId: DEFAULT_TENANT_ID },
    }),
    prisma.trainingJob.updateMany({
      where: { tenantId: null },
      data: { tenantId: DEFAULT_TENANT_ID },
    }),
    prisma.alert.updateMany({
      where: { tenantId: null },
      data: { tenantId: DEFAULT_TENANT_ID },
    }),
    prisma.incident.updateMany({
      where: { tenantId: null },
      data: { tenantId: DEFAULT_TENANT_ID },
    }),
    prisma.robotTask.updateMany({
      where: { tenantId: null },
      data: { tenantId: DEFAULT_TENANT_ID },
    }),
    prisma.robotCommand.updateMany({
      where: { tenantId: null },
      data: { tenantId: DEFAULT_TENANT_ID },
    }),
  ]);

  const total =
    users.count + robots.count + datasets.count + trainingJobs.count +
    alerts.count + incidents.count + robotTasks.count + robotCommands.count;

  if (total > 0) {
    logger.info(
      {
        users: users.count,
        robots: robots.count,
        datasets: datasets.count,
        trainingJobs: trainingJobs.count,
        alerts: alerts.count,
        incidents: incidents.count,
        robotTasks: robotTasks.count,
        robotCommands: robotCommands.count,
      },
      `[MULTI_TENANCY] backfilled ${total} row(s) to DEFAULT tenant`
    );
  } else {
    logger.info('[MULTI_TENANCY] DEFAULT tenant ready (nothing to backfill)');
  }
}
