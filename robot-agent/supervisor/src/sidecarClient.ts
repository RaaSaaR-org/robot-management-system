/**
 * @file sidecarClient.ts
 * @description The supervisor's ONLY way to talk to g1_sidecar.py. It can read
 * /health, ask for /disarm and forward /estop — nothing that moves the robot or
 * changes its mode. There is deliberately no /arm, /action, /loco/* or
 * /estop/reset call here; __tests__/sidecarClient.static.test.ts reads this file
 * and fails if one appears. Mode changes go through the agent's confirmed,
 * lease-checked base-mode route, never through the supervisor.
 * @feature supervisor
 */

export interface SidecarHealth {
  connected?: boolean;
  write_mode?: string;
  armed?: boolean;
  arm_weight?: number;
  dds_domain?: number | null;
  estop_latched?: boolean;
  loco?: { gate?: string } | null;
  base?: { mode?: string; fsm_id?: number | null; age_s?: number | null } | null;
  [key: string]: unknown;
}

export interface SidecarReply {
  status: number;
  body: Record<string, unknown>;
}

export type FetchLike = typeof fetch;

export class SidecarClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 2000,
  ) {}

  private async request(method: 'GET' | 'POST', path: '/health' | '/disarm' | '/estop', body?: unknown): Promise<SidecarReply> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await res.json()) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    return { status: res.status, body: parsed };
  }

  /** GET /health, or null when the sidecar does not answer. */
  async health(): Promise<SidecarHealth | null> {
    try {
      const r = await this.request('GET', '/health');
      return r.status === 200 ? (r.body as SidecarHealth) : null;
    } catch {
      return null;
    }
  }

  /** POST /disarm — ramps the arm_sdk weight to 0. Safe in every mode. */
  async disarm(): Promise<SidecarReply> {
    return this.request('POST', '/disarm', {});
  }

  /** POST /estop — the sidecar's latched E-stop (disarm, and damp when mode control is on). */
  async estop(): Promise<SidecarReply> {
    return this.request('POST', '/estop', {});
  }
}
