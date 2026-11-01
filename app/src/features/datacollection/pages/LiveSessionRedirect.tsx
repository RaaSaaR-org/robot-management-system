/**
 * @file LiveSessionRedirect.tsx
 * @description `/data-collection/live?robot=<id>` (TASK-412, TASK-416, TASK-452):
 *              the stable URL the Quest browser opens. A session is a candidate
 *              when it is `recording` or `paused` and was last active less than
 *              `LIVE_ACTIVE_MAX_IDLE_MS` ago, or `created` less than
 *              `LIVE_CREATED_MAX_AGE_MS` ago. Exactly one candidate → the page
 *              replaces itself with it. More than one → it lists them and lets
 *              the operator pick, never guessing (D1). None → it waits, looks
 *              again every 2 s and names any stale session it is ignoring, so
 *              the headset can be opened before the desktop creates the session.
 * @feature datacollection
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Glasses } from 'lucide-react';
import { Spinner } from '@/shared/components/ui/Spinner';
import { datacollectionApi } from '../api/datacollectionApi';
import { formatDateTime } from '@/shared/utils/format';
import { sessionName } from '../utils/sessionFormat';
import type { TeleoperationSession, TeleoperationStatus } from '../types/datacollection.types';

export const LIVE_SESSION_POLL_MS = 2_000;
/** Statuses the page asks the server for; `created` is then age-filtered, the others idle-filtered. */
export const LIVE_SESSION_STATUSES: TeleoperationStatus[] = ['created', 'recording', 'paused'];
/** A READY session nobody started for this long is not the one the desktop means (D2). */
export const LIVE_CREATED_MAX_AGE_MS = 4 * 60 * 60 * 1000;
/** A recording or paused session idle this long was left behind, not the one in use (TASK-452). */
export const LIVE_ACTIVE_MAX_IDLE_MS = 12 * 60 * 60 * 1000;

export interface LiveCandidates {
  /** Sessions the headset may belong on, newest first. */
  candidates: TeleoperationSession[];
  /** Sessions of this robot too old (`created`) or too long idle to count, newest first. */
  ignored: TeleoperationSession[];
}

function createdMs(s: TeleoperationSession): number {
  const t = Date.parse(s.createdAt);
  return Number.isFinite(t) ? t : 0;
}

/**
 * When the session last changed. `updatedAt` is the server's `@updatedAt`, bumped by
 * every write to the row (start, pause, resume, each saved take's frame count), so it
 * is the last activity; `startedAt` and `createdAt` only stand in when it is unreadable.
 */
function lastActiveAt(s: TeleoperationSession): string {
  for (const at of [s.updatedAt, s.startedAt]) if (at && Number.isFinite(Date.parse(at))) return at;
  return s.createdAt;
}

/** Split a robot's sessions into live candidates and stale or idle ones. Pure. */
export function liveCandidates(sessions: TeleoperationSession[], robotId: string, nowMs: number): LiveCandidates {
  const candidates: TeleoperationSession[] = [];
  const ignored: TeleoperationSession[] = [];
  for (const s of sessions) {
    if (s.robotId !== robotId) continue;
    if (s.status === 'recording' || s.status === 'paused') {
      const t = Date.parse(lastActiveAt(s));
      if (nowMs - (Number.isFinite(t) ? t : 0) < LIVE_ACTIVE_MAX_IDLE_MS) candidates.push(s);
      else ignored.push(s);
    } else if (s.status === 'created') {
      if (nowMs - createdMs(s) < LIVE_CREATED_MAX_AGE_MS) candidates.push(s);
      else ignored.push(s);
    }
  }
  const newestFirst = (a: TeleoperationSession, b: TeleoperationSession) => createdMs(b) - createdMs(a);
  candidates.sort(newestFirst);
  ignored.sort(newestFirst);
  return { candidates, ignored };
}

/**
 * "created 12 min ago" / "created 2 days ago", spelled out: this page is read
 * in the headset, where "2d" is one more thing to decode. A week or more is a date.
 */
function spelledAgo(verb: string, iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return `${verb} at an unknown time`;
  const min = Math.floor(Math.max(0, nowMs - ms) / 60_000);
  if (min < 1) return `${verb} just now`;
  if (min < 60) return `${verb} ${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${verb} ${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${verb} ${day} day${day === 1 ? '' : 's'} ago`;
  return `${verb} ${formatDateTime(iso, { year: 'numeric', month: 'short', day: 'numeric' })}`;
}

