/**
 * @file datasetVideoApi.ts
 * @description Dataset video tickets and the episode video URL built from one.
 * @feature training
 */

import { apiClient } from '@/api/client';
import type { EpisodeVideoWindow } from '../types';

export interface DatasetVideoTicket {
  /** Opaque, signed by the server. Good for one dataset's videos, for `expiresIn` seconds. */
  ticket: string;
  /** Seconds until the ticket stops working. */
  expiresIn: number;
}

/**
 * Ask for permission to play one dataset's episode videos (TASK-478).
 *
 * A `<video>` cannot send an `Authorization` header — not on its first request
 * and not on the Range requests it makes while seeking — so with sign-in on the
 * credential has to ride in the URL. This is that credential: scoped to one
 * dataset's video GETs, valid for about fifteen minutes and useless for
 * anything else. The access token itself never goes into a URL.
 *
 * Goes through `apiClient`, so it inherits bearer auth, tenant impersonation
 * and the 401-refresh-and-retry every other call in the app gets.
 */
export async function fetchDatasetVideoTicket(datasetId: string): Promise<DatasetVideoTicket> {
  const response = await apiClient.post<DatasetVideoTicket>(
    `/datasets/${encodeURIComponent(datasetId)}/video-ticket`
  );
  return response.data;
}

interface CachedTicket {
  promise: Promise<string>;
  /** Epoch ms after which a new ticket is fetched rather than this one reused. */
  staleAt: number;
}

const cache = new Map<string, CachedTicket>();

/**
 * A ticket for this dataset's videos, shared by everything on the page that
 * plays one. A ticket is reused for the first half of its life, so the URL —
 * and with it the video a viewer is watching — stays the same while they step
 * through episodes, and a URL handed out now still has minutes left on it.
 *
 * @param fresh Skip the cache: the ticket in hand was refused or has expired.
 */
export function getDatasetVideoTicket(
  datasetId: string,
  { fresh = false, now = Date.now() }: { fresh?: boolean; now?: number } = {}
): Promise<string> {
  const cached = cache.get(datasetId);
  if (cached && !fresh && now < cached.staleAt) return cached.promise;

  const entry: CachedTicket = {
    // Until the answer says how long the ticket lasts, concurrent callers share
    // the one request in flight.
    staleAt: Number.POSITIVE_INFINITY,
    promise: fetchDatasetVideoTicket(datasetId).then(
      ({ ticket, expiresIn }) => {
        entry.staleAt = Date.now() + (Math.max(0, expiresIn) * 1000) / 2;
        return ticket;
      },
      (error: unknown) => {
        // A refusal is not remembered: the next caller asks again.
        if (cache.get(datasetId) === entry) cache.delete(datasetId);
        throw error;
      }
    ),
  };
  cache.set(datasetId, entry);
  return entry.promise;
}

/** Forget every cached ticket. For tests, and for sign-out. */
export function clearDatasetVideoTickets(): void {
  cache.clear();
}

/**
 * The video URL for one camera of one episode.
 *
 * For v3.0 chunked datasets pass the episode's `videoWindows[camera]`: the
 * chunk/file query selects the right concatenated mp4 server-side and the
 * `#t=from,to` media fragment makes the browser play only this episode's
 * slice of it.
 *
 * @param ticket From {@link getDatasetVideoTicket}. Without one the URL is the
 *        bare route, which only a server with sign-in off will answer.
 */
export function episodeVideoUrl(
  baseUrl: string,
  datasetId: string,
  episodeIndex: number,
  camera: string,
  window?: EpisodeVideoWindow,
  ticket?: string | null
): string {
  const path = `${baseUrl}/datasets/${datasetId}/episodes/${episodeIndex}/video/${camera}`;
  const query: string[] = [];
  if (window) query.push(`chunk=${window.chunk}`, `file=${window.file}`);
  if (ticket) query.push(`ticket=${encodeURIComponent(ticket)}`);
  const fragment = window ? `#t=${window.from},${window.to}` : '';
  return `${path}${query.length ? `?${query.join('&')}` : ''}${fragment}`;
}
