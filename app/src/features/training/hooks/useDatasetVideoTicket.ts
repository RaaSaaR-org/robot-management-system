/**
 * @file useDatasetVideoTicket.ts
 * @description The ticket a `<video>` plays one dataset's episodes with.
 * @feature training
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatasetVideoTicket } from '../api/datasetVideoApi';

export interface DatasetVideoTicketState {
  /** The ticket to put in the video URL, or null when there is none. */
  ticket: string | null;
  /**
   * False only while the first ticket for this dataset is on its way. A player
   * waits for it: a `<video>` mounted with a ticketless URL would spend its one
   * request on a 401.
   */
  ready: boolean;
  /** Ask for a new ticket — the one in hand was refused or has expired. */
  refresh: () => void;
}

interface Held {
  datasetId: string;
  ticket: string | null;
}

/**
 * Fetch (or reuse) a video ticket for one dataset (TASK-478).
 *
 * A failed ticket request is not an error state here: `ready` turns true with
 * no ticket and the caller builds the bare URL, which is exactly right for a
 * server running with sign-in off. If the server does want a credential, the
 * video itself fails and the player says so.
 *
 * @param datasetId  null/undefined to fetch nothing.
 * @param refreshKey Change it at a natural reload point — the selected episode.
 *        The ticket is re-checked then and replaced once it is half spent, so
 *        the URL only ever changes when the video was about to change anyway.
 */
export function useDatasetVideoTicket(
  datasetId: string | null | undefined,
  refreshKey?: unknown
): DatasetVideoTicketState {
  const [held, setHeld] = useState<Held | null>(null);
  const [nonce, setNonce] = useState(0);
  const lastNonce = useRef(0);

  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    const fresh = nonce !== lastNonce.current;
    lastNonce.current = nonce;
    getDatasetVideoTicket(datasetId, { fresh })
      .then((ticket) => {
        if (!cancelled) setHeld({ datasetId, ticket });
      })
      .catch(() => {
        if (cancelled) return;
        // Keep a ticket already in hand for this dataset: it may still work,
        // and no ticket certainly does not.
        setHeld((prev) => (prev?.datasetId === datasetId ? prev : { datasetId, ticket: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, refreshKey, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // A ticket for another dataset is not this one's: never show it.
  const current = held && held.datasetId === datasetId ? held : null;
  return { ticket: current?.ticket ?? null, ready: current !== null, refresh };
}
