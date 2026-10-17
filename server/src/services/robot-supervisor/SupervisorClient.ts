/**
 * @file SupervisorClient.ts
 * @description Typed client for the robot supervisor's HTTP API (TASK-403):
 *              status, start/stop of the robot side, the sidecar write mode,
 *              adopt/leave of a foreign process, bringing the robot LAN up and
 *              the per-process logs (tail + SSE stream). Bearer
 *              `ROBOT_SUPERVISOR_TOKEN`, 2 s timeout per call.
 *
 *              Which supervisor serves which robot comes from the server's own
 *              env (`ROBOT_SUPERVISORS`), never from the agent — the agent may
 *              be the thing that is down (TASK-409 D4).
 * @feature robots
 */

/** Mirrors `robot-agent/supervisor/src/steps.ts` — the supervisor owns the shape. */
export type SupervisorStepId = 'preflight' | 'link' | 'camera' | 'bridge' | 'sidecar' | 'agent';
export type SupervisorStepState = 'idle' | 'running' | 'ok' | 'warn' | 'failed' | 'foreign';
export type SupervisorOverall = 'stopped' | 'starting' | 'ready' | 'degraded' | 'stopping' | 'error';
export type SupervisorSidecarMode = 'read_only' | 'arm_sdk';
export type SupervisorProc = 'sim' | 'bridge' | 'sidecar' | 'agent';

export const SUPERVISOR_STEP_IDS: readonly SupervisorStepId[] = [
  'preflight',
  'link',
  'camera',
  'bridge',
  'sidecar',
  'agent',
];
export const SUPERVISOR_PROCS: readonly SupervisorProc[] = ['sim', 'bridge', 'sidecar', 'agent'];
export const SIDECAR_MODES: readonly SupervisorSidecarMode[] = ['read_only', 'arm_sdk'];

export interface SupervisorStepStatus {
  id: SupervisorStepId;
  state: SupervisorStepState;
  owned: boolean;
  pid: number | null;
  startedAt: string | null;
  detail: string | null;
  checks: Record<string, boolean | number | string | null>;
  code?: string | null;
  foreign?: { pid: number | null; cmdline: string[] | null; since: string | null; port: number } | null;
  actions?: Array<'adopt' | 'leave'>;
}

export interface SupervisorStatus {
  robotId: string;
  profile: string;
  robot: 'real' | 'sim';
  sidecarMode: SupervisorSidecarMode | null;
  overall: SupervisorOverall;
  steps: SupervisorStepStatus[];
  lastBase: { mode: string | null; fsmId: number | null } | null;
  /** The profile's agent port; absent on a supervisor older than TASK-409. */
  agentPort?: number;
  at: string;
}

/** Any HTTP answer the supervisor gave, 4xx/5xx included. */
export interface SupervisorAnswer<T = Record<string, unknown>> {
  status: number;
  body: T;
}

/** There was no answer at all: refused, timed out, DNS. */
export class SupervisorUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupervisorUnreachableError';
  }
}

export const SUPERVISOR_TIMEOUT_MS = 2_000;
/** `nmcli con up` on the supervisor may take up to 30 s. */
const LAN_UP_TIMEOUT_MS = 35_000;

export interface SupervisorClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class SupervisorClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, private readonly token: string, options: SupervisorClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? SUPERVISOR_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** The agent URL on the supervisor's host, from the port its profile names. */
  agentUrlFor(status: Pick<SupervisorStatus, 'agentPort'> | null): string | null {
    if (!status || typeof status.agentPort !== 'number') return null;
    const u = new URL(this.baseUrl);
    return `${u.protocol}//${u.hostname}:${status.agentPort}`;
  }

  status(): Promise<SupervisorAnswer<SupervisorStatus>> {
    return this.call('GET', '/status') as unknown as Promise<SupervisorAnswer<SupervisorStatus>>;
  }

  start(mode: SupervisorSidecarMode): Promise<SupervisorAnswer> {
    return this.call('POST', '/start', { mode });
  }

  stop(): Promise<SupervisorAnswer> {
    return this.call('POST', '/stop', {});
  }

  sidecarMode(mode: SupervisorSidecarMode, confirm: boolean): Promise<SupervisorAnswer> {
    return this.call('POST', '/sidecar/mode', { mode, confirm });
  }

  step(id: SupervisorStepId, action: 'adopt' | 'leave'): Promise<SupervisorAnswer> {
    return this.call('POST', `/steps/${id}/${action}`, {});
  }

  lanUp(): Promise<SupervisorAnswer> {
    return this.call('POST', '/lan/up', {}, LAN_UP_TIMEOUT_MS);
  }

  logs(proc: SupervisorProc, tail: number): Promise<SupervisorAnswer> {
    return this.call('GET', `/logs/${proc}?tail=${encodeURIComponent(String(tail))}`);
  }

  /**
   * The raw SSE response of `/logs/:proc/stream`. No timeout on the body — the
   * caller aborts `signal` when its own client goes away. Only connecting is
   * bounded by the client timeout.
   */
  async streamLogs(proc: SupervisorProc, signal: AbortSignal): Promise<Response> {
    const connect = new AbortController();
    const timer = setTimeout(() => connect.abort(), this.timeoutMs);
    const onAbort = () => connect.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.fetchImpl(`${this.baseUrl}/logs/${proc}/stream`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' },
        signal: connect.signal,
      });
    } catch (error) {
      throw new SupervisorUnreachableError(errorText(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    timeoutMs = this.timeoutMs,
  ): Promise<SupervisorAnswer> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new SupervisorUnreachableError(errorText(error));
    }
    let parsed: unknown = {};
    try {
      const text = await res.text();
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    return {
      status: res.status,
      body: typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {},
    };
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timed out';
    return cause?.code ? `${error.message} (${cause.code})` : error.message;
  }
  return String(error);
}

/**
 * `ROBOT_SUPERVISORS=g1-edu-4=http://127.0.0.1:8766,sim=http://127.0.0.1:18766`
 * → robotId → URL. Malformed entries are skipped with a warning; an empty or
 * unset value means no robot has a supervisor.
 */
export function parseSupervisorUrls(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const robotId = eq > 0 ? trimmed.slice(0, eq).trim() : '';
    const url = eq > 0 ? trimmed.slice(eq + 1).trim() : '';
    let ok = false;
    try {
      ok = robotId.length > 0 && /^https?:$/.test(new URL(url).protocol);
    } catch {
      ok = false;
    }
    if (!ok) {
      console.warn(`[robot-supervisor] ignoring ROBOT_SUPERVISORS entry ${JSON.stringify(trimmed)} (want <robotId>=<http url>)`);
      continue;
    }
    out.set(robotId, url);
  }
  return out;
}

/** One client per configured robot, from `ROBOT_SUPERVISORS` + `ROBOT_SUPERVISOR_TOKEN`. */
export function supervisorsFromEnv(env: NodeJS.ProcessEnv = process.env): Map<string, SupervisorClient> {
  const urls = parseSupervisorUrls(env.ROBOT_SUPERVISORS);
  const token = env.ROBOT_SUPERVISOR_TOKEN ?? '';
  const clients = new Map<string, SupervisorClient>();
  if (urls.size > 0 && !token) {
    console.warn('[robot-supervisor] ROBOT_SUPERVISORS is set but ROBOT_SUPERVISOR_TOKEN is not — every call will be refused');
  }
  for (const [robotId, url] of urls) clients.set(robotId, new SupervisorClient(url, token));
  return clients;
}
