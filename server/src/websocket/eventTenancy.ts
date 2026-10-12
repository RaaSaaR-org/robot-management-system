/**
 * @file eventTenancy.ts
 * @description Which tenant each broadcast event on `/api/a2a/ws` belongs to
 *              (TASK-368). Pure: every event family names the entity whose
 *              `tenantId` routes it; `tenantLookups.ts` reads that column.
 * @feature websocket
 *
 * TASK-366 routed robot telemetry and status by the robot's tenant. Every other
 * family (alerts, incidents, training jobs, datasets, processes, twins, teleop,
 * A2A conversations, E-stops) still reached every signed-in socket. Each one
 * is now routed by the tenant of the entity it is about:
 *
 * | family                   | routed by                                          |
 * | ------------------------ | -------------------------------------------------- |
 * | `task_event` (A2A)       | Conversation (contextId), else the A2A Task's one   |
 * | `alert_*`                | the robot for robot alerts, else the Alert row      |
 * | `process:*` / `step:*`   | ProcessInstance                                    |
 * | `task:*` (robot tasks)   | RobotTask                                          |
 * | `incident:*`             | Incident (incident.id or notification.incidentId)  |
 * | `training:job:*`         | TrainingJob                                        |
 * | `dataset:*`              | Dataset                                            |
 * | `session:*`, `twin:*`    | DigitalTwin                                        |
 * | `twinZone:*`             | DigitalTwin (the zone's twin)                      |
 * | `teleop:*`               | the session's robot                                |
 * | `deployment:*`           | Deployment                                         |
 * | `agent:*`, robot events  | Robot (TASK-366)                                   |
 * | `safety:estop`           | each affected robot — sliced per socket            |
 *
 * A delete event cannot be routed by its row: the row is gone when the event
 * is routed, and the lookup cache is empty after a restart. So the service
 * that deletes it reads the row's tenant first and carries it on the event
 * (`deletedRowTenantId`, TASK-375), and routing prefers that to any lookup.
 * `null` there is a row with no tenant — what a lookup of the row would have
 * answered. A robot alert is the exception: it is routed by its robot, which
 * outlives the row, and never by a carried tenant — its row is tenant-less when
 * the alert was raised outside a request, and that `null` would reach everyone:
 *
 * | event                | carries the tenant of                             |
 * | -------------------- | ------------------------------------------------- |
 * | `alert_deleted`      | a non-robot Alert row (AlertService.deleteAlert)  |
 * | `dataset:deleted`    | the Dataset row (DatasetService.delete)           |
 * | `robot_unregistered` | the Robot row (RobotManager.unregisterRobot)      |
 *
 * Every other delete emits no event (incidents, processes, robot tasks,
 * twins, deployments, conversations, teleop sessions, bulk alert clears) or is
 * routed by a parent that outlives it (`twinZone:deleted` by its twin,
 * `scan:deleted` by its robot). The field is only ever set by the server from
 * the database, never from a request, so it cannot name a tenant the row was
 * not in.
 *
 * No family on this socket is platform-wide: an event whose entity cannot be
 * named or found goes to super-admins only, never to everyone. Approvals and
 * other features without a WebSocket event are not on this socket at all.
 */

import type { AlertEvent } from '../services/AlertService.js';
import type { EStopEvent, EStopEventResult } from '../services/SafetyService.js';
import type { A2ATaskEvent } from '../types/index.js';
import type { DatasetEvent } from '../types/dataset.types.js';
import type { DeploymentEvent } from '../types/deployment.types.js';
import type { IncidentEvent } from '../types/incident.types.js';
import type { ProcessEvent } from '../types/process.types.js';
import type { TaskEvent } from '../types/robotTask.types.js';
import type { TeleoperationEvent } from '../types/teleoperation.types.js';
import type { TrainingJobEvent } from '../types/training.types.js';
import type { DigitalTwinEvent, TwinZoneEvent } from '../types/twin.types.js';
import { mayObserveTenant, type SocketIdentity } from './socketIdentity.js';

/** The entities whose tenant routes an event. */
export type TenantEntity =
  | 'robot'
  | 'conversation'
  | 'a2aTask'
  | 'alert'
  | 'processInstance'
  | 'robotTask'
  | 'incident'
  | 'trainingJob'
  | 'dataset'
  | 'digitalTwin'
  | 'teleopSession'
  | 'deployment';

