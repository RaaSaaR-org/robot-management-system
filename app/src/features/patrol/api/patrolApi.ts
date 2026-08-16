/**
 * @file patrolApi.ts
 * @description REST calls for the server-side patrol endpoints (TASK-212):
 *              routes CRUD, cron validation, runs, findings, photos, places.
 * @feature patrol
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type {
  CronValidation,
  PatrolBaselineInfo,
  PatrolFinding,
  PatrolFindingNormalResult,
  PatrolFindingQuery,
  PatrolPlace,
  PatrolRoute,
  PatrolRouteInput,
  PatrolRun,
  PatrolRunMode,
  PatrolRunOrigin,
  PatrolRunQuery,
  PatrolRunWithFindings,
  PatrolStartResult,
} from '../types/patrol.types';

// ============================================================================
// ENDPOINTS
// ============================================================================

// apiClient already carries the /api prefix in its baseURL.
const ENDPOINTS = {
  routes: '/patrol/routes',
  route: (id: string) => `/patrol/routes/${encodeURIComponent(id)}`,
  routeExport: (id: string) => `/patrol/routes/${encodeURIComponent(id)}/export/vda5050.json`,
  routeStart: (id: string) => `/patrol/routes/${encodeURIComponent(id)}/start`,
  routeAbort: (id: string) => `/patrol/routes/${encodeURIComponent(id)}/abort`,
  routeBaseline: (id: string) => `/patrol/routes/${encodeURIComponent(id)}/baseline`,
  cronValidate: '/patrol/cron/validate',
  places: '/patrol/places',
  runs: '/patrol/runs',
  run: (runId: string) => `/patrol/runs/${encodeURIComponent(runId)}`,
  runPromote: (runId: string) => `/patrol/runs/${encodeURIComponent(runId)}/promote`,
  findings: '/patrol/findings',
  finding: (id: string) => `/patrol/findings/${encodeURIComponent(id)}`,
  findingAck: (id: string) => `/patrol/findings/${encodeURIComponent(id)}/acknowledge`,
  findingNormal: (id: string) => `/patrol/findings/${encodeURIComponent(id)}/normal`,
  findingEscalate: (id: string) => `/patrol/findings/${encodeURIComponent(id)}/escalate`,
  photo: (robotId: string, runId: string, key: string) =>
    `/robots/${encodeURIComponent(robotId)}/patrol-runs/${encodeURIComponent(runId)}/photos/${encodeURIComponent(key)}`,
} as const;

/**
 * The robot writes `photoKey` as `<runId>/<checkpointId>.jpg`; the server's
 * photo route takes only the last segment (`<checkpointId>.jpg`). Accept both.
 */
export function photoKeyBasename(key: string): string {
  const idx = key.lastIndexOf('/');
  return idx === -1 ? key : key.slice(idx + 1);
}

/** Tolerate both `{ places: [...] }` and a bare array from the places proxy. */
function unwrapPlaces(data: unknown): PatrolPlace[] {
  if (Array.isArray(data)) return data as PatrolPlace[];
  if (data && typeof data === 'object' && Array.isArray((data as { places?: unknown }).places)) {
    return (data as { places: PatrolPlace[] }).places;
  }
  return [];
}

// ============================================================================
// API
// ============================================================================

