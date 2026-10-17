/**
 * @file LiveSessionRedirect.tsx
 * @description `/data-collection/live?robot=<id>` (TASK-412): the stable URL
 *              the Quest browser opens. It lands on the robot's newest live
 *              session (status `created`, `recording` or `paused`) and replaces
 *              itself in history; with none it says so and looks again every
 *              2 s, so the headset can be opened before the desktop creates
 *              the session (D2).
 * @feature datacollection
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Glasses } from 'lucide-react';
import { Spinner } from '@/shared/components/ui/Spinner';
import { datacollectionApi } from '../api/datacollectionApi';
import type { TeleoperationSession, TeleoperationStatus } from '../types/datacollection.types';

export const LIVE_SESSION_POLL_MS = 2_000;
/** A session in one of these is the one the headset belongs on. */
export const LIVE_SESSION_STATUSES: TeleoperationStatus[] = ['created', 'recording', 'paused'];

/** The newest live session, or null. Pure. */
export function newestLiveSession(sessions: TeleoperationSession[], robotId: string): TeleoperationSession | null {
  let best: TeleoperationSession | null = null;
  for (const s of sessions) {
    if (s.robotId !== robotId || !LIVE_SESSION_STATUSES.includes(s.status)) continue;
    if (!best || Date.parse(s.createdAt) > Date.parse(best.createdAt)) best = s;
  }
  return best;
}

export interface LiveSessionRedirectProps {
  pollMs?: number;
  api?: Pick<typeof datacollectionApi, 'listSessions'>;
}

export function LiveSessionRedirect({ pollMs = LIVE_SESSION_POLL_MS, api = datacollectionApi }: LiveSessionRedirectProps) {
  const [params] = useSearchParams();
  const robotId = (params.get('robot') ?? '').trim();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (!robotId) return undefined;
    done.current = false;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      try {
        const res = await api.listSessions({ robotId, status: LIVE_SESSION_STATUSES, limit: 20 });
        if (cancelled) return;
        setError(null);
        const live = newestLiveSession(res.sessions ?? [], robotId);
        if (live) {
          done.current = true;
          navigate(`/data-collection/${live.id}`, { replace: true });
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
      setChecks((n) => n + 1);
      if (!cancelled && !done.current) timer = setTimeout(() => void check(), pollMs);
    };
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, navigate, pollMs, robotId]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6" data-testid="live-session-redirect">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <Glasses className="h-8 w-8 text-ink-tertiary" strokeWidth={1.5} />
        {!robotId ? (
          <p className="text-[15px] text-ink-primary" data-testid="live-session-status" data-state="no-robot">
            No robot named. Open this page as /data-collection/live?robot=&lt;robot id&gt;.
          </p>
        ) : (
          <>
            <p className="text-[15px] font-medium text-ink-primary" data-testid="live-session-status" data-state="waiting">
              {checks === 0 ? `Looking for ${robotId}'s live session…` : `No live session for ${robotId}. Waiting…`}
            </p>
            <p className="text-[13px] text-ink-secondary">
              Create or start a data-collection session for this robot on the desktop; this page opens it on its own.
            </p>
            <Spinner size="sm" label="Waiting for a live session" />
            {error && (
              <p className="text-[12px] text-signal-stopped" role="alert" data-testid="live-session-error">
                Could not read the sessions: {error}. Trying again…
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
