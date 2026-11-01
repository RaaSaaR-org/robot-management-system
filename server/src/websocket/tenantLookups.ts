/**
 * @file tenantLookups.ts
 * @description Reads the tenant behind a `TenantKey` (TASK-368) — the column
 *              `eventTenancy.ts` routes a WebSocket event by.
 * @feature websocket
 *
 * Read as the platform: an event is not raised inside any request, and the
 * answer is used for routing only. A row that does not exist (other than a
 * robot's, which keeps TASK-366's rule) answers
 * `UNRESOLVED_ROBOT_TENANT` — "no tenant" (`null`) would show the event to
 * every tenant — so only a super-admin sees it.
 */

import { prisma } from '../database/index.js';
import { runAsPlatform } from '../middleware/tenantContext.js';
import { UNRESOLVED_ROBOT_TENANT } from './eventFanout.js';
import { parseTenantKey, type TenantEntity, type TenantKey } from './eventTenancy.js';

type Row = { tenantId: string | null } | null;
const tenant = { select: { tenantId: true } } as const;

const robotTenant = async (id: string): Promise<Row> => prisma.robot.findUnique({ where: { id }, ...tenant });

const readers: Record<TenantEntity, (id: string) => Promise<Row>> = {
  robot: robotTenant,
  conversation: (id) => prisma.conversation.findUnique({ where: { id }, ...tenant }),
  a2aTask: async (id) => {
    const task = await prisma.task.findUnique({ where: { id }, select: { conversation: tenant } });
    return task?.conversation ?? null;
  },
  alert: (id) => prisma.alert.findUnique({ where: { id }, ...tenant }),
  processInstance: (id) => prisma.processInstance.findUnique({ where: { id }, ...tenant }),
  robotTask: (id) => prisma.robotTask.findUnique({ where: { id }, ...tenant }),
  incident: (id) => prisma.incident.findUnique({ where: { id }, ...tenant }),
  trainingJob: (id) => prisma.trainingJob.findUnique({ where: { id }, ...tenant }),
  dataset: (id) => prisma.dataset.findUnique({ where: { id }, ...tenant }),
  digitalTwin: (id) => prisma.digitalTwin.findUnique({ where: { id }, ...tenant }),
  teleopSession: async (id) => {
    const session = await prisma.teleoperationSession.findUnique({ where: { id }, select: { robotId: true } });
    return session ? robotTenant(session.robotId) : null;
  },
  deployment: (id) => prisma.deployment.findUnique({ where: { id }, ...tenant }),
};

/** The tenant of the entity a key names; `UNRESOLVED_ROBOT_TENANT` when it is gone. */
export async function lookupTenant(key: TenantKey): Promise<string | null> {
  const { entity, id } = parseTenantKey(key);
  const read = readers[entity];
  if (!read) return UNRESOLVED_ROBOT_TENANT;
  const row = await runAsPlatform(() => read(id));
  if (row) return row.tenantId;
  // A robot not (or no longer) in the database keeps TASK-366's rule: no tenant.
  return entity === 'robot' ? null : UNRESOLVED_ROBOT_TENANT;
}

/**
 * The robot a teleoperation session records (TASK-414): presence and the
 * operator relay are routed by it. Null when the session does not exist.
 */
export async function lookupTeleopSessionRobot(sessionId: string): Promise<string | null> {
  const session = await runAsPlatform(() =>
    prisma.teleoperationSession.findUnique({ where: { id: sessionId }, select: { robotId: true } })
  );
  return session?.robotId ?? null;
}
