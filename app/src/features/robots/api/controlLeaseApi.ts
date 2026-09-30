/**
 * @file controlLeaseApi.ts
 * @description The server's robot-wide control lease (TASK-317/318): read the
 *              capability and holder, acquire, renew and release. The refusals
 *              the lease hook acts on (409 / 403) come back as values, not
 *              throws, because they carry the holder or the reason code.
 * @feature robots
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';

// Note: apiClient already has /api prefix in baseURL
const ENDPOINTS = {
  lease: (robotId: string) => `/robots/${encodeURIComponent(robotId)}/control-lease`,
  renew: (robotId: string) => `/robots/${encodeURIComponent(robotId)}/control-lease/renew`,
  release: (robotId: string) => `/robots/${encodeURIComponent(robotId)}/control-lease/release`,
} as const;

/** What the server advertises; `enabled:false` means "behave as before leases". */
export interface ControlLeaseCapability {
  version: number;
  enabled: boolean;
  ttlMs: number;
  renewEveryMs: number;
}

/** Who holds the robot — never the secret or its hash. */
export interface ControlLeaseHolder {
  userId: string;
  displayName: string;
  state?: 'installing' | 'held' | 'stopping' | 'unconfirmed';
  generation?: number;
  /** ISO timestamp of the server's deadline. */
  expiresAt?: string;
}

export interface ControlLeaseStatus {
  capability: ControlLeaseCapability;
  holder: ControlLeaseHolder | null;
}

/** A granted lease. `leaseId` is the secret: keep it in memory only. */
export interface ControlLeaseGrant {
  leaseId: string;
  generation: number;
  sessionId: string;
  ttlMs: number;
  renewEveryMs: number;
  expiresAt: string;
}

export type AcquireResult =
  | { ok: true; grant: ControlLeaseGrant }
  | { ok: false; code: string; holder: ControlLeaseHolder | null; status: number };

export type RenewResult =
  | { ok: true; generation: number; expiresAt: string; ttlMs: number; renewEveryMs: number }
  | { ok: false; code: string; status: number };

/** Statuses whose body the hook needs; anything else still rejects. */
const acceptRefusals = (status: number): boolean =>
  (status >= 200 && status < 300) || status === 403 || status === 409 || status === 503;

interface RefusalBody {
  code?: string;
  holder?: ControlLeaseHolder | null;
}

/** GET the capability and the current holder. */
export async function getControlLease(robotId: string): Promise<ControlLeaseStatus> {
  const response = await apiClient.get<ControlLeaseStatus>(ENDPOINTS.lease(robotId));
  return response.data;
}

/** POST — take the robot. 409 names the holder; 503 means the agent is unconfirmed. */
export async function acquireControlLease(robotId: string): Promise<AcquireResult> {
  const response = await apiClient.post<ControlLeaseGrant & RefusalBody>(
    ENDPOINTS.lease(robotId),
    {},
    { validateStatus: acceptRefusals },
  );
  if (response.status >= 200 && response.status < 300) {
    return { ok: true, grant: response.data };
  }
  return {
    ok: false,
    code: response.data?.code ?? 'acquire_refused',
    holder: response.data?.holder ?? null,
    status: response.status,
  };
}

/** POST …/renew — every `renewEveryMs` while bound. */
export async function renewControlLease(
  robotId: string,
  leaseId: string,
  generation: number,
): Promise<RenewResult> {
  const response = await apiClient.post<Omit<Extract<RenewResult, { ok: true }>, 'ok'> & RefusalBody>(
    ENDPOINTS.renew(robotId),
    { leaseId, generation },
    { validateStatus: acceptRefusals },
  );
  if (response.status >= 200 && response.status < 300) {
    const { generation: g, expiresAt, ttlMs, renewEveryMs } = response.data;
    return { ok: true, generation: g, expiresAt, ttlMs, renewEveryMs };
  }
  return { ok: false, code: response.data?.code ?? 'renew_refused', status: response.status };
}

/** POST …/release — `{released:false}` when it was no longer ours. */
export async function releaseControlLease(
  robotId: string,
  leaseId: string,
  generation: number,
): Promise<{ released: boolean }> {
  const response = await apiClient.post<{ released?: boolean }>(
    ENDPOINTS.release(robotId),
    { leaseId, generation },
    { validateStatus: acceptRefusals },
  );
  return { released: response.data?.released === true };
}

/** Grouped form, matching the other API modules in this feature. */
export const controlLeaseApi = {
  getControlLease,
  acquireControlLease,
  renewControlLease,
  releaseControlLease,
};

export type ControlLeaseApi = typeof controlLeaseApi;
