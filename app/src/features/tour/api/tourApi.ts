/**
 * @file tourApi.ts
 * @description REST calls for the server-side host-mode endpoints (TASK-213):
 *              tour routes CRUD, start/abort, runs, places, and the skill
 *              library the editor picks a stop's demo from.
 * @feature tour
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type {
  TourPlace,
  TourRoute,
  TourRouteInput,
  TourRun,
  TourRunDetail,
  TourRunQuery,
  TourSkillOption,
  TourStartResult,
} from '../types/tour.types';

// ============================================================================
// ENDPOINTS
// ============================================================================

// apiClient already carries the /api prefix in its baseURL.
const ENDPOINTS = {
  routes: '/tour/routes',
  route: (id: string) => `/tour/routes/${encodeURIComponent(id)}`,
  routeStart: (id: string) => `/tour/routes/${encodeURIComponent(id)}/start`,
  routeAbort: (id: string) => `/tour/routes/${encodeURIComponent(id)}/abort`,
  places: '/tour/places',
  runs: '/tour/runs',
  run: (runId: string) => `/tour/runs/${encodeURIComponent(runId)}`,
  skills: '/skills',
} as const;

/** Tolerate both `{ places: [...] }` and a bare array from the places proxy. */
function unwrapPlaces(data: unknown): TourPlace[] {
  if (Array.isArray(data)) return data as TourPlace[];
  if (data && typeof data === 'object' && Array.isArray((data as { places?: unknown }).places)) {
    return (data as { places: TourPlace[] }).places;
  }
  return [];
}

/**
 * `GET /api/skills` answers `{ skills, pagination }`. Unwrapped defensively (and
 * narrowed to the picker's fields) so a paginated envelope, or a bare array from
 * a future revision, both land as a usable list instead of an empty dropdown.
 */
function unwrapSkills(data: unknown): TourSkillOption[] {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { skills?: unknown }).skills)
      ? (data as { skills: unknown[] }).skills
      : [];
  return list
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .filter((s) => typeof s.id === 'string' && typeof s.name === 'string')
    .map((s) => ({
      id: s.id as string,
      name: s.name as string,
      version: typeof s.version === 'string' ? s.version : undefined,
      status: typeof s.status === 'string' ? s.status : undefined,
      timeout: typeof s.timeout === 'number' ? s.timeout : null,
      linkedModelVersionId: typeof s.linkedModelVersionId === 'string' ? s.linkedModelVersionId : null,
    }));
}

/** Runs come back with their transcript; an absent one is an empty one, never undefined. */
function normalizeRun(run: TourRun): TourRun {
  return {
    ...run,
    legs: Array.isArray(run.legs) ? run.legs : [],
    turns: Array.isArray(run.turns) ? run.turns : [],
  };
}

// ============================================================================
// API
// ============================================================================

export const tourApi = {
  // --- routes ---------------------------------------------------------------

  async listRoutes(robotId?: string | null): Promise<TourRoute[]> {
    const response = await apiClient.get<TourRoute[]>(ENDPOINTS.routes, {
      params: robotId ? { robotId } : undefined,
    });
    return Array.isArray(response.data) ? response.data : [];
  },

  async getRoute(id: string): Promise<TourRoute> {
    const response = await apiClient.get<TourRoute>(ENDPOINTS.route(id));
    return response.data;
  },

  async createRoute(input: TourRouteInput): Promise<TourRoute> {
    const response = await apiClient.post<TourRoute>(ENDPOINTS.routes, input);
    return response.data;
  },

  async updateRoute(id: string, input: TourRouteInput): Promise<TourRoute> {
    const response = await apiClient.put<TourRoute>(ENDPOINTS.route(id), input);
    return response.data;
  },

  async deleteRoute(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.route(id));
  },

  /**
   * Start a tour from the UI. `origin` is fixed to `operator` here — a `visitor`
   * run is one the robot offered and a person accepted out loud, which no button
   * in this app can honestly claim happened.
   */
  async startRoute(id: string, robotId?: string | null): Promise<TourStartResult> {
    const response = await apiClient.post<TourStartResult>(ENDPOINTS.routeStart(id), {
      origin: 'operator',
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

  // --- places / skills ------------------------------------------------------

  async listPlaces(robotId: string): Promise<TourPlace[]> {
    const response = await apiClient.get<unknown>(ENDPOINTS.places, { params: { robotId } });
    return unwrapPlaces(response.data);
  },

  /** The skill library, for the stop editor's demo picker. */
  async listSkills(): Promise<TourSkillOption[]> {
    const response = await apiClient.get<unknown>(ENDPOINTS.skills, { params: { pageSize: 100 } });
    return unwrapSkills(response.data);
  },

  // --- runs -----------------------------------------------------------------

  async listRuns(query: TourRunQuery = {}): Promise<TourRun[]> {
    const response = await apiClient.get<TourRun[]>(ENDPOINTS.runs, { params: query });
    return Array.isArray(response.data) ? response.data.map(normalizeRun) : [];
  },

  async getRun(runId: string): Promise<TourRunDetail> {
    const response = await apiClient.get<TourRunDetail>(ENDPOINTS.run(runId));
    return normalizeRun(response.data);
  },
};
