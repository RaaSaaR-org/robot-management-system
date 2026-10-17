/**
 * @file AgentRecordingService.ts
 * @description Talks to a robot agent's `/recording/*` routes (TASK-215): the
 *              agent records the episode into a LeRobot v3.0 tree with video,
 *              and this is how the platform starts, steers and stops it.
 * @feature teleoperation
 */

import { HttpClient, HttpClientError, HTTP_TIMEOUTS } from './HttpClient.js';
import { agentServiceAuthHeaders } from './agentServiceAuth.js';

/**
 * How long to wait for `/recording/stop`. The encode happens inside it.
 * Five minutes covers a long session on a slow box; past that something is
 * wrong and the caller should hear about it rather than wait forever.
 */
const STOP_TIMEOUT_MS = 300_000;

/** One episode as the agent's recorder saw it. */
export interface AgentEpisodeReport {
  episodeIndex: number;
  frames: number;
  dropped: number;
  durationS: number;
  fpsActual: number;
  /**
   * How this episode's joint targets were produced — 'orientation', 'ik',
   * 'hand-tracking', 'manual', or several (TASK-216).
   *
   * Optional because an older robot agent does not send it, and a session
   * recorded by one must still register: the field says "we do not know", which
   * is different from "orientation" and must not be defaulted to it.
   */
  retargetModes?: string[];
  /** TASK-402: a discarded take stays listed, without frames, so its number stays taken. */
  discarded?: boolean;
  /** TASK-402 quick check. Absent from an agent before TASK-402. */
  jointsMoved?: { name: string; rangeRad: number }[];
  groupsMoved?: string[];
  warnings?: string[];
  /** The take's middle frame, or null. */
  thumbnail?: { camera: string; frame: number } | null;
}

export type AgentEpisodeEndReason = 'operator' | 'time_limit' | 'next' | 'session_end';

/** The agent's last take boundary (TASK-402). */
export interface AgentLastStop {
  episodeIndex: number;
  reason: AgentEpisodeEndReason;
  atMs: number;
}

export interface AgentRecordingStatus {
  recording: boolean;
  sessionId: string | null;
  episodeIndex: number;
  frames: number;
  totalFrames: number;
  dropped: number;
  totalDropped: number;
  fpsTarget: number;
  fpsActual: number;
  degraded: boolean;
  lastDropReason: string | null;
  cameras: { camera: string; key: string }[];
  scene: string | null;
  behindS: number | null;
  episodes: AgentEpisodeReport[];
  // TASK-402 — absent from an older agent.
  phase?: 'between' | 'capturing' | null;
  episodeStartedAtMs?: number | null;
  episodeElapsedS?: number | null;
  elapsedS?: number | null;
  autoStopS?: number | null;
  lastStop?: AgentLastStop | null;
}

export interface AgentRecordingStopResult {
  ok: boolean;
  datasetPath: string | null;
  robotType: string;
  totalEpisodes: number;
  totalFrames: number;
  totalDropped: number;
  fpsActual: number;
  episodes: AgentEpisodeReport[];
  videoFeatures: string[];
  scene: string | null;
  bootId: string | null;
  /** TASK-402: whether the sidecar was the simulator. Absent from an older agent. */
  simulated?: boolean;
  /** TASK-402: every take and the dataset episode it became (null: not kept). */
  indexMap?: { take: number; datasetEpisode: number | null }[];
  error?: string;
}

/** `beginEpisode` / `endEpisode`: the agent's answer, or its reason for refusing. */
export type AgentBeginResult =
  | { ok: true; episodeIndex: number; startedAtMs: number }
  | { ok: false; code: 'already_capturing' | 'not_recording' };

export type AgentEndResult =
  | { ok: true; episodeIndex: number; report: AgentEpisodeReport | null }
  | { ok: false; code: 'not_capturing' | 'not_recording' };