export function createdAgo(s: TeleoperationSession, nowMs: number = Date.now()): string {
  return spelledAgo('created', s.createdAt, nowMs);
}

/** Why an ignored session does not count: "created 2 days ago, never started" / "paused, last active 2 days ago". */
export function ignoredReason(s: TeleoperationSession, nowMs: number = Date.now()): string {
  if (s.status === 'created') return `${createdAgo(s, nowMs)}, never started`;
  return `${s.status}, ${spelledAgo('last active', lastActiveAt(s), nowMs)}`;
}

const STATUS_WORD: Partial<Record<TeleoperationStatus, string>> = {
  created: 'Ready',
  recording: 'Recording',
  paused: 'Paused',
};

export interface LiveSessionRedirectProps {
  pollMs?: number;
  api?: Pick<typeof datacollectionApi, 'listSessions'>;
  /** Clock for the age and idle filters; tests pin it. */
  now?: () => number;
}

export function LiveSessionRedirect({
  pollMs = LIVE_SESSION_POLL_MS,
  api = datacollectionApi,
  now = Date.now,
}: LiveSessionRedirectProps) {
  const [params] = useSearchParams();
  const robotId = (params.get('robot') ?? '').trim();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);
  const [found, setFound] = useState<LiveCandidates>({ candidates: [], ignored: [] });
  const done = useRef(false);
  const nowRef = useRef(now);
  nowRef.current = now;

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
        const next = liveCandidates(res.sessions ?? [], robotId, nowRef.current());
        if (next.candidates.length === 1) {
          done.current = true;
          navigate(`/data-collection/${next.candidates[0].id}`, { replace: true });
          return;
        }
        setFound(next);
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

  const choosing = found.candidates.length > 1;
  const stale = found.ignored[0];

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6" data-testid="live-session-redirect">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <Glasses className="h-8 w-8 text-ink-tertiary" strokeWidth={1.5} />
        {!robotId ? (
          <p className="text-[15px] text-ink-primary" data-testid="live-session-status" data-state="no-robot">
            No robot named. Open this page as /data-collection/live?robot=&lt;robot id&gt;.
          </p>
        ) : choosing ? (
          <>
            <p className="text-[15px] font-medium text-ink-primary" data-testid="live-session-status" data-state="choose">
              {found.candidates.length} live sessions for {robotId}. Which one is yours?
            </p>
            <p className="text-[13px] text-ink-secondary">
              Pick the session the desktop has open. This list keeps updating.
            </p>
            <ul className="flex w-full flex-col gap-2" data-testid="live-session-choices">
              {found.candidates.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      done.current = true;
                      navigate(`/data-collection/${s.id}`, { replace: true });
                    }}
                    className="flex w-full min-h-[48px] items-center justify-between gap-3 rounded-control border border-line bg-panel px-4 py-3 text-left hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    data-testid="live-session-choice"
                    data-session-id={s.id}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium text-ink-primary">{sessionName(s)}</span>
                      <span className="block text-[12px] text-ink-secondary">{createdAgo(s)}</span>
                    </span>
                    <span className="shrink-0 text-[12px] font-medium text-ink-secondary">{STATUS_WORD[s.status] ?? s.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="text-[15px] font-medium text-ink-primary" data-testid="live-session-status" data-state="waiting">
              {checks === 0 ? `Looking for ${robotId}'s live session…` : `No live session for ${robotId}. Waiting…`}
            </p>
            <p className="text-[13px] text-ink-secondary">
              Create or start a data-collection session for this robot on the desktop; this page opens it on its own.
            </p>
            {stale && (
              <p className="text-[13px] text-ink-secondary" data-testid="live-session-ignored">
                Ignoring &lsquo;{sessionName(stale)}&rsquo; ({ignoredReason(stale)}).
                {found.ignored.length > 1 ? ` ${found.ignored.length - 1} older one${found.ignored.length > 2 ? 's' : ''} too.` : ''}{' '}
                End it on the desktop if it is not needed.
              </p>
            )}
            <Spinner size="sm" label="Waiting for a live session" />
          </>
        )}
        {robotId && error && (
          <p className="text-[12px] text-signal-stopped" role="alert" data-testid="live-session-error">
            Could not read the sessions: {error}. Trying again…
          </p>
        )}
      </div>
    </div>
  );
}
