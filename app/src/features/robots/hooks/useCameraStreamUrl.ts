/**
 * @file useCameraStreamUrl.ts
 * @description Ticketed MJPEG stream URL for a plain `<img>` camera view.
 * @feature robots
 */

import { useEffect, useState } from 'react';
import { cameraStreamUrl, fetchCameraTicket } from '../api/cameraApi';

/** What the hook knows about the stream it was asked for. */
export interface CameraStreamUrlState {
  /** The URL to hand an `<img>`, or null while there is no ticket yet. */
  url: string | null;
  /** True once a ticket request has failed — the stream cannot be opened. */
  denied: boolean;
}

/**
 * Fetch a stream ticket for one camera and build the URL from it (TASK-214).
 *
 * An `<img>` cannot send an `Authorization` header, so the credential travels
 * in the URL. It used to be the user's real access token; it is now a ticket
 * scoped to this robot and this camera and valid for about two minutes.
 *
 * `denied` matters as much as `url`: an `<img>` whose `src` is never assigned
 * fires no `onerror`, so a view that only watched for image errors would sit
 * blank and claim nothing when the ticket was refused.
 *
 * @param robotId    null to fetch nothing (the view is showing something else).
 * @param cameraName null likewise.
 * @param baseUrl    Where `/robots/...` hangs off; see `cameraStreamUrl`.
 * @param nonce      Change it to re-ticket — a retry, a re-arm. The ticket
 *                   expires, so a view that reconnects needs a fresh one rather
 *                   than the URL it opened with.
 */
export function useCameraStreamUrl(
  robotId: string | null,
  cameraName: string | null,
  baseUrl?: string,
  nonce: number = 0
): CameraStreamUrlState {
  const [state, setState] = useState<CameraStreamUrlState>({ url: null, denied: false });

  useEffect(() => {
    if (!robotId || !cameraName) {
      setState({ url: null, denied: false });
      return;
    }
    // The fetch can outlive the camera it was for — the operator switches
    // source, or robot, mid-request. Without this the panel would end up
    // showing a stream nobody asked for any more.
    let cancelled = false;
    setState({ url: null, denied: false });
    fetchCameraTicket(robotId, cameraName)
      .then(({ ticket }) => {
        if (cancelled) return;
        setState({ url: cameraStreamUrl(robotId, cameraName, ticket, baseUrl), denied: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ url: null, denied: true });
      });
    return () => {
      cancelled = true;
    };
  }, [robotId, cameraName, baseUrl, nonce]);

  return state;
}