/** `<entity>:<id>` — the cache key of one tenant answer. */
export type TenantKey = string;

export function tenantKey(entity: TenantEntity, id: string): TenantKey {
  return `${entity}:${id}`;
}

export function parseTenantKey(key: TenantKey): { entity: TenantEntity; id: string } {
  const at = key.indexOf(':');
  return { entity: key.slice(0, at) as TenantEntity, id: key.slice(at + 1) };
}

/** A key, or `null` when the event names nothing its tenant could be read from. */
const keyOf = (entity: TenantEntity, id: string | null | undefined): TenantKey | null =>
  id ? tenantKey(entity, id) : null;

/** The tenant key of each event family (see the table above). */
export const eventTenantKey = {
  a2aTask: (event: A2ATaskEvent): TenantKey | null =>
    keyOf('conversation', event.contextId) ?? keyOf('a2aTask', event.taskId),

  /** A robot alert by its robot: the Alert row is deleted on dismiss, the robot is not. */
  alert: (event: AlertEvent): TenantKey | null =>
    (event.alert?.source === 'robot' ? keyOf('robot', event.alert.sourceId) : null) ??
    keyOf('alert', event.alert?.id),

  process: (event: ProcessEvent): TenantKey | null =>
    keyOf(
      'processInstance',
      'processInstance' in event
        ? event.processInstance?.id
        : event.processInstanceId ?? event.stepInstance?.processInstanceId
    ),

  robotTask: (event: TaskEvent): TenantKey | null =>
    keyOf('robotTask', 'task' in event ? event.task?.id : event.taskId),

  incident: (event: IncidentEvent): TenantKey | null =>
    keyOf('incident', event.incident?.id ?? event.notification?.incidentId),

  trainingJob: (event: TrainingJobEvent): TenantKey | null => keyOf('trainingJob', event.jobId),

  dataset: (event: DatasetEvent): TenantKey | null => keyOf('dataset', event.datasetId),

  twin: (event: DigitalTwinEvent | TwinZoneEvent): TenantKey | null => keyOf('digitalTwin', event.twinId),

  teleop: (event: TeleoperationEvent): TenantKey | null =>
    keyOf('robot', event.session?.robotId) ?? keyOf('teleopSession', event.sessionId),

  deployment: (event: DeploymentEvent): TenantKey | null =>
    keyOf('deployment', event.deploymentId) ?? keyOf('robot', event.robotId),
};

/**
 * The part of an E-stop event one socket may see. A fleet or zone stop can
 * span tenants (a super-admin's fleet stop); each socket gets the robots of
 * the tenants it may observe — the whole event when that is all of them, a
 * copy cut down to its own robots otherwise, and nothing when it is none.
 * `robotTenants` maps every affected robot to its tenant.
 */
export function eStopEventFor(
  event: EStopEvent,
  identity: SocketIdentity,
  robotTenants: ReadonlyMap<string, string | null>,
  unresolved: string
): EStopEvent | null {
  const tenantOf = (robotId: string): string | null => {
    const tenantId = robotTenants.get(robotId);
    return tenantId === undefined ? unresolved : tenantId;
  };
  const visible = event.affectedRobots.filter((robotId) => mayObserveTenant(identity, tenantOf(robotId)));
  if (event.affectedRobots.length === 0) {
    // Nothing to read a tenant from: super-admins only.
    return mayObserveTenant(identity, unresolved) ? event : null;
  }
  if (visible.length === 0) return null;
  if (visible.length === event.affectedRobots.length) return event;
  const keep = new Set(visible);
  return { ...event, affectedRobots: visible, result: sliceResult(event.result, keep) };
}

function sliceResult(result: EStopEventResult, keep: ReadonlySet<string>): EStopEventResult {
  if (!('robotResults' in result)) return result;
  const robotResults = result.robotResults.filter((r) => keep.has(r.robotId));
  return {
    ...result,
    robotResults,
    successCount: robotResults.filter((r) => r.success).length,
    failureCount: robotResults.filter((r) => !r.success).length,
  };
}
