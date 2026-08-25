/**
 * @file cameraApi.ts
 * @description Camera stream tickets and the stream URL built from one.
 * @feature robots
 */

import { apiClient } from '@/api/client';

// Note: apiClient already has /api prefix in baseURL
const ENDPOINTS = {
  ticket: (robotId: string, cameraName: string) =>
    `/robots/${encodeURIComponent(robotId)}/camera/${encodeURIComponent(cameraName)}/ticket`,
} as const;

export interface CameraTicket {
  /** Opaque, signed by the server. Good for one camera, for `expiresIn` seconds. */
  ticket: string;
  /** Seconds until the ticket stops working. */
  expiresIn: number;
}

/**
 * Ask for permission to open one camera stream (TASK-214).
 *
 * The stream is rendered in an `<img>`, which cannot send an `Authorization`
 * header, so the credential has to ride in the URL. This is the credential:
 * scoped to one robot and one camera, valid for about two minutes, and useless
 * for anything else — unlike the access token that used to sit there, which was
 * the caller's real one.
 *
 * Goes through `apiClient`, so it inherits bearer auth, tenant impersonation and
 * the 401-refresh-and-retry every other call in the app gets.
 */
export async function fetchCameraTicket(
  robotId: string,
  cameraName: string
): Promise<CameraTicket> {
  const response = await apiClient.post<CameraTicket>(ENDPOINTS.ticket(robotId, cameraName));
  return response.data;
}

/**
 * The MJPEG stream URL for one camera, carrying a ticket.
 *
 * @param baseUrl Where `/robots/...` hangs off. Defaults to the app's own
 *        origin, which is what the VR panel needs: WebGL refuses to sample a
 *        cross-origin image without CORS, and a cross-origin draw would taint
 *        the scratch canvas the panel reads its liveness fingerprint from.
 *        Views with no canvas readback may pass `apiClient`'s absolute base.
 */
export function cameraStreamUrl(
  robotId: string,
  cameraName: string,
  ticket: string | null,
  baseUrl = '/api'
): string {
  const path =
    `${baseUrl.replace(/\/$/, '')}` +
    `/robots/${encodeURIComponent(robotId)}/camera/${encodeURIComponent(cameraName)}`;
  return ticket ? `${path}?ticket=${encodeURIComponent(ticket)}` : path;
}
