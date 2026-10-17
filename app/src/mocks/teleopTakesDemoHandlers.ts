/**
 * @file teleopTakesDemoHandlers.ts
 * @description MSW handlers for one demo recording session with explicit
 *              takes (TASK-408 routes, TASK-410 UI): live state, start / stop
 *              / next / discard-last, DELETE of a take, the take list, a
 *              thumbnail, and the robot E-stop. State is in memory per page
 *              load; every action is guarded by `expectedTake` exactly as the
 *              server guards it, so a stale press answers 409 with `live`.
 *              Open `#/data-collection/demo-session-takes` in the demo build.
 * @feature datacollection
 */

import { http, HttpResponse } from 'msw';
import type {
  EpisodeActor,
  EpisodeSummary,
  LiveState,
  QuickCheck,
  TeleoperationSession,
} from '@/features/datacollection/types/datacollection.types';

export const DEMO_TAKES_SESSION_ID = 'demo-session-takes';
const ROBOT_ID = 'demo-g1-001';
const FPS = 30;

interface DemoTake {
  take: number;
  startedAtMs: number;
  stoppedAtMs: number | null;
  discarded: boolean;
  startedBy: EpisodeActor;
  stoppedBy: EpisodeActor | null;
  quickCheck: QuickCheck | null;
}

interface DemoState {
  session: TeleoperationSession;
  sessionStartedMs: number;
  takes: DemoTake[];
}

function freshState(): DemoState {
  const now = Date.now();
  return {
    sessionStartedMs: now,
    takes: [],
    session: {
      id: DEMO_TAKES_SESSION_ID,
      operatorId: 'demo-user',
      robotId: ROBOT_ID,
      type: 'keyboard_mouse',
      status: 'recording',
      startedAt: new Date(now).toISOString(),
      endedAt: null,
      frameCount: 0,
      duration: null,
      fps: FPS,
      languageInstr: 'Pick up the red cube and place it in the bin',
      qualityScore: null,
      exportedDatasetId: null,
      errorMessage: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    } as TeleoperationSession,
  };
}

let state = freshState();

/** Test hook: back to a fresh session between unit tests. */
export function resetDemoTakes(): void {
  state = freshState();
}

const framesOf = (t: DemoTake, now = Date.now()) => Math.floor((((t.stoppedAtMs ?? now) - t.startedAtMs) / 1000) * FPS);
const durationOf = (t: DemoTake, now = Date.now()) => ((t.stoppedAtMs ?? now) - t.startedAtMs) / 1000;
const lastTake = () => state.takes[state.takes.length - 1] ?? null;
const capturingTake = () => {
  const t = lastTake();
  return t && t.stoppedAtMs === null ? t : null;
};

function actor(body: Record<string, unknown>): EpisodeActor {
  const source = body.source === 'vr' || body.source === 'hotkey' ? body.source : 'desktop';
  return { userId: 'demo-user', displayName: 'Demo operator', source, clientId: typeof body.clientId === 'string' ? body.clientId : null };
}

function quickCheckOf(t: DemoTake): QuickCheck {
  const durationS = durationOf(t);
  const moved = durationS >= 1;
  return {
    take: t.take,
    frames: framesOf(t),
    durationS: Math.round(durationS * 10) / 10,
    droppedFrames: 0,
    fpsActual: FPS,
    jointsMoved: moved
      ? [
          { name: 'left_shoulder_pitch_joint', rangeRad: 1.12 },
          { name: 'left_elbow_joint', rangeRad: 0.86 },
          { name: 'left_wrist_roll_joint', rangeRad: 0.41 },
          { name: 'left_hand_thumb_0_joint', rangeRad: 0.33 },
          { name: 'waist_yaw_joint', rangeRad: 0.12 },
          { name: 'left_wrist_pitch_joint', rangeRad: 0.08 },
        ]
      : [],
    groupsMoved: moved ? ['left_arm', 'left_hand', 'waist'] : [],
    warnings: [...(durationS < 2 ? ['short'] : []), ...(moved ? [] : ['no_motion'])],
    thumbnailUrl: `/api/teleoperation/sessions/${DEMO_TAKES_SESSION_ID}/episodes/${t.take}/thumbnail`,
    stopReason: 'operator',
    discarded: t.discarded,
  };
}