export interface StartAgentRecordingDto {
  sessionId: string;
  fps?: number;
  cameras?: string[];
  task?: string;
  shadows?: boolean;
  inputMode?: string;
  /**
   * Per-take auto-stop in seconds (TASK-406); absent = the operator ends each
   * take. Agents before TASK-402 ignore it.
   */
  episodeTimeS?: number | null;
  /**
   * TASK-408 D3: the session opens between takes and the first take begins on
   * purpose. Agents before TASK-402 ignore it.
   */
  startBetweenTakes?: boolean;
}

/** Minimal robot lookup; `RobotManager` satisfies it. */
export interface AgentRecordingRobotLookup {
  getRegisteredRobot(robotId: string): Promise<{ baseUrl: string } | null | undefined>;
}

export interface AgentRecordingServiceDeps {
  robots?: AgentRecordingRobotLookup;
  /** Factory so tests can fake the transport. */
  httpClient?: (
    baseUrl: string,
    timeoutMs: number,
    headers?: Record<string, string>
  ) => Pick<HttpClient, 'get' | 'post'>;
  /** The thumbnail is bytes, not JSON; tests fake this transport too. */
  fetchImpl?: typeof fetch;
}

/**
 * Raised when the robot ANSWERED and the answer was no.
 *
 * The distinction matters at every call site: a 4xx is a configuration error
 * the operator has to see and fix ("this session is already being recorded"),
 * while no answer at all means the agent is old or down and the caller should
 * fall back to the server-side recorder rather than failing the session.
 */