export const patrolApi = {
  // --- routes ---------------------------------------------------------------

  async listRoutes(robotId?: string | null): Promise<PatrolRoute[]> {
    const response = await apiClient.get<PatrolRoute[]>(ENDPOINTS.routes, {
      params: robotId ? { robotId } : undefined,
    });
    return Array.isArray(response.data) ? response.data : [];
  },

  async getRoute(id: string): Promise<PatrolRoute> {
    const response = await apiClient.get<PatrolRoute>(ENDPOINTS.route(id));
    return response.data;
  },

  async createRoute(input: PatrolRouteInput): Promise<PatrolRoute> {
    const response = await apiClient.post<PatrolRoute>(ENDPOINTS.routes, input);
    return response.data;
  },

  async updateRoute(id: string, input: PatrolRouteInput): Promise<PatrolRoute> {
    const response = await apiClient.put<PatrolRoute>(ENDPOINTS.route(id), input);
    return response.data;
  },

  async deleteRoute(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.route(id));
  },

  /** VDA5050-style nodes/edges document for the route. */
  async exportVda5050(id: string): Promise<unknown> {
    const response = await apiClient.get<unknown>(ENDPOINTS.routeExport(id));
    return response.data;
  },

  /** Start a run; `accepted:false` is a normal answer (the robot refused), not an error. */
  async startRoute(
    id: string,
    mode: PatrolRunMode,
    robotId?: string | null,
    origin: PatrolRunOrigin = 'operator'
  ): Promise<PatrolStartResult> {
    const response = await apiClient.post<PatrolStartResult>(ENDPOINTS.routeStart(id), {
      mode,
      origin,
      ...(robotId ? { robotId } : {}),
    });
    return response.data;
  },

  async abortRoute(id: string, robotId?: string | null): Promise<{ ok: boolean; runId?: string }> {
    const response = await apiClient.post<{ ok: boolean; runId?: string }>(ENDPOINTS.routeAbort(id), {
      ...(robotId ? { robotId } : {}),
    });
    return response.data;
  },

  async getBaseline(routeId: string, window?: string | null): Promise<PatrolBaselineInfo> {
    const response = await apiClient.get<PatrolBaselineInfo>(ENDPOINTS.routeBaseline(routeId), {
      params: window ? { window } : undefined,
    });
    const data = response.data ?? { runId: null, window: window ?? null, photos: {} };
    return {
      runId: data.runId ?? null,
      robotId: data.robotId ?? null,
      window: data.window ?? null,
      photos: data.photos ?? {},
    };
  },

  // --- cron / places --------------------------------------------------------

  async validateCron(cronExpression: string): Promise<CronValidation> {
    const response = await apiClient.post<CronValidation>(ENDPOINTS.cronValidate, { cronExpression });
    const data = response.data;
    return { valid: Boolean(data?.valid), nextRuns: data?.nextRuns ?? [], error: data?.error };
  },

  async listPlaces(robotId: string): Promise<PatrolPlace[]> {
    const response = await apiClient.get<unknown>(ENDPOINTS.places, { params: { robotId } });
    return unwrapPlaces(response.data);
  },

  // --- runs -----------------------------------------------------------------

  async listRuns(query: PatrolRunQuery = {}): Promise<PatrolRun[]> {
    const response = await apiClient.get<PatrolRun[]>(ENDPOINTS.runs, { params: query });
    return Array.isArray(response.data) ? response.data : [];
  },

  async getRun(runId: string): Promise<PatrolRunWithFindings> {
    const response = await apiClient.get<PatrolRunWithFindings>(ENDPOINTS.run(runId));
    const data = response.data;
    return { ...data, findings: Array.isArray(data.findings) ? data.findings : [] };
  },

  async promoteRun(runId: string): Promise<{ ok: boolean }> {
    const response = await apiClient.post<{ ok: boolean }>(ENDPOINTS.runPromote(runId));
    return response.data;
  },

  // --- findings -------------------------------------------------------------

  async listFindings(query: PatrolFindingQuery = {}): Promise<PatrolFinding[]> {
    const response = await apiClient.get<PatrolFinding[]>(ENDPOINTS.findings, { params: query });
    return Array.isArray(response.data) ? response.data : [];
  },

  async getFinding(id: string): Promise<PatrolFinding> {
    const response = await apiClient.get<PatrolFinding>(ENDPOINTS.finding(id));
    return response.data;
  },

  async acknowledgeFinding(id: string): Promise<PatrolFinding> {
    const response = await apiClient.post<PatrolFinding>(ENDPOINTS.findingAck(id));
    return response.data;
  },

  /** "This is normal": dismisses and teaches the baseline (best effort on the robot). */
  async markFindingNormal(id: string): Promise<PatrolFindingNormalResult> {
    const response = await apiClient.post<PatrolFinding | PatrolFindingNormalResult>(ENDPOINTS.findingNormal(id));
    const data = response.data as Partial<PatrolFindingNormalResult> & Partial<PatrolFinding>;
    // The server may answer with the finding itself or `{ finding, robotNotified }`.
    if (data && typeof data === 'object' && 'finding' in data && data.finding) {
      return { finding: data.finding, robotNotified: data.robotNotified };
    }
    return { finding: data as PatrolFinding, robotNotified: (data as { robotNotified?: boolean }).robotNotified };
  },

  async escalateFinding(id: string): Promise<PatrolFinding> {
    const response = await apiClient.post<PatrolFinding>(ENDPOINTS.findingEscalate(id));
    return response.data;
  },

  // --- photos ---------------------------------------------------------------

  /**
   * Fetch a control/baseline photo as a Blob and hand back an object URL. Goes
   * through the API client so the bearer token travels with the request; the
   * caller revokes the URL when done.
   */
  async fetchPhotoUrl(robotId: string, runId: string, key: string): Promise<string> {
    const response = await apiClient.get<Blob>(ENDPOINTS.photo(robotId, runId, photoKeyBasename(key)), {
      responseType: 'blob',
    });
    return URL.createObjectURL(response.data);
  },
};