function buildLive(): LiveState {
  const now = Date.now();
  const live = capturingTake();
  const last = lastTake();
  const kept = state.takes.filter((t) => !t.discarded && t.stoppedAtMs !== null).length;
  const stoppedLast = [...state.takes].reverse().find((t) => t.stoppedAtMs !== null) ?? null;
  return {
    sessionId: DEMO_TAKES_SESSION_ID,
    status: state.session.status,
    phase: state.session.status === 'recording' ? (live ? 'capturing' : 'between') : null,
    take: last ? last.take : null,
    takeStartedAt: live ? new Date(live.startedAtMs).toISOString() : null,
    takeElapsedS: live ? (now - live.startedAtMs) / 1000 : null,
    takeFrames: live ? framesOf(live, now) : 0,
    totalFrames: state.takes.filter((t) => !t.discarded).reduce((n, t) => n + framesOf(t, now), 0),
    kept,
    discarded: state.takes.filter((t) => t.discarded).length,
    fpsTarget: FPS,
    fpsActual: state.session.status === 'recording' ? FPS : null,
    degraded: false,
    lastDropReason: null,
    elapsedS: (now - state.sessionStartedMs) / 1000,
    autoStopS: null,
    lastTake: stoppedLast?.quickCheck ?? null,
    at: new Date(now).toISOString(),
  };
}

function summary(t: DemoTake): EpisodeSummary {
  const durationS = durationOf(t);
  return {
    episodeIndex: t.take,
    frameCount: framesOf(t),
    startTime: (t.startedAtMs - state.sessionStartedMs) / 1000,
    endTime: ((t.stoppedAtMs ?? Date.now()) - state.sessionStartedMs) / 1000,
    durationS,
    droppedFrames: 0,
    fpsActual: FPS,
    retargetModes: ['manual'],
    discarded: t.discarded,
    stopReason: t.stoppedAtMs === null ? null : 'operator',
    takeStartedAt: new Date(t.startedAtMs).toISOString(),
    startedBy: t.startedBy,
    stoppedBy: t.stoppedBy,
    quickCheck: t.quickCheck ? { jointsMoved: t.quickCheck.jointsMoved, groupsMoved: t.quickCheck.groupsMoved, warnings: t.quickCheck.warnings } : null,
  };
}

const conflict = (code: string, error: string) => HttpResponse.json({ code, error, live: buildLive() }, { status: 409 });

/** The server's guard: a stale `expectedTake` is refused with the live state. */
function guard(body: Record<string, unknown>): Response | null {
  if (state.session.status !== 'recording') return conflict('not_recording', 'The session is not recording');
  if (!('expectedTake' in body)) return null;
  const current = lastTake()?.take ?? null;
  return body.expectedTake === current ? null : conflict('episode_conflict', `Expected take ${String(body.expectedTake)}, the session is at ${String(current)}`);
}

function begin(by: EpisodeActor): void {
  const take = state.takes.length; // never reused, even after a discard
  state.takes.push({ take, startedAtMs: Date.now(), stoppedAtMs: null, discarded: false, startedBy: by, stoppedBy: null, quickCheck: null });
}

function end(t: DemoTake, by: EpisodeActor): QuickCheck {
  t.stoppedAtMs = Date.now();
  t.stoppedBy = by;
  t.quickCheck = quickCheckOf(t);
  state.session.frameCount = buildLive().totalFrames;
  return t.quickCheck;
}

