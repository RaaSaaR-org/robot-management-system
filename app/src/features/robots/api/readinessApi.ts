/**
 * @file readinessApi.ts
 * @description A robot's readiness and its robot side (TASK-411, server routes
 *              from TASK-409): the merged supervisor + agent snapshot, Start /
 *              Stop of the robot-side processes, the sidecar write mode,
 *              adopt / leave of a foreign process, bringing the robot LAN up
 *              and the per-process logs, and the Meta Quest on the robot PC's
 *              USB (TASK-412). Refusals come back as values with the
 *              server's or supervisor's machine `code`, never as throws, so the
 *              panel can say exactly why.
 * @feature robots
 * @dependencies @/api/client
 */

import { apiClient, tokenStorage } from '@/api/client';

// ============================================================================
// TYPES — mirror server/src/services/robot-supervisor (the server owns them)
// ============================================================================

export type BringupStepId = 'preflight' | 'link' | 'camera' | 'bridge' | 'sidecar' | 'agent';
export type BringupStepState = 'idle' | 'running' | 'ok' | 'warn' | 'failed' | 'foreign';
export type BringupOverall = 'stopped' | 'starting' | 'ready' | 'degraded' | 'stopping' | 'error';
export type SidecarMode = 'read_only' | 'arm_sdk';
export type BringupProc = 'sim' | 'bridge' | 'sidecar' | 'agent';
export type ReadinessSeverity = 'block' | 'warn' | 'ok';

export interface BringupStep {
  id: BringupStepId;
  state: BringupStepState;
  owned: boolean;
  pid: number | null;
  startedAt: string | null;
  detail: string | null;
  checks: Record<string, boolean | number | string | null | StaleCode>;
  code?: string | null;
  foreign?: {
    pid: number | null;
    cmdline: string[] | null;
    since: string | null;
    port: number;
    /** TASK-419: its working directory and the robot id it names, when readable. */
    cwd?: string | null;
    robotId?: string | null;
    /** TASK-419: it started before the code it runs; it cannot be adopted. */
    staleCode?: StaleCode | null;
  } | null;
  actions?: Array<'adopt' | 'leave'>;
}

/** A robot-side process that started before the code it should run (TASK-419). */
export interface StaleCode {
  startedAt: string;
  codeAt: string;
}

export function isStaleCode(v: unknown): v is StaleCode {
  return typeof v === 'object' && v !== null
    && typeof (v as StaleCode).startedAt === 'string'
    && typeof (v as StaleCode).codeAt === 'string';
}

/** The stale-code verdict of a step, owned (`checks`) or foreign. */
export function staleCodeOf(step: BringupStep | null | undefined): StaleCode | null {
  if (!step) return null;
  const foreign = step.foreign?.staleCode;
  if (isStaleCode(foreign)) return foreign;
  const owned = step.checks?.staleCode;
  return isStaleCode(owned) ? owned : null;
}

export interface BringupStatus {
  robotId: string;
  profile: string;
  robot: 'real' | 'sim';
  sidecarMode: SidecarMode | null;
  overall: BringupOverall;
  steps: BringupStep[];
  lastBase: { mode: string | null; fsmId: number | null } | null;
  agentPort?: number;
  at: string;
}

export interface HandMotorFault {
  motor: number;
  joint: string;
  /** Hex error code, e.g. `0x200`. */
  code: string;
  bits: string[];
}

export interface HandHealth {
  present: boolean | null;
  ageS: number | null;
  error: [number, number] | null;
  motorFaults: HandMotorFault[];
  powerV: number | null;
}

/** The agent's `GET /api/v1/robots/:id/readiness` (TASK-405). */
export interface AgentReadiness {
  robotId: string;
  at: string;
  simulated: boolean;
  sidecar: {
    reachable: boolean;
    connected: boolean;
    url?: string;
    lowstateAgeS: number | null;
    writeMode: SidecarMode | null;
    readOnly: boolean;
    bootId?: string | null;
    sim: boolean;
    stale?: boolean;
    lastHealthAt?: string | null;
  };
  base: {
    gate: string;
    mode: string;
    fsmId: number | null;
    ageS: number | null;
    error: string | null;
    stale?: boolean;
  } | null;
  arms: {
    armState: string | null;
    armed: boolean;
    arming?: boolean;
    armWeight: number;
    deadman: 'ok' | 'hold' | null;
    lastDisarmReason: string | null;
    trackErrRad: number | null;
    trackErrJoint: string | null;
    estopLatched: boolean;
    sidecarEstopLatched?: boolean;
    claims?: number;
    lastError?: string | null;
  };
  hands: { left: HandHealth; right: HandHealth } | null;
  lease: {
    enforced: boolean;
    state: string;
    holder: { userId: string | null; displayName: string | null } | null;
    bound: number;
  };
  camera: { source: string | null; cameras: string[]; detail: string | null };
  telemetrySynthetic: boolean;
  reason: { code: string; severity: ReadinessSeverity; text: string };
}