export class AgentRecordingRefused extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'AgentRecordingRefused';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class AgentRecordingService {
  private readonly robots: AgentRecordingRobotLookup;
  private readonly httpClient: NonNullable<AgentRecordingServiceDeps['httpClient']>;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: AgentRecordingServiceDeps = {}) {
    this.robots =
      deps.robots ??
      ({
        getRegisteredRobot: async (robotId: string) => {
          const { robotManager } = await import('./RobotManager.js');
          return robotManager.getRegisteredRobot(robotId);
        },
      } as AgentRecordingRobotLookup);
    this.httpClient =
      deps.httpClient ??
      ((baseUrl, timeoutMs, headers) => new HttpClient(baseUrl, timeoutMs, headers));
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
  }

  private async client(
    robotId: string,
    timeoutMs: number
  ): Promise<Pick<HttpClient, 'get' | 'post'> | null> {
    const registered = await this.robots.getRegisteredRobot(robotId);
    if (!registered?.baseUrl) return null;
    return this.httpClient(registered.baseUrl, timeoutMs, agentServiceAuthHeaders());
  }

  private path(robotId: string, tail: string): string {
    return `/api/v1/robots/${encodeURIComponent(robotId)}/recording${tail}`;
  }

  /**
   * Turn a transport failure into either a refusal to re-raise or a `null` that
   * says "this agent cannot record; use the other path".
   *
   * A 404 is the interesting case: it is a 4xx, but it means the agent predates
   * these routes. That is not a configuration error the operator can fix — it
   * is an old robot, and an old robot should fall back silently.
   */
  private classify(error: unknown, what: string): null {
    const status = error instanceof HttpClientError ? error.statusCode : undefined;
    if (status !== undefined && status >= 400 && status < 500 && status !== 404) {
      const body = (error as HttpClientError).responseBody;
      const message = isRecord(body) && typeof body.message === 'string' ? body.message : error instanceof Error ? error.message : String(error);
      const code = isRecord(body) && typeof body.code === 'string' ? body.code : null;
      throw new AgentRecordingRefused(message, status, code);
    }
    const why = error instanceof Error ? error.message : String(error);
    console.warn(`[AgentRecording] ${what} unavailable: ${why}`);
    return null;
  }

  /**
   * Start recording on the robot.
   *
   * `null` means this robot cannot record here — no agent URL, an agent that
   * does not know the route, or one that did not answer — and the caller should
   * fall back. A refusal (409) throws, because the operator asked for something
   * the robot understood and declined.
   */
  async start(robotId: string, dto: StartAgentRecordingDto): Promise<AgentRecordingStatus | null> {
    const client = await this.client(robotId, HTTP_TIMEOUTS.MEDIUM);
    if (!client) return null;
    try {
      const answer = await client.post<unknown>(this.path(robotId, '/start'), dto);
      if (!isRecord(answer) || answer.ok !== true) {
        throw new HttpClientError('robot returned no recording status', undefined, 'invalid_response');
      }
      return answer as unknown as AgentRecordingStatus;
    } catch (error) {
      return this.classify(error, `start on ${robotId}`);
    }
  }

  /** The new episode index, or `null` when the agent is not the recorder. */
  async nextEpisode(robotId: string): Promise<number | null> {
    const client = await this.client(robotId, HTTP_TIMEOUTS.SHORT);
    if (!client) return null;
    try {
      const answer = await client.post<unknown>(this.path(robotId, '/next-episode'));
      if (!isRecord(answer) || typeof answer.episodeIndex !== 'number') {
        throw new HttpClientError('robot returned no episode index', undefined, 'invalid_response');
      }
      return answer.episodeIndex;
    } catch (error) {
      return this.classify(error, `next-episode on ${robotId}`);
    }
  }

  /**
   * Open a take (TASK-402 `episodes/begin`).
   *
   * A 409 is an answer, not a failure: the agent says WHY it will not
   * (`already_capturing`, `not_recording`), and the caller turns that into its
   * own conflict. `null` is an agent that does not know the route or did not
   * answer.
   */
  async beginEpisode(robotId: string): Promise<AgentBeginResult | null> {
    const client = await this.client(robotId, HTTP_TIMEOUTS.SHORT);
    if (!client) return null;
    try {
      const answer = await client.post<unknown>(this.path(robotId, '/episodes/begin'));
      if (!isRecord(answer) || answer.ok !== true || typeof answer.episodeIndex !== 'number') {
        throw new HttpClientError('robot returned no take', undefined, 'invalid_response');
      }
      return {
        ok: true,
        episodeIndex: answer.episodeIndex,
        startedAtMs: typeof answer.startedAtMs === 'number' ? answer.startedAtMs : Date.now(),
      };
    } catch (error) {
      const refused = this.refusalCode(error, ['already_capturing', 'not_recording'] as const);
      if (refused) return { ok: false, code: refused };
      return this.classify(error, `episodes/begin on ${robotId}`);
    }
  }

  /** Close the open take (TASK-402 `episodes/end`), with the take's report. */
  async endEpisode(
    robotId: string,
    reason: 'operator' | 'time_limit' = 'operator'
  ): Promise<AgentEndResult | null> {
    const client = await this.client(robotId, HTTP_TIMEOUTS.SHORT);
    if (!client) return null;
    try {
      const answer = await client.post<unknown>(this.path(robotId, '/episodes/end'), { reason });
      if (!isRecord(answer) || answer.ok !== true || typeof answer.episodeIndex !== 'number') {
        throw new HttpClientError('robot returned no take', undefined, 'invalid_response');
      }
      return {
        ok: true,
        episodeIndex: answer.episodeIndex,
        report: isRecord(answer.report) ? (answer.report as unknown as AgentEpisodeReport) : null,
      };
    } catch (error) {
      const refused = this.refusalCode(error, ['not_capturing', 'not_recording'] as const);
      if (refused) return { ok: false, code: refused };
      return this.classify(error, `episodes/end on ${robotId}`);
    }
  }

  /**
   * The JPEG of a take's middle frame, or `null` when the robot has none (404),
   * cannot be asked, or did not answer. Only while the robot's session lives —
   * the agent serves it from its scratch directory.
   */
  async thumbnail(robotId: string, take: number): Promise<Buffer | null> {
    const registered = await this.robots.getRegisteredRobot(robotId);
    if (!registered?.baseUrl) return null;
    const url = `${registered.baseUrl.replace(/\/$/, '')}${this.path(robotId, `/episodes/${take}/thumbnail`)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUTS.SHORT);
    try {
      const resp = await this.fetchImpl(url, {
        headers: agentServiceAuthHeaders(),
        signal: controller.signal,
      });
      if (!resp.ok) return null;
      const type = resp.headers.get('content-type') ?? '';
      if (!type.startsWith('image/jpeg')) return null;
      return Buffer.from(await resp.arrayBuffer());
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      console.warn(`[AgentRecording] thumbnail of take ${take} on ${robotId} unavailable: ${why}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The agent's 409 code when it is one of `codes`, else null. */
  private refusalCode<C extends string>(error: unknown, codes: readonly C[]): C | null {
    if (!(error instanceof HttpClientError) || error.statusCode !== 409) return null;
    const body = error.responseBody;
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : null;
    return code !== null && (codes as readonly string[]).includes(code) ? (code as C) : null;
  }

  async discardEpisode(robotId: string, episodeIndex: number): Promise<boolean> {
    const client = await this.client(robotId, HTTP_TIMEOUTS.SHORT);
    if (!client) return false;
    try {
      await client.post<unknown>(this.path(robotId, `/episodes/${episodeIndex}/discard`));
      return true;
    } catch (error) {
      this.classify(error, `discard on ${robotId}`);
      return false;
    }
  }

  /**
   * Park the robot's recorder without ending the session.
   *
   * `false` means the robot did not take it — an old agent, or one that is not
   * recording — and the caller has to decide whether that matters. It does:
   * a pause the robot did not hear leaves it filling the dataset with whatever
   * the arms do while nobody is driving them.
   */
  async pause(robotId: string): Promise<boolean> {
    return this.toggle(robotId, 'pause');
  }

  async resume(robotId: string): Promise<boolean> {
    return this.toggle(robotId, 'resume');
  }

  private async toggle(robotId: string, verb: 'pause' | 'resume'): Promise<boolean> {
    const client = await this.client(robotId, HTTP_TIMEOUTS.SHORT);
    if (!client) return false;
    try {
      await client.post<unknown>(this.path(robotId, `/${verb}`));
      return true;
    } catch (error) {
      this.classify(error, `${verb} on ${robotId}`);
      return false;
    }
  }

  /**
   * Stop and collect the result.
   *
   * The encode happens inside this call, so it gets the LONG timeout: a
   * two-minute session at 30 fps with two cameras is thousands of JPEGs going
   * through ffmpeg, and hanging up early would leave the robot writing a
   * dataset nobody is waiting for.
   */
  async stop(robotId: string): Promise<AgentRecordingStopResult | null> {
    // Not LONG (30 s): the encode runs INSIDE this call, and a two-minute
    // session at 30 fps with two cameras is thousands of JPEGs going through
    // ffmpeg. Hanging up at 30 s would leave the robot writing a dataset nobody
    // is waiting for, and the session would be completed with no dataset while
    // one appeared on the robot's disk a minute later.
    const client = await this.client(robotId, STOP_TIMEOUT_MS);
    if (!client) return null;
    try {
      const answer = await client.post<unknown>(this.path(robotId, '/stop'));
      if (!isRecord(answer) || typeof answer.ok !== 'boolean') {
        throw new HttpClientError('robot returned no stop result', undefined, 'invalid_response');
      }
      return answer as unknown as AgentRecordingStopResult;
    } catch (error) {
      return this.classify(error, `stop on ${robotId}`);
    }
  }

  async status(robotId: string): Promise<AgentRecordingStatus | null> {
    const client = await this.client(robotId, HTTP_TIMEOUTS.SHORT);
    if (!client) return null;
    try {
      const answer = await client.get<unknown>(this.path(robotId, '/status'));
      if (!isRecord(answer) || typeof answer.recording !== 'boolean') return null;
      return answer as unknown as AgentRecordingStatus;
    } catch (error) {
      return this.classify(error, `status on ${robotId}`);
    }
  }
}

export const agentRecordingService = new AgentRecordingService();