const body = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** A 320x240 frame: the G1's view of the bench, drawn rather than shipped. */
function thumbnailSvg(take: number): string {
  const hue = (take * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
<rect width="320" height="240" fill="hsl(210 30% 14%)"/>
<rect x="0" y="150" width="320" height="90" fill="hsl(30 20% 22%)"/>
<rect x="${120 + (take % 3) * 30}" y="120" width="34" height="34" rx="3" fill="hsl(${hue} 70% 50%)"/>
<rect x="210" y="128" width="70" height="40" rx="4" fill="hsl(210 10% 35%)"/>
<path d="M40 240 L110 150 L140 160 L90 240 Z" fill="hsl(210 8% 60%)"/>
<text x="12" y="24" font-family="sans-serif" font-size="14" fill="hsl(0 0% 85%)">Take ${take + 1}</text>
</svg>`;
}

const S = '/api/teleoperation/sessions/:id';
const known = (id: unknown) => id === DEMO_TAKES_SESSION_ID;
const notFound = () => HttpResponse.json({ error: 'Session not found' }, { status: 404 });

export const teleopTakesDemoHandlers = [
  http.get(S, ({ params }) => (known(params.id) ? HttpResponse.json({ session: state.session }) : notFound())),

  http.get(`${S}/live`, ({ params }) => (known(params.id) ? HttpResponse.json(buildLive()) : notFound())),

  http.get(`${S}/episodes`, ({ params, request }) => {
    if (!known(params.id)) return notFound();
    const all = new URL(request.url).searchParams.get('includeDiscarded') === '1';
    return HttpResponse.json({
      sessionId: DEMO_TAKES_SESSION_ID,
      episodes: state.takes.filter((t) => all || !t.discarded).map(summary),
    });
  }),

  http.get(`${S}/episodes/:take/thumbnail`, ({ params }) => {
    const t = state.takes.find((x) => x.take === Number(params.take));
    if (!known(params.id) || !t || t.stoppedAtMs === null) {
      return HttpResponse.json({ code: 'no_thumbnail', error: 'No thumbnail' }, { status: 404 });
    }
    return new HttpResponse(thumbnailSvg(t.take), {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=3600' },
    });
  }),

  http.post(`${S}/episodes/start`, async ({ params, request }) => {
    if (!known(params.id)) return notFound();
    const b = await body(request);
    const refused = guard(b);
    if (refused) return refused;
    if (capturingTake()) return conflict('already_capturing', 'A take is already recording');
    begin(actor(b));
    return HttpResponse.json({ live: buildLive() });
  }),

  http.post(`${S}/episodes/stop`, async ({ params, request }) => {
    if (!known(params.id)) return notFound();
    const b = await body(request);
    const refused = guard(b);
    if (refused) return refused;
    const t = capturingTake();
    if (!t) return conflict('not_capturing', 'No take is recording');
    const quickCheck = end(t, actor(b));
    return HttpResponse.json({ live: buildLive(), quickCheck });
  }),

  http.post(`${S}/episodes/next`, async ({ params, request }) => {
    if (!known(params.id)) return notFound();
    const b = await body(request);
    const refused = guard(b);
    if (refused) return refused;
    const t = capturingTake();
    if (t) end(t, actor(b));
    begin(actor(b));
    return HttpResponse.json({ episodeIndex: lastTake()!.take, live: buildLive() });
  }),

  http.post(`${S}/episodes/discard-last`, async ({ params, request }) => {
    if (!known(params.id)) return notFound();
    const b = await body(request);
    const refused = guard(b);
    if (refused) return refused;
    const t = lastTake();
    if (!t) return conflict('no_take', 'There is no take to discard');
    if (t.discarded) return conflict('already_discarded', 'The last take is already discarded');
    if (t.stoppedAtMs === null) end(t, actor(b));
    t.discarded = true;
    if (t.quickCheck) t.quickCheck.discarded = true;
    return HttpResponse.json({ live: buildLive(), take: t.take });
  }),

  http.delete(`${S}/episodes/:take`, ({ params }) => {
    if (!known(params.id)) return notFound();
    const t = state.takes.find((x) => x.take === Number(params.take));
    if (!t) return HttpResponse.json({ code: 'unknown_take', error: 'Unknown take', live: buildLive() }, { status: 404 });
    if (t.stoppedAtMs === null) {
      t.startedAtMs = Date.now(); // the live take restarts under the same number
      return HttpResponse.json({ episodeIndex: t.take, deletedFrames: 0, frameCount: 0, restarted: true, live: buildLive() });
    }
    const frames = framesOf(t);
    t.discarded = true;
    if (t.quickCheck) t.quickCheck.discarded = true;
    return HttpResponse.json({ episodeIndex: t.take, deletedFrames: frames, frameCount: buildLive().totalFrames, restarted: false, live: buildLive() });
  }),

  http.post(`${S}/end`, ({ params }) => {
    if (!known(params.id)) return notFound();
    const t = capturingTake();
    if (t) end(t, { userId: null, displayName: null, source: 'auto', clientId: null });
    const now = Date.now();
    state.session = {
      ...state.session,
      status: 'completed',
      endedAt: new Date(now).toISOString(),
      duration: Math.round((now - state.sessionStartedMs) / 1000),
      frameCount: buildLive().totalFrames,
      updatedAt: new Date(now).toISOString(),
    };
    return HttpResponse.json({ session: state.session });
  }),

  // The session page's E-STOP. Nothing moves in the demo; the answer is the robot's safety status.
  http.post('/api/safety/robots/:id/estop', ({ params }) =>
    HttpResponse.json({
      message: 'Emergency stop triggered',
      robotId: params.id,
      eStopActive: true,
      timestamp: new Date().toISOString(),
    })
  ),
];