/** The Meta Quest on the robot PC's USB — the supervisor's `GET /quest` (TASK-412). */
export type QuestDeviceState = 'device' | 'unauthorized' | 'offline';

export interface QuestDevice {
  serial: string;
  state: QuestDeviceState;
  model: string | null;
}

export interface QuestReport {
  /** The adb binary on the robot PC; null when none was found. */
  adb: string | null;
  devices: QuestDevice[];
  reversed: Array<{ remote: string; local: string }>;
  /** What to do next; null when the headset is connected and the port forwarded. */
  hint: string | null;
}

export interface ReadinessReason {
  code: string;
  severity: ReadinessSeverity;
  text: string;
  source: 'server' | 'agent';
}

/** `GET /api/robots/:id/readiness` and the `robot:readiness` socket event. */
export interface RobotReadiness {
  robotId: string;
  at: string;
  /** `outdated`: it answers /health but has no readiness route — older code (TASK-419). */
  agent: { reachable: boolean; error: string | null; readiness: AgentReadiness | null; outdated?: boolean };
  /** Null when the robot has no supervisor, or it did not answer. */
  bringup: BringupStatus | null;
  /** Null when the robot has no supervisor configured. */
  supervisor: { reachable: boolean; error: string | null } | null;
  /** The Quest on the robot PC's USB; null without a supervisor (absent from older servers). */
  quest?: QuestReport | null;
  reason: ReadinessReason;
}

export type BringupResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; code: string; error: string };

export interface StopReply {
  status?: BringupStatus;
  baseMode: { mode: string | null; fsmId: number | null; source: 'agent' | 'supervisor' } | null;
}

// ============================================================================
// CALLS
// ============================================================================

const robotPath = (robotId: string) => `/robots/${encodeURIComponent(robotId)}`;

/** Every status whose body carries a reason. */
const acceptAll = (status: number): boolean => status >= 200 && status < 600;

/** GET the merged snapshot. Also (re)opens the server's 30 s watch window. */
export async function getReadiness(robotId: string): Promise<RobotReadiness> {
  const response = await apiClient.get<RobotReadiness>(`${robotPath(robotId)}/readiness`);
  return response.data;
}

async function post(robotId: string, sub: string, body: Record<string, unknown>, timeout = 20_000): Promise<BringupResult> {
  return postTo(`${robotPath(robotId)}/bringup/${sub}`, body, timeout);
}

