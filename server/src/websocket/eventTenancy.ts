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
