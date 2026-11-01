/**
 * @file baseModeApi.ts
 * @description The robot's locomotion MODE (TASK-398): read the measured mode
 *              and switch between limp, stand and balance without the Unitree
 *              remote. Refusals (400/403/409/503/504) come back as values with
 *              the agent's or sidecar's machine `code`, never as throws, so the
 *              mode control can say exactly why.
 * @feature robots
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';

const ENDPOINT = (robotId: string) => `/robots/${encodeURIComponent(robotId)}/base-mode`;

export type BaseModeCommand = 'limp' | 'stand' | 'balance';
export type BaseModeName = 'limp' | 'stand' | 'balance' | 'zero_torque' | 'other' | 'unknown';
export type LocoGate = 'off' | 'fsm' | 'full' | 'unknown';

export interface BaseModeCapability {
  gate: LocoGate;
  moveEnabled: boolean | null;
  idsVerified: boolean;
  ids: { limp: number; stand: number; balance: number; balanceReported: number[] } | null;
}

export interface BaseModeReading {
  fsmId: number | null;
  mode: BaseModeName;
  /** Age of the measurement, seconds. */
  ageS: number | null;
  /** Why the mode is unknown (or the last RPC error), from the sidecar. */
  error: string | null;
}

export interface BaseModeStatus {
  capability: BaseModeCapability;
  base: BaseModeReading | null;
  /** A change the sidecar is still confirming, or null. */
  inFlight: string | null;
  /** The agent's E-stop latch. */
  estopLatched: boolean;
  /** The sidecar's own latch. */
  sidecarEstopLatched?: boolean;
  armed: boolean;
  armWeight?: number;
  agentModeRunning?: boolean;
  /**
   * Whether the robot sidecar answered, from the server's cached readiness
   * snapshot (TASK-409); null/absent when the server has none.
   */
  sidecarReachable?: boolean | null;
}

export type BaseModeResult =
  | { ok: true; status: number; fsmId: number | null; tookMs: number | null }
  | {
      ok: false;
      status: number;
      code: string;
      error: string;
      /** `not_settled`: seconds still to wait. */
      settleRemainingS?: number;
      /** `unconfirmed` / `fsm_unknown`: what the sidecar measured. */
      measured?: BaseModeReading | null;
      /** What the operator should check, when the sidecar has a guess (wrong balance FSM id). */
      hint?: string;
    };

/** Every status whose body carries a reason. */
const acceptAll = (status: number): boolean => status >= 200 && status < 600;

function toReading(v: unknown): BaseModeReading | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const mode = typeof o.mode === 'string' ? (o.mode as BaseModeName) : 'unknown';
  const fsmId = typeof o.fsmId === 'number' ? o.fsmId : typeof o.fsm_id === 'number' ? o.fsm_id : null;
  const ageS = typeof o.ageS === 'number' ? o.ageS : typeof o.age_s === 'number' ? o.age_s : null;
  return { fsmId, mode, ageS, error: typeof o.error === 'string' ? o.error : null };
}

/** GET the capability, the measured mode and the latches. */
export async function getBaseMode(robotId: string): Promise<BaseModeStatus> {
  const response = await apiClient.get<BaseModeStatus>(ENDPOINT(robotId));
  return response.data;
}

/** POST a mode change under the bound control lease. */
export async function setBaseMode(
  robotId: string,
  mode: BaseModeCommand,
  lease: { leaseId: string; generation: number },
): Promise<BaseModeResult> {
  const response = await apiClient.post<Record<string, unknown>>(
    ENDPOINT(robotId),
    { mode, leaseId: lease.leaseId, generation: lease.generation },
    // A confirmed change takes RPC + GetFsmId polling on the robot.
    { validateStatus: acceptAll, timeout: 20_000 },
  );
  const body = response.data ?? {};
  if (response.status >= 200 && response.status < 300 && body.ok !== false) {
    return {
      ok: true,
      status: response.status,
      fsmId: typeof body.fsm_id === 'number' ? body.fsm_id : null,
      tookMs: typeof body.took_ms === 'number' ? body.took_ms : null,
    };
  }
  return {
    ok: false,
    status: response.status,
    code: typeof body.code === 'string' ? body.code : `http_${response.status}`,
    error: typeof body.error === 'string' ? body.error : `the robot refused (HTTP ${response.status})`,
    ...(typeof body.settle_remaining_s === 'number' ? { settleRemainingS: body.settle_remaining_s } : {}),
    ...(body.measured !== undefined ? { measured: toReading(body.measured) } : {}),
    ...(typeof body.hint === 'string' && body.hint.trim() ? { hint: body.hint } : {}),
  };
}

export const baseModeApi = { getBaseMode, setBaseMode };
export type BaseModeApi = typeof baseModeApi;