async function postTo(url: string, body: Record<string, unknown>, timeout: number): Promise<BringupResult> {
  try {
    const response = await apiClient.post<Record<string, unknown>>(url, body, {
      validateStatus: acceptAll,
      timeout,
    });
    const data = response.data ?? {};
    if (response.status >= 200 && response.status < 300 && data.ok !== false) {
      return { ok: true, status: response.status, body: data };
    }
    return {
      ok: false,
      status: response.status,
      code: typeof data.code === 'string' ? data.code : `http_${response.status}`,
      error: typeof data.error === 'string' ? data.error : `the server refused (HTTP ${response.status})`,
    };
  } catch (err) {
    return { ok: false, status: 0, code: 'network', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Start the robot side. The panel only ever starts `read_only` (D2). */
export function startBringup(robotId: string, mode: SidecarMode = 'read_only'): Promise<BringupResult> {
  return post(robotId, 'start', { mode });
}

/** Stop the robot side. Never touches the FSM; answers the last known base mode. */
export function stopBringup(robotId: string): Promise<BringupResult> {
  return post(robotId, 'stop', {});
}

/** Switch the sidecar's write mode. `arm_sdk` needs the bound lease. */
export function setSidecarMode(
  robotId: string,
  mode: SidecarMode,
  grant: { leaseId: string; generation: number } | null,
): Promise<BringupResult> {
  return post(robotId, 'sidecar-mode', {
    mode,
    confirm: true,
    ...(grant ? { leaseId: grant.leaseId, generation: grant.generation } : {}),
  });
}

export function adoptStep(robotId: string, step: BringupStepId): Promise<BringupResult> {
  return post(robotId, `steps/${step}/adopt`, {});
}

export function leaveStep(robotId: string, step: BringupStepId): Promise<BringupResult> {
  return post(robotId, `steps/${step}/leave`, {});
}

/** `nmcli con up` on the supervisor may take up to 30 s. */
export function lanUp(robotId: string): Promise<BringupResult> {
  return post(robotId, 'lan-up', {}, 40_000);
}

// ---------------------------------------------------------------- the Quest

/** The page port the headset reaches through `adb reverse`; the dev server's 1420 by default. */
export function questPagePort(location: { port?: string } = typeof window !== 'undefined' ? window.location : {}): number {
  const p = Number(location.port);
  return Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : 1420;
}

/** The headset's stable entry: always lands on the robot's live session (D2). */
export function questLivePath(robotId: string): string | null {
  return /^[A-Za-z0-9_-]+$/.test(robotId) ? `/data-collection/live?robot=${robotId}` : null;
}

/** `adb reverse tcp:<port> tcp:<port>` on the robot PC. */
export function questConnect(robotId: string, port: number = questPagePort()): Promise<BringupResult> {
  return postTo(`${robotPath(robotId)}/quest/connect`, { port }, 25_000);
}

/** Open an allowlisted path in the Quest browser. */
export function questOpen(robotId: string, path: string, port: number = questPagePort()): Promise<BringupResult> {
  return postTo(`${robotPath(robotId)}/quest/open`, { path, port }, 25_000);
}

/** The last `tail` lines of one robot-side process. */
export async function getBringupLogs(robotId: string, proc: BringupProc, tail = 200): Promise<string[]> {
  const response = await apiClient.get<{ proc?: string; lines?: unknown }>(`${robotPath(robotId)}/bringup/logs/${proc}`, {
    params: { tail },
  });
  const lines = response.data?.lines;
  return Array.isArray(lines) ? lines.map(String) : [];
}

/** Absolute URL of a process's SSE log stream (resolved like the api client). */
export function bringupLogStreamUrl(robotId: string, proc: BringupProc): string {
  const base = apiClient.defaults.baseURL ?? '/api';
  const path = `${base.replace(/\/$/, '')}${robotPath(robotId)}/bringup/logs/${proc}/stream`;
  // A relative base (`/api`) resolves against the page, as axios does.
  return typeof window !== 'undefined' ? new URL(path, window.location.href).toString() : path;
}

/**
 * Follow a process's log over SSE. `fetch`, not `EventSource`: the route needs
 * the bearer token, and an EventSource cannot send a header. Each `data:` line
 * is a JSON string (the supervisor's framing). Returns the stop function.
 */
export function streamBringupLogs(
  robotId: string,
  proc: BringupProc,
  onLine: (line: string) => void,
  onError?: (error: string) => void,
): () => void {
  const abort = new AbortController();
  const token = tokenStorage.getAccessToken();
  void (async () => {
    try {
      const response = await fetch(bringupLogStreamUrl(robotId, proc), {
        headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        onError?.(`log stream answered HTTP ${response.status}`);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf('\n\n');
        while (cut >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          for (const raw of frame.split('\n')) {
            if (!raw.startsWith('data:')) continue;
            const data = raw.slice(5).trimStart();
            try {
              const parsed: unknown = JSON.parse(data);
              onLine(typeof parsed === 'string' ? parsed : data);
            } catch {
              onLine(data);
            }
          }
          cut = buffer.indexOf('\n\n');
        }
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      onError?.(err instanceof Error ? err.message : String(err));
    }
  })();
  return () => abort.abort();
}

export const readinessApi = {
  getReadiness,
  startBringup,
  stopBringup,
  setSidecarMode,
  adoptStep,
  leaveStep,
  lanUp,
  getBringupLogs,
  streamBringupLogs,
  questConnect,
  questOpen,
};
export type ReadinessApi = typeof readinessApi;
