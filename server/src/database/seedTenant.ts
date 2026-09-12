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
 * Wave 3e scope: ApiToken.
 * Wave 3f scope: EpisodeReward, InterventionEpisode (TASK-179).
 * TASK-285 scope: DigitalTwin, ScanSession, SimScene.
 * TASK-286 scope: SensorScan (paged), MotionClip, VlaSession.
 *
 * @feature multi-tenancy
 */

import { prisma } from './client.js';
import { ensureDefaultTenant } from './defaultTenant.js';
import { MULTI_TENANCY_ENABLED, DEFAULT_TENANT_ID } from '../config/features.js';
import { logger } from '../utils/logger.js';

/** The row shape `backfillPaged` needs: enough to page by id and stamp a page. */
interface PageableModel {
  findMany: (args: {
    where: { tenantId: null };
    select: { id: true };
    take: number;
  }) => Promise<{ id: string }[]>;
  updateMany: (args: {
    where: { id: { in: string[] } };
    data: { tenantId: string };
  }) => Promise<{ count: number }>;
}

/**
 * Backfill in pages, for tables too large to stamp in one statement.
 *
 * `backfill()` above issues a single unbounded `updateMany`. On `SensorScan` —
 * one row per LiDAR frame of every sweep ever captured — that is a single
 * statement over potentially millions of rows, holding a write lock inside the
 * boot path and stalling startup with no output. This selects a page of ids
 * first and stamps that page, because Prisma's `updateMany` takes no `take`.
 *
 * The loop terminates because each pass stamps the rows it just selected, so
 * they no longer match `tenantId: null` on the next pass. A page that stamps
 * zero rows would otherwise spin forever, so it breaks rather than trusting
 * that invariant.
 *
 * Progress is logged per page: a long backfill must look like work, not a hang.
 */
export async function backfillPaged(
  model: PageableModel,
  label: string,
  pageSize = 5_000
): Promise<{ count: number }> {
  let total = 0;

  for (;;) {
    const page = await model.findMany({
      where: { tenantId: null },
      select: { id: true },
      take: pageSize,
    });

    if (page.length === 0) {
      break;
    }

    const { count } = await model.updateMany({
      where: { id: { in: page.map((row) => row.id) } },
      data: { tenantId: DEFAULT_TENANT_ID },
    });

    total += count;
    logger.info(
      `[MULTI_TENANCY] ${label}: stamped ${count} row(s) (${total} so far)`
    );

    if (count === 0) {
      // Nothing moved despite rows matching — stop rather than loop forever.
      logger.warn(
        `[MULTI_TENANCY] ${label}: a page of ${page.length} row(s) stamped none; stopping backfill`
      );
      break;
    }
  }

  return { count: total };
}

export async function seedDefaultTenant(): Promise<void> {
  if (!MULTI_TENANCY_ENABLED) {
    return;
  }

  // Upsert DEFAULT tenant — id stays stable so the backfill below always
  // targets the same row, even if a slug/name change lands later. Shared with
  // the create paths that write rows pointing at it, so both agree on its shape.
  await ensureDefaultTenant(DEFAULT_TENANT_ID);

  // Backfill each scoped model. `updateMany` with `where: { tenantId: null }`
  // is idempotent — subsequent boots see zero rows to update.
  const backfill = (model: { updateMany: (args: { where: { tenantId: null }; data: { tenantId: string } }) => Promise<{ count: number }> }) =>
    model.updateMany({ where: { tenantId: null }, data: { tenantId: DEFAULT_TENANT_ID } });

  // SensorScan is backfilled separately, in pages — see backfillPaged().
  const sensorScans = await backfillPaged(prisma.sensorScan, 'sensorScans');

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
    // Wave 3e
    backfill(prisma.apiToken),
    // Wave 3f (TASK-179)
    backfill(prisma.episodeReward),
    backfill(prisma.interventionEpisode),
    // TASK-285
    backfill(prisma.digitalTwin),
    backfill(prisma.scanSession),
    backfill(prisma.simScene),
    // TASK-286 — SensorScan is handled above, in pages
    backfill(prisma.motionClip),
    backfill(prisma.vlaSession),
  ]);

  results.push(sensorScans);

  const labels = [
    'users', 'robots', 'datasets', 'trainingJobs',
    'alerts', 'incidents', 'robotTasks', 'robotCommands',
    'processDefinitions', 'processInstances', 'approvalRequests', 'events',
    'modelVersions', 'deployments', 'simulationJobs', 'syntheticJobs',
    'zones', 'conversations',
    'apiTokens',
    'episodeRewards', 'interventionEpisodes',
    'digitalTwins', 'scanSessions', 'simScenes',
    'motionClips', 'vlaSessions',
    // Last, matching the `results.push(sensorScans)` above.
    'sensorScans',
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
