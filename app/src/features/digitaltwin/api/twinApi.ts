/**
 * @file twinApi.ts
 * @description API client for the digital-twin server endpoints — DigitalTwin
 *   CRUD + artifact streams, scan-session lifecycle, and zone CRUD. The legacy
 *   agent scan proxies are kept for the sim preview path (useScanSession drives
 *   the live client-accumulated cloud while the server runs the authoritative
 *   capture loop).
 * @feature digitaltwin
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type {
  DigitalTwinDTO,
  ScanSessionDTO,
  TwinZoneDTO,
  CreateTwinRequest,
  CreateTwinZoneRequest,
  UpdateTwinZoneRequest,
  SensorScanSummaryDTO,
} from '../types/twin.types';

// apiClient already prefixes /api.
const ENDPOINTS = {
  twins: '/digital-twins',
  twin: (id: string) => `/digital-twins/${id}`,
  cloud: (id: string) => `/digital-twins/${id}/cloud`,
  mesh: (id: string) => `/digital-twins/${id}/mesh`,
  occupancyPgm: (id: string) => `/digital-twins/${id}/occupancy.pgm`,
  occupancyYaml: (id: string) => `/digital-twins/${id}/occupancy.yaml`,
  zones: (id: string) => `/digital-twins/${id}/zones`,
  zone: (id: string, zoneId: string) => `/digital-twins/${id}/zones/${zoneId}`,
  exportKeepoutPgm: (id: string) => `/digital-twins/${id}/export/nav2-keepout.pgm`,
  exportKeepoutYaml: (id: string) => `/digital-twins/${id}/export/nav2-keepout.yaml`,
  exportVda5050: (id: string) => `/digital-twins/${id}/export/vda5050.json`,
  importScan: (id: string) => `/digital-twins/${id}/import`,
  sessions: '/scan-sessions',
  session: (id: string) => `/scan-sessions/${id}`,
  sessionStop: (id: string) => `/scan-sessions/${id}/stop`,
  sessionFrames: (id: string) => `/scan-sessions/${id}/frames`,
  // Legacy agent scan proxies (kept for the live sim preview path).
  agentStart: (robotId: string) => `/robots/${robotId}/pointcloud/scan/start`,
  agentStop: (robotId: string) => `/robots/${robotId}/pointcloud/scan/stop`,
  agentStatus: (robotId: string) => `/robots/${robotId}/pointcloud/scan/status`,
} as const;

export interface AgentScanStatusResult {
  active: boolean;
  sessionId?: string;
  frames: number;
  startedAt?: string;
}

export const twinApi = {
  // ------------------------------------------------------------------------
  // Digital twins (system of record)
  // ------------------------------------------------------------------------

  /** List all digital twins (the gallery). */
  async listTwins(): Promise<DigitalTwinDTO[]> {
    const res = await apiClient.get<DigitalTwinDTO[]>(ENDPOINTS.twins);
    return res.data;
  },

  /** Create a digital twin (a new scannable site). */
  async createTwin(body: CreateTwinRequest): Promise<DigitalTwinDTO> {
    const res = await apiClient.post<DigitalTwinDTO>(ENDPOINTS.twins, body);
    return res.data;
  },

  /** Fetch one digital twin by id. */
  async getTwin(id: string): Promise<DigitalTwinDTO> {
    const res = await apiClient.get<DigitalTwinDTO>(ENDPOINTS.twin(id));
    return res.data;
  },

  /** Delete a digital twin (and cascades its zones/sessions server-side). */
  async deleteTwin(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.twin(id));
  },

  /** Download the authoritative merged cloud (binary PCD). Throws/404 if none. */
  async getTwinCloud(id: string): Promise<ArrayBuffer> {
    const res = await apiClient.get<ArrayBuffer>(ENDPOINTS.cloud(id), {
      responseType: 'arraybuffer',
    });
    return res.data;
  },

  /** Absolute URL for the twin's GLB mesh artifact (for useGLTF / drei). */
  meshUrl(id: string): string {
    return absoluteApiUrl(ENDPOINTS.mesh(id));
  },

  /** Download the occupancy grid (binary P5 PGM) for client-side rendering. */
  async getOccupancyPgm(id: string): Promise<ArrayBuffer> {
    const res = await apiClient.get<ArrayBuffer>(ENDPOINTS.occupancyPgm(id), {
      responseType: 'arraybuffer',
    });
    return res.data;
  },

  // ------------------------------------------------------------------------
  // Zones (L2 authoring)
  // ------------------------------------------------------------------------

  async listZones(twinId: string): Promise<TwinZoneDTO[]> {
    const res = await apiClient.get<TwinZoneDTO[]>(ENDPOINTS.zones(twinId));
    return res.data;
  },

  async createZone(twinId: string, body: CreateTwinZoneRequest): Promise<TwinZoneDTO> {
    const res = await apiClient.post<TwinZoneDTO>(ENDPOINTS.zones(twinId), body);
    return res.data;
  },

  async updateZone(twinId: string, zoneId: string, body: UpdateTwinZoneRequest): Promise<TwinZoneDTO> {
    const res = await apiClient.put<TwinZoneDTO>(ENDPOINTS.zone(twinId, zoneId), body);
    return res.data;
  },

  async deleteZone(twinId: string, zoneId: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.zone(twinId, zoneId));
  },

  // ------------------------------------------------------------------------
  // Export (Nav2 keep-out + VDA5050) — fetched as blobs for browser download
  // ------------------------------------------------------------------------

  async downloadKeepoutPgm(twinId: string): Promise<Blob> {
    const res = await apiClient.get<Blob>(ENDPOINTS.exportKeepoutPgm(twinId), { responseType: 'blob' });
    return res.data;
  },

  async downloadKeepoutYaml(twinId: string): Promise<Blob> {
    const res = await apiClient.get<Blob>(ENDPOINTS.exportKeepoutYaml(twinId), { responseType: 'blob' });
    return res.data;
  },

  async downloadVda5050(twinId: string): Promise<Blob> {
    const res = await apiClient.get<Blob>(ENDPOINTS.exportVda5050(twinId), { responseType: 'blob' });
    return res.data;
  },

  /**
   * Import a recorded point-cloud file (.ply / .pcd) as a one-frame scan
   * session — the server queues it for the twin-builder exactly like a live
   * sweep. Returns the created session; twin flips to 'processing'.
   */
  async importScan(twinId: string, file: File, robotId?: string): Promise<ScanSessionDTO> {
    const params = new URLSearchParams({ filename: file.name });
    if (robotId) params.set('robotId', robotId);
    const res = await apiClient.post<ScanSessionDTO>(
      `${ENDPOINTS.importScan(twinId)}?${params.toString()}`,
      file,
      { headers: { 'Content-Type': 'application/octet-stream' } },
    );
    return res.data;
  },

  // ------------------------------------------------------------------------
  // Scan sessions (server-driven capture)
  // ------------------------------------------------------------------------

  /** Start a server scan session (server also kicks the agent scan + capture loop). */
  async createSession(body: { robotId: string; twinId: string }): Promise<ScanSessionDTO> {
    const res = await apiClient.post<ScanSessionDTO>(ENDPOINTS.sessions, body);
    return res.data;
  },

  /** Stop a session (server stops the agent + queues the build). */
  async stopSession(sessionId: string): Promise<ScanSessionDTO> {
    const res = await apiClient.post<ScanSessionDTO>(ENDPOINTS.sessionStop(sessionId));
    return res.data;
  },

  async getSession(sessionId: string): Promise<ScanSessionDTO> {
    const res = await apiClient.get<ScanSessionDTO>(ENDPOINTS.session(sessionId));
    return res.data;
  },

  async getSessionFrames(sessionId: string): Promise<SensorScanSummaryDTO[]> {
    const res = await apiClient.get<{ frames: SensorScanSummaryDTO[] }>(ENDPOINTS.sessionFrames(sessionId));
    return res.data.frames;
  },

  // ------------------------------------------------------------------------
  // Legacy agent scan proxies (kept for the live sim preview fallback)
  // ------------------------------------------------------------------------

  async agentStartScan(robotId: string, sessionId?: string): Promise<{ sessionId: string; active: true }> {
    const res = await apiClient.post<{ sessionId: string; active: true }>(ENDPOINTS.agentStart(robotId), {
      sessionId,
    });
    return res.data;
  },

  async agentStopScan(robotId: string): Promise<{ sessionId: string | null; frames: number }> {
    const res = await apiClient.post<{ sessionId: string | null; frames: number }>(ENDPOINTS.agentStop(robotId));
    return res.data;
  },

  async agentScanStatus(robotId: string): Promise<AgentScanStatusResult> {
    const res = await apiClient.get<AgentScanStatusResult>(ENDPOINTS.agentStatus(robotId));
    return res.data;
  },
};

/**
 * Resolve an apiClient-relative path (e.g. `/digital-twins/x/mesh`) into the
 * absolute URL the browser should hit — needed for `<source>`/useGLTF which
 * bypass axios. Honors `VITE_API_BASE_URL` (default `/api`, relative to host).
 */
export function absoluteApiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';
  if (/^https?:\/\//.test(base)) return `${base}${path}`;
  if (typeof window === 'undefined') return `${base}${path}`;
  return `${window.location.origin}${base}${path}`;
}
