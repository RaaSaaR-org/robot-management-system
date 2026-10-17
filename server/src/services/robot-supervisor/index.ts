/**
 * @file index.ts
 * @description Production wiring of the robot readiness service (TASK-409):
 *              supervisors from `ROBOT_SUPERVISORS`, agent URLs from the robot
 *              registry, agent `/readiness` over HTTP, registration through
 *              `RobotManager.registerRobot` in the caller's tenant, and the
 *              teleop session events that keep a robot watched.
 * @feature robots
 */

import { HttpClient, HttpClientError } from '../HttpClient.js';
import { agentServiceAuthHeaders } from '../agentServiceAuth.js';
import { robotManager } from '../RobotManager.js';
import { teleoperationService } from '../TeleoperationService.js';
import { runAsPlatform, tenantStore } from '../../middleware/tenantContext.js';
import { MULTI_TENANCY_ENABLED } from '../../config/features.js';
import type { TeleoperationEvent } from '../../types/teleoperation.types.js';
import { supervisorsFromEnv, SupervisorUnreachableError, type SupervisorClient } from './SupervisorClient.js';
import { RobotReadinessService, type AgentRead, type AgentReadiness, type SupervisorRead } from './RobotReadinessService.js';

export * from './SupervisorClient.js';
export * from './RobotReadinessService.js';

/**
 * The agent's readiness route reads `/health` (≤ 0.8 s) and, every 10 s, the
 * camera list (≤ 2.5 s): give it more than the supervisor's 2 s.
 */
export const AGENT_READINESS_TIMEOUT_MS = 4_000;

export async function readAgentReadiness(baseUrl: string, robotId: string): Promise<AgentRead> {
  const client = new HttpClient(baseUrl.replace(/\/$/, ''), AGENT_READINESS_TIMEOUT_MS, agentServiceAuthHeaders());
  try {
    const body = await client.get<AgentReadiness>(`/api/v1/robots/${encodeURIComponent(robotId)}/readiness`);
    if (!body || typeof body !== 'object' || typeof (body as AgentReadiness).reason !== 'object') {
      return { kind: 'bad_status', status: 200 };
    }
    return { kind: 'ok', readiness: body };
  } catch (error) {
    if (error instanceof HttpClientError && error.statusCode !== undefined) {
      return { kind: 'bad_status', status: error.statusCode };
    }
    return { kind: 'unreachable', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readSupervisorStatus(client: SupervisorClient | undefined): Promise<SupervisorRead> {
  if (!client) return { kind: 'error', error: 'no supervisor configured' };
  try {
    const answer = await client.status();
    if (answer.status !== 200) {
      const raw = (answer.body as unknown as { code?: unknown }).code;
      const code = typeof raw === 'string' ? raw : `HTTP ${answer.status}`;
      return { kind: 'error', error: `supervisor answered ${answer.status} (${code})` };
    }
    return { kind: 'ok', status: answer.body };
  } catch (error) {
    const text = error instanceof SupervisorUnreachableError ? error.message : String(error);
    return { kind: 'error', error: `supervisor not answering: ${text}` };
  }
}

let supervisors: Map<string, SupervisorClient> | undefined;

/** The configured supervisors, read from env once. */
export function getSupervisors(): Map<string, SupervisorClient> {
  return (supervisors ??= supervisorsFromEnv());
}

/** Teleop sessions in `recording` or `paused` keep their robot watched. */
export function trackTeleopSessions(service: RobotReadinessService): () => void {
  const robotOf = new Map<string, string>();
  const listener = (event: TeleoperationEvent) => {
    const session = event.session;
    if (session) robotOf.set(event.sessionId, session.robotId);
    const robotId = session?.robotId ?? robotOf.get(event.sessionId);
    if (!robotId) return;
    const status = session?.status;
    if (status === 'recording' || status === 'paused') {
      service.setSession(robotId, event.sessionId, true);
    } else if (status !== undefined || event.type === 'session:completed' || event.type === 'session:failed') {
      service.setSession(robotId, event.sessionId, false);
      robotOf.delete(event.sessionId);
    }
  };
  teleoperationService.on('teleoperation:event', listener);
  return () => teleoperationService.off('teleoperation:event', listener);
}

export function createDefaultReadinessService(): RobotReadinessService {
  const service = new RobotReadinessService({
    supervisedRobots: () => [...getSupervisors().keys()],
    readSupervisor: (robotId) => readSupervisorStatus(getSupervisors().get(robotId)),
    // The service runs outside any request: it reads the registry as the
    // platform. Who may see a robot is decided by the routes, not here.
    registeredAgentUrl: async (robotId) => {
      const r = await runAsPlatform(() => robotManager.getRegisteredRobot(robotId));
      return r?.baseUrl ?? null;
    },
    supervisorAgentUrl: (robotId, status) => getSupervisors().get(robotId)?.agentUrlFor(status) ?? null,
    readAgent: readAgentReadiness,
    register: async (agentUrl, tenantId) => {
      const run = () => robotManager.registerRobot(agentUrl);
      if (MULTI_TENANCY_ENABLED && tenantId) await tenantStore.run({ tenantId }, run);
      else await run();
    },
  });
  trackTeleopSessions(service);
  return service;
}

let defaultService: RobotReadinessService | undefined;

/** The one readiness service per process, shared by the routes, base-mode and the socket. */
export function getRobotReadinessService(): RobotReadinessService {
  return (defaultService ??= createDefaultReadinessService());
}
