/**
 * @file SessionDetailPage.tsx
 * @description Session detail and recording cockpit: status-driven acts
 *              (start, end through confirm), live HUD, robot viewer, cameras,
 *              takes, and the completed-session review. TASK-410: a started
 *              session is Ready; takes start and stop explicitly (button,
 *              Space, or the headset), every client shows the same take and
 *              timer from the server's live state, a quick check follows each
 *              take, and the robot's E-STOP is always in the header (Escape
 *              twice). Pause stays only for recorders without explicit takes.
 *              Under the control lease the page holds one lease that its
 *              gamepad and simulated-VR inputs join (TASK-320). A created
 *              session shows a pre-flight checklist; a blocking item (robot
 *              offline) disables Start session and its hotkey (TASK-392).
 *              TASK-414: the desktop is the assistant's view of a two-person
 *              session — the twin at the fast-channel rate with the operator's
 *              ghost hands, the head camera, the HUD, an Operator card and the
 *              takes; presence and the read-only lease holder in the header.
 *              While this page's own VR modal is open (the Quest) the viewer
 *              and camera tiles unmount and the page stops declaring itself
 *              the assistant.
 *              TASK-426: one sticky command bar replaces the page header —
 *              every normal action on its left, the E-STOP alone in its own
 *              zone on the right (a bottom dock on a phone) — and the page
 *              renders one layout per phase (Set up, Record, Wrap up). The
 *              developer tools sit behind one Testing tools popover; on the
 *              headset the page leads with Launch VR.
 *              TASK-427: Set up is the "Get ready" rail — the steps in bring-up
 *              order, the current one open with the page's one lit action, each
 *              problem stated once in the step it belongs to — next to a
 *              preview of the twin with the head camera as a picture-in-picture.
 * @feature datacollection
 */

import { useState, Suspense, lazy, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';
import { Glasses, Pause, Play, Plus } from 'lucide-react';
import {
  Button, EmptyState, ErrorState, FormField, FormModal, Input, LinkButton, Panel,
  Skeleton, SkeletonText, Switch, Textarea, confirm, errorMessage, toast,
} from '@/shared/components/ui';
import { QualityIndicator } from '../components/QualityIndicator';
import { CameraStreamView } from '../components/CameraStreamView';
import { EpisodePanel } from '../components/EpisodePanel';
import { VRSessionPanel } from '../components/VRSessionPanel';
import { SessionHud, type HudPhase } from '../components/session/SessionHud';
import { SessionCompleted } from '../components/session/SessionCompleted';
import { QuickCheckCard } from '../components/session/QuickCheckCard';
import { SessionEStopButton } from '../components/session/SessionEStopButton';
import { OperatorCard } from '../components/OperatorCard';
import { OperatorOverlay, OVERLAY_LINK } from '../components/OperatorOverlay';
import { SessionCommandBar, SessionCommandBarSkeleton, type RobotLink } from '../components/console/SessionCommandBar';
import { TestingToolsRow } from '../components/console/TestingTools';
import { HeadsetHero, RobotSetupDisclosure } from '../components/console/HeadsetHero';
import { SetupRail, type SetupStepContent } from '../components/console/SetupRail';
import { LiveView } from '../components/console/LiveView';
import { buildSetupModel, leaseWorkDone, type SetupStep } from '../utils/setupSteps';
import { useLeaseHandOver, useLeaseTake } from '../hooks/useLeaseTake';
import { PageLeaseLine } from '../components/console/PageLeaseLine';
import { useDeviceRole, detectDeviceRole, type DeviceRole } from '../hooks/useDeviceRole';
import { commandBarTally, sessionPhase } from '../utils/sessionPhase';
import { EMULATOR_ACTIVE } from '../../robots/components/tabs/vr/vrConstants';
import { ReadinessActions, RobotReadinessPanel } from '../../robots/components/readiness/RobotReadinessPanel';
import { QuestControls } from '../../robots/components/readiness/QuestControls';
import { QuestConnectHelp } from '../../robots/components/tabs/vr/QuestConnectHelp';
import { useRobotReadiness } from '../../robots/hooks/useRobotReadiness';
import { questPagePort } from '../../robots/api/readinessApi';
import { useSessionPresence } from '../hooks/useSessionPresence';
import { useFreshOperator } from '../hooks/useFreshOperator';
import { useOperatorCues } from '../hooks/useOperatorCues';
import { sessionSummary } from '../utils/takeStreak';
import { isDialogOpen, isTypingTarget } from '../utils/hotkeys';
import { isCueMuted, scheduleAutoStopWarning, setCueMuted, subscribeCueMuted } from '@/shared/utils/sessionCues';
import { useSessionDetail } from '../hooks/datacollection';
import { useTeleopEvents } from '../hooks/useTeleopEvents';
import {
  useDataCollectionStore, selectKept, selectTakeElapsedS, selectOperatorFor, selectStreakFor, selectViewersFor,
} from '../store/datacollectionStore';
import { useRobotsStore } from '../../robots/store/robotsStore';
import { useTelemetryStream } from '../../robots/hooks/useTelemetryStream';
import { JointStateGrid } from '../../robots/components/visualization';
import { KeyboardTeleopSection } from '../../robots/components/tabs/TeleopTab';
import { useGamepadJoints } from '../hooks/useGamepadJoints';
import { useSessionControlLease } from '../hooks/useSessionControlLease';
import { useInputPresence } from '../hooks/useInputPresence';
import { useRobotCameras } from '../../robots/hooks/useRobotCameras';
import { buildPreflight, summarizePreflight } from '../utils/preflight';
import { ControlLeaseBar } from '../../robots/components/tabs/ControlLeaseBar';
import { RobotModeControl } from '../../robots/components/RobotModeControl';
import { useRobotBaseMode } from '../../robots/hooks/useRobotBaseMode';
import { jointPositionUnit } from '../../robots/types/robots.types';
import type { RobotType } from '../../robots/types/robots.types';
import { TELEOPERATION_TYPE_LABELS, formatDuration, canStartSession, canPauseSession, canEndSession } from '../types/datacollection.types';
import { sessionName } from '../utils/sessionFormat';
import { takeLabel } from '../utils/takeFormat';

const Robot3DViewer = lazy(() =>
  import('../../robots/components/visualization/Robot3DViewer').then((m) => ({ default: m.Robot3DViewer }))
);

/** `head_camera` → "Head camera". */
const cameraLabel = (name: string) => {
  const words = name.replace(/[_-]+/g, ' ').trim();
  const text = /camera$/i.test(words) ? words : `${words} camera`;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

const formatElapsed = (secs: number) => `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
/** TASK-418 (D4): how long the headset stays in VR after the session ended — enough to read "ended". */
export const VR_GOODBYE_MS = 5_000;

/** TASK-418 (D4): the session went from live to ended while this page's VR modal was open. */
export function endsUnderVr(prevStatus: string | undefined, status: string | undefined, vrModalOpen: boolean): boolean {
  const wasLive = prevStatus === 'created' || prevStatus === 'recording' || prevStatus === 'paused';
  const ended = status === 'completed' || status === 'failed';
  return vrModalOpen && wasLive && ended;
}

export function SessionDetailPage() {
  const { sessionId: id } = useParams<{ sessionId: string }>();
  const { session, isLoading, error, annotateSession, exportSession, fetchSession } = useSessionDetail(id!);
  const qualityFeedback = useDataCollectionStore((s) => s.qualityFeedback);
  const episodes = useDataCollectionStore((s) => s.episodes);
  const recordingProgress = useDataCollectionStore((s) => s.recordingProgress);
  const storeStart = useDataCollectionStore((s) => s.startSession);
  const storePause = useDataCollectionStore((s) => s.pauseSession);
  const storeResume = useDataCollectionStore((s) => s.resumeSession);
  const storeEnd = useDataCollectionStore((s) => s.endSession);
  const storeFetchEpisodes = useDataCollectionStore((s) => s.fetchEpisodes);
  const storeNextEpisode = useDataCollectionStore((s) => s.nextEpisode);
  const storeDiscardEpisode = useDataCollectionStore((s) => s.discardEpisode);
  // TASK-410: explicit takes against the one live state.
  const live = useDataCollectionStore((s) => (s.live && s.live.sessionId === id ? s.live : null));
  const clockOffsetMs = useDataCollectionStore((s) => s.liveClockOffsetMs);
  const lastQuickCheck = useDataCollectionStore((s) => s.lastQuickCheck);
  const takePending = useDataCollectionStore((s) => s.takePending);
  const kept = useDataCollectionStore(selectKept);
  const storeFetchLive = useDataCollectionStore((s) => s.fetchLive);
  const storeStartTake = useDataCollectionStore((s) => s.startTake);
  const storeStopTake = useDataCollectionStore((s) => s.stopTake);
  const storeNextTake = useDataCollectionStore((s) => s.nextTake);
  const storeDiscardLast = useDataCollectionStore((s) => s.discardLastTake);
  const storeDiscardTake = useDataCollectionStore((s) => s.discardTake);
  const dismissQuickCheck = useDataCollectionStore((s) => s.dismissQuickCheck);
  const muted = useSyncExternalStore(subscribeCueMuted, isCueMuted, isCueMuted);
  // TASK-414: who watches, the operator's relayed state, and the take streak.
  const viewers = useDataCollectionStore(useMemo(() => selectViewersFor(id), [id]));
  const streak = useDataCollectionStore(useMemo(() => selectStreakFor(id), [id]));
  const operator = useFreshOperator(id);
  /** The page's own VR modal is open — on the Quest, the wearer's page. */
  const [vrModalOpen, setVrModalOpen] = useState(false);
  /**
   * TASK-418 (D4): the session ended while the VR modal was open. The modal
   * and the immersive session stay up for `VR_GOODBYE_MS` so the board can say
   * ENDED and the camera strip "take the headset off" — then VR closes as before.
   */
  const [vrGoodbye, setVrGoodbye] = useState(false);

  // Live progress via the app WebSocket; REST polling backs it up while it is down.
  const { isConnected: isWsConnected } = useTeleopEvents();

  const robots = useRobotsStore((s) => s.robots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);
  const robot = robots.find((r) => r.id === session?.robotId) ?? null;
  useEffect(() => { if (robots.length === 0) fetchRobots(); }, [robots.length, fetchRobots]);

  const robotOnline = !!robot && robot.status !== 'offline';
  const { telemetry, isConnected: isTelemetryConnected } = useTelemetryStream(session?.robotId ?? '', {
    autoConnect: !!session && robotOnline && ['recording', 'paused', 'created'].includes(session.status),
  });

  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [annotationText, setAnnotationText] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportName, setExportName] = useState('');
  const [modalError, setModalError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<'start' | 'pause' | 'end' | null>(null);
  const [showJoints, setShowJoints] = useState(false);
  const [showKeyboardFallback, setShowKeyboardFallback] = useState(false);
  // TASK-426: which side of the session this browser is; Testing tools can
  // force the headset view on a desktop ("Show the headset view here").
  const [roleOverride, setRoleOverride] = useState<DeviceRole | null>(null);
  const deviceRole = useDeviceRole(roleOverride);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live elapsed timer during recording
  useEffect(() => {
    if (session?.status === 'recording' && session.startedAt) {
      const startTime = new Date(session.startedAt).getTime();
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      timerRef.current = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000)), 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsedSeconds(0);
  }, [session?.status, session?.startedAt]);

  // Episode summaries and the live state: fetched on load. While recording the
  // WebSocket carries every change, so the poll is a 10 s safety net; with the
  // socket down it is the only source and runs every 3 s.
  const sessionStatus = session?.status;
  const sessionLoaded = !!session;
  useEffect(() => {
    if (!id || !sessionLoaded) return;
    storeFetchEpisodes(id);
    storeFetchLive(id);
    if (sessionStatus === 'recording' || sessionStatus === 'paused') {
      const timer = setInterval(() => {
        storeFetchEpisodes(id);
        storeFetchLive(id);
      }, isWsConnected ? 10_000 : 3_000);
      return () => clearInterval(timer);
    }
  }, [id, sessionLoaded, sessionStatus, isWsConnected, storeFetchEpisodes, storeFetchLive]);

  // A quick check belongs to the session it was taken in.
  useEffect(() => { dismissQuickCheck(); }, [id, dismissQuickCheck]);

  // TASK-418: the session just ended under an open VR modal — the goodbye.
  // Decided DURING render (React's "adjust state on a prop change" pattern),
  // not in an effect: an effect runs after the commit that already unmounted
  // the VR panel, and the immersive session dies with it.
  const [seenStatus, setSeenStatus] = useState<{ id: string | undefined; status: string | undefined }>({ id, status: sessionStatus });
  if (seenStatus.id !== id || seenStatus.status !== sessionStatus) {
    setSeenStatus({ id, status: sessionStatus });
    if (seenStatus.id !== id) setVrGoodbye(false);
    else if (endsUnderVr(seenStatus.status, sessionStatus, vrModalOpen)) setVrGoodbye(true);
  }
  useEffect(() => {
    if (!vrGoodbye) return;
    const timer = setTimeout(() => setVrGoodbye(false), VR_GOODBYE_MS);
    return () => clearTimeout(timer);
  }, [vrGoodbye]);

  // Fallback polling while the WebSocket is down.
  useEffect(() => {
    if (!id || isWsConnected || sessionStatus !== 'recording') return;
    const timer = setInterval(() => fetchSession(), 2500);
    return () => clearInterval(timer);
  }, [id, isWsConnected, sessionStatus, fetchSession]);

  // The take timer ticks on the server's clock (D5): 4 Hz while a take runs.
  const capturing = sessionStatus === 'recording' && live?.phase === 'capturing';
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (sessionStatus !== 'recording') return;
    const timer = setInterval(() => setNowMs(Date.now()), capturing ? 250 : 1000);
    return () => clearInterval(timer);
  }, [sessionStatus, capturing]);
  const serverNowMs = nowMs + clockOffsetMs;
  const takeElapsedS = live ? selectTakeElapsedS(serverNowMs)({ live }) : null;
  const autoStopInS = capturing && live?.autoStopS && takeElapsedS !== null ? live.autoStopS - takeElapsedS : null;

  // The auto-stop warning tick, 3 s before the robot stops the take itself.
  const autoStopS = live?.autoStopS ?? null;
  const liveTakeStartedAt = capturing ? live?.takeStartedAt ?? null : null;
  useEffect(() => {
    if (!autoStopS || !liveTakeStartedAt) return;
    const started = Date.parse(liveTakeStartedAt);
    if (!Number.isFinite(started)) return;
    const elapsed = (Date.now() + clockOffsetMs - started) / 1000;
    return scheduleAutoStopWarning(autoStopS - elapsed);
    // Re-arm per take only; the offset moves by milliseconds between events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStopS, liveTakeStartedAt]);

  /** True when the recorder takes explicit start/stop (agent and sim sessions). */
  const takeMode = !!live && live.phase !== null;

  const handleStartTake = useCallback((source: 'desktop' | 'hotkey' | 'vr' = 'desktop') =>
    (session ? storeStartTake(session.id, source) : Promise.resolve(false)), [session, storeStartTake]);
  const handleStopTake = useCallback((source: 'desktop' | 'hotkey' | 'vr' = 'desktop') =>
    (session ? storeStopTake(session.id, source) : Promise.resolve(false)), [session, storeStopTake]);
  const handleNextTake = useCallback((source: 'desktop' | 'hotkey' | 'vr' = 'desktop') =>
    (session ? storeNextTake(session.id, source) : Promise.resolve(false)), [session, storeNextTake]);
  const handleDiscardLast = useCallback((expectedTake: number) =>
    (session ? storeDiscardLast(session.id, 'desktop', expectedTake) : Promise.resolve(false)), [session, storeDiscardLast]);
  const handleDiscardTake = useCallback((take: number) =>
    (session ? storeDiscardTake(session.id, take, 'desktop') : Promise.resolve(false)), [session, storeDiscardTake]);

  /**
   * The legacy N hotkey and the episode panel's Next. Returns whether the
   * boundary was actually drawn. Between takes it starts one; while recording
   * it moves to the next. Recorders without explicit takes keep the old
   * boundary. (The headset has its own path since TASK-413: `VRSessionPanel`.)
   */
  const handleNextEpisode = useCallback(async (): Promise<boolean> => {
    if (!session || session.status !== 'recording') return false;
    if (takeMode) {
      return live?.phase === 'capturing' ? storeNextTake(session.id, 'desktop') : storeStartTake(session.id, 'desktop');
    }
    try { await storeNextEpisode(session.id); return true; } catch { return false; }
  }, [session, takeMode, live?.phase, storeNextEpisode, storeNextTake, storeStartTake]);

  /** A recorder without explicit takes discards through the old route. */
  const handleDiscardEpisode = useCallback(async (episodeIndex: number) => {
    if (!session) return;
    try {
      await storeDiscardEpisode(session.id, episodeIndex);
      await fetchSession();
      toast.success(`You discarded ${takeLabel(episodeIndex).toLowerCase()}`);
    } catch (err) {
      toast.error("Couldn't discard the take", { description: errorMessage(err) });
    }
  }, [session, storeDiscardEpisode, fetchSession]);

  const robotName = robot?.name ?? session?.robotId ?? 'the robot';

  /** TASK-418: the completed view's refetch while the frame count settles. */
  const refetchCompleted = useCallback(async () => {
    if (!id) return;
    await Promise.all([fetchSession(), storeFetchEpisodes(id)]);
  }, [id, fetchSession, storeFetchEpisodes]);

  const run = async (kind: 'start' | 'pause' | 'end', act: () => Promise<unknown>, ok: string, fail: string, okDescription?: () => string) => {
    setPending(kind);
    try { await act(); toast.success(ok, okDescription ? { description: okDescription() } : undefined); } catch (err) { toast.error(fail, { description: errorMessage(err) }); } finally { setPending(null); }
  };
  /** What the End toast sums up (TASK-414), as of the last render. */
  const summaryRef = useRef({ kept: 0, elapsedS: 0, best: 0 });

  const handleStart = async () => {
    if (!session) return;
    if (session.status === 'paused') {
      return run('start', () => storeResume(session.id), 'Recording resumed', "Couldn't resume recording");
    }
    const ok = await confirm({
      title: `Start the session on ${robotName}?`,
      description: "The robot follows the operator's input. Nothing is recorded until a take starts.",
      confirmLabel: 'Start session',
    });
    if (ok) await run('start', () => storeStart(session.id), 'Session started — ready for take 1', "Couldn't start the session");
  };

  const handlePause = () => session && run('pause', () => storePause(session.id), 'Session paused', "Couldn't pause session");

  const handleEnd = async () => {
    if (!session) return;
    const ok = await confirm({
      title: 'End this session?',
      description: 'Recording stops and the kept takes are saved. You can review them afterwards.',
      confirmLabel: 'End session',
      tone: 'danger',
    });
    if (ok) {
      const { kept: keptNow, elapsedS, best } = summaryRef.current;
      await run('end', () => storeEnd(session.id), 'Session ended', "Couldn't end session", () => sessionSummary(keptNow, elapsedS, best));
    }
  };

  // Session shortcuts: Space starts a created session (or resumes a paused
  // one), E ends it (through the confirm). While recording with explicit
  // takes, Space / N / Backspace belong to the take panel. Recorders without
  // explicit takes keep TASK-117's Space = pause and N = next episode.
  // Ignored inside text fields and while any dialog is open.
  const takeModeRef = useRef(false);
  takeModeRef.current = takeMode;
  useEffect(() => {
    if (!session) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;
      if (isDialogOpen()) return;
      const legacy = session.status === 'recording' && !takeModeRef.current;
      if (ev.code === 'Space') {
        if (canStartSession(session) && !startBlockedRef.current) { ev.preventDefault(); void handleStart(); }
        else if (legacy && canPauseSession(session)) { ev.preventDefault(); void handlePause(); }
      } else if ((ev.key === 'e' || ev.key === 'E') && canEndSession(session)) {
        ev.preventDefault(); void handleEnd();
      } else if ((ev.key === 'n' || ev.key === 'N') && legacy) {
        ev.preventDefault(); void handleNextEpisode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Re-bind on status change so the predicates see the new state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status]);

  // TASK-117 gamepad fallback over the keyboard-teleop sidecar socket.
  const gamepadEligible = !!robot && !!session && ['gamepad', 'keyboard_mouse', 'bilateral_aloha'].includes(session.type);
  // TASK-320: one control lease for the page, joined by the gamepad and the
  // simulated-VR input. Inert (no socket, no UI) while the server does not
  // advertise leases.
  const sessionIsLive = !!session && ['created', 'recording', 'paused'].includes(session.status);
  const sessionIsVr = session?.type === 'vr_quest' || session?.type === 'vr_vision_pro';
  // TASK-396: a real headset drives through the VR window, which holds its own
  // lease and "Take control". The page's lease would contend with it for the
  // robot's one lease, so a VR session joins it only for the simulated input.
  const [simulateVr, setSimulateVr] = useState(false);
  const leaseInputs = gamepadEligible || (sessionIsVr && simulateVr);
  // TASK-427: Set up step 2's "Take control" opens the page's lease socket on
  // the press, and only then; until it, the page holds no lease (TASK-396).
  const leaseTake = useLeaseTake();
  const { lease, connected: leaseConnected } = useSessionControlLease(
    session?.robotId ?? '',
    robot?.a2aAgentUrl,
    robotOnline && sessionIsLive && (leaseInputs || leaseTake.wanted),
  );
  leaseTake.sync(lease, leaseConnected);
  useGamepadJoints({
    robot: gamepadEligible ? robot : null,
    enabled: gamepadEligible && (session?.status === 'recording' || session?.status === 'paused'),
    lease,
  });
  // TASK-398: the robot's measured mode (limp / stand / balance) for a VR
  // session, polled at 1 Hz. The panel shows only on a robot whose sidecar can
  // change the mode.
  const baseMode = useRobotBaseMode(session?.robotId ?? '', {
    enabled: !!session && sessionIsVr && sessionIsLive && robotOnline,
  });
  const modeControlOn = baseMode.status?.capability.gate === 'fsm' || baseMode.status?.capability.gate === 'full';

  // TASK-427: the server never preempts a lease, so the lease step 2 took is
  // given back for the operator, on its own when the hand-over is due (below)
  // and when the session starts. While the page holds it, steps 2 to 5 show it
  // with a Release button.
  const pageHoldsLease = sessionIsVr && !leaseInputs && leaseTake.wanted && lease.state === 'bound';
  const releaseLease = leaseTake.release;
  const releaseOnStart = sessionIsVr && !leaseInputs && leaseTake.wanted && session?.status !== 'created';
  useEffect(() => {
    if (releaseOnStart) releaseLease();
  }, [releaseOnStart, releaseLease]);

  // TASK-414: this page watches the session as the desktop assistant — except
  // while its own VR modal is open, when the headset's publisher is the operator.
  const { requestMode } = useSessionPresence(sessionIsLive ? session?.id : null, vrModalOpen ? null : 'assistant');
  // TASK-417: the Robot mode card may ask the headset only while its operator is in VR.
  const operatorInVr = useDataCollectionStore((s) => selectOperatorFor(id)(s)?.state.inVr === true);
  useOperatorCues(id, capturing, sessionIsLive && sessionIsVr && !vrModalOpen);
  const getOperatorState = useCallback(
    () => selectOperatorFor(id)(useDataCollectionStore.getState())?.state ?? null,
    [id],
  );
  const twinOverlay = useMemo(
    () => (sessionIsVr ? { link: OVERLAY_LINK, node: <OperatorOverlay getState={getOperatorState} /> } : undefined),
    [sessionIsVr, getOperatorState],
  );

  // TASK-392: what the page can check before recording, and the cameras the
  // robot really serves (a G1 has a head camera, not top/wrist).
  const cameras = useRobotCameras(sessionIsLive && robotOnline ? session!.robotId : null, 5000);
  const isCreated = session?.status === 'created';
  const presence = useInputPresence(isCreated && sessionIsVr, isCreated && session?.type === 'gamepad');
  const preflightItems = useMemo(() => (session && isCreated ? buildPreflight({
    robot: robot ? { name: robot.name, online: robotOnline } : null,
    agentConnected: isTelemetryConnected,
    cameras: { loading: cameras.loading, names: cameras.cameras, source: cameras.source, detail: cameras.detail },
    sessionType: session.type,
    secureContext: presence.secureContext,
    vrSupported: presence.vrSupported,
    gamepadConnected: presence.gamepadConnected,
    lease: leaseInputs ? { enabled: lease.enabled, bound: lease.state === 'bound' } : undefined,
  }) : []), [session, isCreated, robot, robotOnline, isTelemetryConnected, cameras.loading, cameras.cameras,
    cameras.source, cameras.detail, presence.secureContext, presence.vrSupported, presence.gamepadConnected,
    leaseInputs, lease.enabled, lease.state]);
  const preflight = summarizePreflight(preflightItems);
  // TASK-427: the Set up steps read the robot's readiness (the compact panel's
  // own read before); Record keeps its panel until TASK-428.
  const readinessState = useRobotReadiness(session?.robotId ?? '', { enabled: isCreated && !!robot });
  // The hand-over is due once the page's lease has done its work: arm control
  // on and the robot balancing (steps 2 and 3), or this page's own VR window
  // opening. Never on the headset's presence: it reports its operator in VR
  // only after it holds the lease, which it cannot while this page keeps it.
  const leaseDone = leaseWorkDone(
    readinessState.readiness,
    { measured: baseMode.status?.base?.mode ?? null, gateOn: modeControlOn },
    questPagePort(),
  );
  const handOver = useCallback(() => {
    releaseLease();
    toast.info('You gave control back', { description: 'The robot balances with arm control on. The operator can take control in the headset now.' });
  }, [releaseLease]);
  useLeaseHandOver(sessionIsVr && !leaseInputs && (vrModalOpen || leaseDone), pageHoldsLease, handOver);
  // Read by the hotkey handler, which binds once per status change.
  const startBlockedRef = useRef(false);
  startBlockedRef.current = isCreated && preflight.blocking;

  const handleAnnotate = async () => {
    if (!annotationText.trim()) { setModalError('Describe the task the robot should learn.'); return; }
    setSaving(true); setModalError(undefined);
    try {
      await annotateSession(annotationText.trim());
      toast.success('Task updated', { description: annotationText.trim() });
      setAnnotateOpen(false);
    } catch (err) { setModalError(errorMessage(err)); } finally { setSaving(false); }
  };

  const handleExport = async () => {
    setSaving(true); setModalError(undefined);
    try {
      await exportSession({ datasetName: exportName.trim() || undefined });
      toast.success('Dataset created', { description: exportName.trim() || undefined });
      setExportOpen(false); setExportName('');
    } catch (err) { setModalError(errorMessage(err)); } finally { setSaving(false); }
  };

  if (!session) {
    return (
      <div className="flex flex-col gap-3">
        <SessionCommandBarSkeleton title={error && !isLoading ? 'Session' : 'Loading…'} />
        <Panel>
          {error && !isLoading ? (
            <ErrorState title="Couldn't load this session" message={error} onRetry={() => void fetchSession()} />
          ) : (
            <SkeletonText lines={4} />
          )}
        </Panel>
      </div>
    );
  }

  const isRecording = session.status === 'recording';
  const isPaused = session.status === 'paused';
  const isCompleted = session.status === 'completed';
  const isLive = isRecording || isPaused || session.status === 'created';
  const isVrSession = session.type === 'vr_quest' || session.type === 'vr_vision_pro';
  const isSim = !!robot && (robot.id.startsWith('sim-') || /sim/i.test(robot.model ?? ''));
  const liveFrameCount = live && (isRecording || isPaused)
    ? live.totalFrames
    : isRecording && typeof recordingProgress?.frameCount === 'number' ? recordingProgress.frameCount : session.frameCount;
  const currentEpisode = live?.take ?? recordingProgress?.currentEpisode ?? Math.max(0, episodes.length - 1);
  const hudPhase: HudPhase = isPaused ? 'paused' : !isRecording ? 'idle' : takeMode && live?.phase === 'between' ? 'between' : 'capturing';
  // Session time: the recorder's own clock carried forward on the server's, else the start stamp.
  const liveElapsedS = live && typeof live.elapsedS === 'number'
    ? live.elapsedS + (isRecording ? Math.max(0, (serverNowMs - Date.parse(live.at)) / 1000) : 0)
    : null;
  const sessionElapsedS = liveElapsedS ?? (typeof recordingProgress?.elapsedS === 'number' ? recordingProgress.elapsedS : elapsedSeconds);
  const degraded = !!(live?.degraded || recordingProgress?.degraded);
  const robotType = (telemetry?.robotType as RobotType) ?? ((robot?.metadata as Record<string, unknown>)?.robotType as RobotType) ?? 'generic';
  const openExport = () => { setModalError(undefined); setExportOpen(true); };
  summaryRef.current = { kept, elapsedS: sessionElapsedS, best: streak.best };
  // The head camera leads the side column; any other camera goes under the twin.
  const cameraNames = cameras.cameras.length > 0 ? cameras.cameras.slice(0, 4) : ['top', 'wrist'];
  const headIndex = Math.max(0, cameraNames.findIndex((n) => /head/i.test(n)));
  const leadCamera = cameraNames[headIndex];
  const otherCameras = cameraNames.filter((_, i) => i !== headIndex);
  const operatorViewer = viewers.find((v) => v.role === 'operator') ?? null;
  // TASK-414: who holds the robot, for everyone, whenever leases are on. The
  // interactive bar below covers the page's own inputs. TASK-426: no
  // ControlLeaseBar on this page draws an E-stop — the bar's is the one.
  const showLeaseHolder = isLive && lease.enabled && !leaseInputs;
  const cameraTile = (name: string, className: string) => (
    <CameraStreamView
      key={name}
      robotId={session.robotId}
      cameraName={name}
      label={cameraLabel(name)}
      className={className}
      isRecording={isRecording}
      offline={!robotOnline}
    />
  );

  // TASK-426: the phase engine and the command bar.
  const phase = sessionPhase(session.status);
  const legacyRecording = isRecording && !takeMode;
  const robotFault = robot?.status === 'protective_stop' || robot?.status === 'error';
  const tally = commandBarTally({ status: session.status, capturing: capturing || legacyRecording, fault: robotFault });
  const link: RobotLink = !robotOnline ? 'offline' : isTelemetryConnected ? 'live' : 'stale';
  const headset = deviceRole === 'headset';
  const detectedRole = detectDeviceRole(typeof navigator === 'undefined' ? '' : navigator.userAgent, EMULATOR_ACTIVE);
  // The one VRSessionPanel: Testing tools rows on a desktop, the hero's Launch VR on the headset.
  const vrPanelMounted = (isLive || vrGoodbye) && isVrSession;
  const vrPanel = (variant: 'tools' | 'hero') => (
    <VRSessionPanel
      robot={robot}
      lease={lease}
      simulate={simulateVr}
      onSimulateChange={setSimulateVr}
      onVrOpenChange={setVrModalOpen}
      showReadiness={false}
      variant={variant}
    />
  );
  const jointUnit = jointPositionUnit(telemetry?.robotType ?? (robot?.metadata as Record<string, unknown> | undefined)?.robotType);
  // Testing tools rows. Positions are stable (nulls hold their slot), so the
  // VRSessionPanel in slot 0 never remounts while the session ends under VR.
  const tools = vrPanelMounted || isLive ? (
    <>
      {vrPanelMounted && !headset ? vrPanel('tools') : null}
      {isLive && !isVrSession && robot && gamepadEligible ? (
        <TestingToolsRow
          title="Keyboard fallback"
          help="Drive single joints from the keyboard."
          wide={showKeyboardFallback}
          control={
            <Button variant="ghost" size="sm" data-testid="keyboard-fallback-toggle" aria-expanded={showKeyboardFallback} onClick={() => setShowKeyboardFallback((v) => !v)}>
              {showKeyboardFallback ? 'Close' : 'Open'}
            </Button>
          }
        >
          {showKeyboardFallback ? <KeyboardTeleopSection robot={robot} /> : null}
        </TestingToolsRow>
      ) : null}
      {isLive ? (
        <TestingToolsRow
          title="Joint states"
          help="Every joint's position, live."
          data-testid="tools-joint-states"
          wide={showJoints}
          control={
            <Button variant="ghost" size="sm" data-testid="joint-states-toggle" aria-expanded={showJoints} onClick={() => setShowJoints((v) => !v)}>
              {showJoints ? 'Hide' : 'Show'}
            </Button>
          }
        >
          {showJoints ? <JointStateGrid jointStates={telemetry?.jointStates ?? []} columns={2} positionUnit={jointUnit} /> : null}
        </TestingToolsRow>
      ) : null}
      {isLive && isVrSession && detectedRole === 'desktop' ? (
        <TestingToolsRow
          title="Show the headset view here"
          help="Leads with Launch VR, as the Quest does."
          control={
            <Switch
              checked={headset}
              onCheckedChange={(on) => setRoleOverride(on ? 'headset' : null)}
              aria-label="Show the headset view here"
              data-testid="headset-view-toggle"
            />
          }
        />
      ) : null}
    </>
  ) : null;

  // The phase actions that are not in the bar, until each phase gets its own
  // layout (TASK-428 take dock, TASK-429 summary band).
  const legacyActions = (legacyRecording || isPaused) && (
    <div className="flex flex-wrap items-center gap-2" data-testid="session-legacy-actions">
      {legacyRecording && (
        <Button variant="secondary" isLoading={pending === 'pause'} leftIcon={<Pause className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void handlePause()}>Pause</Button>
      )}
      {isPaused && (
        <Button isLoading={pending === 'start'} leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void handleStart()}>Resume</Button>
      )}
    </div>
  );

  // The old blocks, by phase. TASK-427/428/429 replace them one phase at a time.
  const liveBlocks = isLive && (
    <>
      {phase === 'record' && lastQuickCheck && (
        <QuickCheckCard
          key={lastQuickCheck.take}
          sessionId={session.id}
          quickCheck={lastQuickCheck}
          onKeep={dismissQuickCheck}
          onDiscard={handleDiscardTake}
        />
      )}

      {isRecording && degraded && (
        <Panel variant="inset" padding="sm" className="text-[13px] text-ink-secondary">
          <span className="font-medium text-signal-estimated">Frames are being missed.</span> The robot agent is unreachable; retrying automatically.
        </Panel>
      )}

      {showLeaseHolder && robot && (
        <Panel padding="sm" data-testid="session-lease-holder">
          <ControlLeaseBar lease={lease} robotId={robot.id} robotName={robotName} connected={false} readOnly showEstop={false} />
        </Panel>
      )}

      {lease.enabled && leaseInputs && robot && (
        <Panel data-testid="session-control-lease">
          <Panel.Header title="Control" description="Gamepad and simulated VR input drive the robot only while you hold control." />
          <Panel.Body>
            <ControlLeaseBar lease={lease} robotId={robot.id} robotName={robotName} connected={leaseConnected} showEstop={false} />
          </Panel.Body>
        </Panel>
      )}

      {isVrSession && modeControlOn && robot && (
        <Panel data-testid="session-robot-mode">
          <Panel.Header
            title="Robot mode"
            description="Limp, Stand up and Balance without the remote. The changes need control — take it in the VR window (or here, for simulated input). While the operator is in the headset, ask for Stand up or Balance here; they allow it in the headset."
          />
          <Panel.Body>
            <RobotModeControl
              robotId={robot.id}
              lease={lease}
              baseMode={baseMode}
              requestFromHolder={operatorViewer && operatorInVr && !vrModalOpen ? requestMode : undefined}
            />
          </Panel.Body>
        </Panel>
      )}

      {/* TASK-414: the assistant layout. Left: the twin, large. Right: the
          head camera, the HUD, the operator, the takes and the readiness.
          Below lg it stacks with the side column first, so the controls never
          sit under the 3D view on a tablet. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12" data-testid="session-assistant-layout">
        <div className="flex flex-col gap-6 lg:col-span-7 xl:col-span-8">
          {/* D5: on the Quest the VR modal covers this page — no second scene behind it. */}
          {!vrModalOpen && (
            <Panel padding="none" data-testid="session-twin">
              <Panel.Header
                title="Robot"
                description={robotOnline ? `${robotType.toUpperCase()}${isVrSession ? ' · ghost hands show where the operator wants them' : ''}` : undefined}
              />
              {robotOnline ? (
                <div className="h-72 sm:h-96 lg:h-[34rem]">
                  <Suspense fallback={<Skeleton className="h-full w-full" />}>
                    <Robot3DViewer
                      robotType={robotType}
                      robotId={session.robotId}
                      jointStates={telemetry?.jointStates}
                      isAnimating={isTelemetryConnected}
                      linkOverlay={twinOverlay}
                    />
                  </Suspense>
                </div>
              ) : (
                <EmptyState size="sm" title="Robot offline" description="Start the robot agent to see the live model." />
              )}
            </Panel>
          )}
          {!vrModalOpen && otherCameras.length > 0 && !(robotOnline && cameras.loading) && !(robotOnline && cameras.cameras.length === 0) && (
            <Panel>
              <Panel.Header title="More cameras" />
              <Panel.Body className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {otherCameras.map((name) => cameraTile(name, 'h-44'))}
              </Panel.Body>
            </Panel>
          )}
        </div>
        <div className="order-first flex flex-col gap-6 lg:order-none lg:col-span-5 xl:col-span-4">
          {!vrModalOpen && (
            <div data-testid="session-lead-camera">
              {robotOnline && cameras.loading ? (
                <Skeleton className="h-56 w-full" />
              ) : robotOnline && cameras.cameras.length === 0 ? (
                <EmptyState
                  size="sm"
                  title="No camera"
                  description={cameras.detail ? `The robot serves no camera: ${cameras.detail}` : 'The robot serves no camera. Episodes record without video.'}
                />
              ) : (
                cameraTile(leadCamera, 'h-56')
              )}
            </div>
          )}
          {phase === 'record' && legacyActions}
          <SessionHud
            phase={hudPhase}
            take={live ? live.take : isRecording ? currentEpisode : null}
            takeElapsedS={takeMode ? takeElapsedS : isRecording ? sessionElapsedS : null}
            duration={isRecording ? formatElapsed(Math.floor(sessionElapsedS)) : formatDuration(session.duration)}
            frames={liveFrameCount}
            fps={session.fps}
            fpsActual={isRecording ? live?.fpsActual ?? recordingProgress?.fpsActual : undefined}
            kept={kept}
            degraded={isRecording && degraded}
            autoStopInS={autoStopInS}
            tone={isRecording ? 'live' : undefined}
            streak={streak.current}
            compact
          />
          {isVrSession && (
            <OperatorCard
              robotId={session.robotId}
              sessionId={session.id}
              operator={operator?.state ?? null}
              operatorViewer={operatorViewer}
            />
          )}
          <EpisodePanel
            sessionId={session.id}
            episodes={episodes}
            live={live}
            isRecording={isRecording}
            canDiscard={isLive}
            pending={takePending}
            onStartTake={() => handleStartTake()}
            onStopTake={() => handleStopTake()}
            onNextTake={() => handleNextTake()}
            onDiscardLast={handleDiscardLast}
            onDiscardTake={(take) => (takeMode ? handleDiscardTake(take) : handleDiscardEpisode(take))}
            onNextEpisode={handleNextEpisode}
          />
          {isVrSession && robot && (
            <Panel data-testid="session-readiness">
              <Panel.Header title="Robot side" description="Why the arms would not follow, before anyone puts the headset on." />
              <Panel.Body>
                <RobotReadinessPanel robotId={robot.id} variant="compact" lease={{ enabled: lease.enabled, state: lease.state, grant: lease.grant }} />
              </Panel.Body>
            </Panel>
          )}
          <Panel>
            <Panel.Header title="Quality" />
            <Panel.Body><QualityIndicator feedback={isRecording || isPaused ? qualityFeedback : null} /></Panel.Body>
          </Panel>
        </div>
      </div>
    </>
  );


  // TASK-427: Set up — the guided rail and the preview.
  const operatorName = operatorViewer ? operatorViewer.displayName.split(' ')[0] : null;
  const questPort = questPagePort();
  const setupModel = phase === 'setup' ? buildSetupModel({
    sessionType: session.type,
    robotName,
    readiness: readinessState.readiness,
    questPort,
    preflight: preflightItems,
    mode: { measured: baseMode.status?.base?.mode ?? null, gateOn: modeControlOn },
    lease: {
      enabled: lease.enabled,
      bound: lease.state === 'bound',
      holder: lease.holder?.displayName ?? lease.holder?.userId ?? null,
      pageInputs: leaseInputs,
    },
    operator: { present: operatorViewer !== null, name: operatorName, inVr: operatorInVr },
  }) : null;
  // The page's own lease drives the robot-side buttons; Take control opens it on
  // a VR session (simulated input shows the lease bar instead).
  const readinessLease = {
    enabled: lease.enabled,
    state: lease.state,
    grant: () => lease.grant(),
    take: isVrSession && !leaseInputs ? leaseTake.take : undefined,
  };
  const leaseBar = lease.enabled && leaseInputs && robot ? (
    <div className="mt-1" data-testid="session-control-lease">
      <ControlLeaseBar lease={lease} robotId={robot.id} robotName={robotName} connected={leaseConnected} showEstop={false} />
    </div>
  ) : null;
  const heldLine = (className?: string) => (pageHoldsLease ? (
    <PageLeaseLine text={`You have control of ${robotName}.`} onRelease={releaseLease} className={className} />
  ) : null);
  const detailsFor = (step: SetupStep) => (robot && step.rows.length > 0 ? (
    <RobotReadinessPanel robotId={robot.id} variant="rows" rows={step.rows} readiness={readinessState} />
  ) : undefined);
  const robotActions = (only: Array<'start' | 'arm' | 'read_only' | 'logs'>, lit: boolean) => (robot ? (
    <ReadinessActions robotId={robot.id} ready={readinessState} lease={readinessLease} only={only} lit={lit} />
  ) : null);
  const renderStep = (step: SetupStep, lit: boolean): SetupStepContent => {
    switch (step.id) {
      case 'robot':
        return {
          lead: readinessState.readiness?.bringup
            ? "The bridge, the sidecar and the robot agent run on the robot PC. Stop the robot side from the robot's Teleop tab when you finish for the day."
            : preflightItems.find((i) => i.id === 'robot')?.action ?? `${robotName} is online. Its agent streams the robot state the takes record.`,
          actions: robotActions(['start', 'logs'], lit),
          details: detailsFor(step),
        };
      case 'arm_control':
        return {
          lead: 'The arms follow the headset only in arm control. Take control, then switch. Nothing moves yet.',
          children: leaseBar ?? heldLine(),
          actions: robotActions(['arm', 'read_only'], lit),
          note: (
            <>
              <Glasses className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={1.75} aria-hidden />
              Once arm control is on and the robot balances, this page gives your control back so the operator can take it in the headset.
            </>
          ),
          details: detailsFor(step),
        };
      case 'stance':
        return {
          children: robot ? (
            <div data-testid="session-robot-mode">
              <RobotModeControl
                robotId={robot.id}
                variant="step"
                lit={lit}
                lease={lease}
                baseMode={baseMode}
                // Simulated input: step 2's control bar takes it. Otherwise this step does.
                takeControlHint={leaseInputs ? 'Take control in step 2 first.' : undefined}
                onTakeControl={readinessLease.take}
                requestFromHolder={operatorViewer && operatorInVr && !vrModalOpen ? requestMode : undefined}
              />
              {heldLine('mt-3')}
            </div>
          ) : null,
          details: detailsFor(step),
        };
      case 'quest': {
        const quest = readinessState.readiness?.quest ?? null;
        return {
          lead: 'Plug the Quest into the robot PC over USB, with Developer Mode on and the headset awake. Then connect it and open this session on it.',
          // Still holding control here (taken again on purpose, or on a robot
          // that needed no hand-over): Release is the lit action, since the
          // operator cannot take control until it is pressed.
          children: (
            <>
              {pageHoldsLease && (
                <PageLeaseLine
                  text={`You still have control of ${robotName}. Release it so ${operatorName ?? 'the operator'} can take it in the headset.`}
                  onRelease={releaseLease}
                  lit={lit}
                  className="mb-3"
                />
              )}
              {robot && quest ? (
                <div data-testid="quest-connect-help" data-mode="live">
                  <QuestControls robotId={robot.id} quest={quest} sessionId={session.id} port={questPort} lit={lit && !pageHoldsLease} />
                </div>
              ) : (
                <QuestConnectHelp location={window.location} robotId={robot?.id} quest={null} sessionId={session.id} />
              )}
            </>
          ),
          details: detailsFor(step),
        };
      }
      case 'operator':
        return {
          lead: 'In the headset the operator presses Launch VR, Take control and Enter VR. You hear a chime when they are in.',
          children: pageHoldsLease ? (
            <PageLeaseLine
              text={`You still have control of ${robotName}. ${operatorName ?? 'The operator'} can take it in the headset only once you release it.`}
              onRelease={releaseLease}
              lit={lit}
            />
          ) : null,
          details: detailsFor(step),
        };
      case 'input': {
        const input = preflightItems.find((i) => i.id === 'input');
        return { lead: input?.action ?? input?.detail };
      }
      case 'control':
        return {
          lead: 'Your input moves the robot only while you hold control.',
          children: leaseBar,
          details: detailsFor(step),
        };
    }
  };
  const setupBlocks = setupModel && (
    <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" data-testid="session-setup">
      <SetupRail
        model={setupModel}
        renderStep={renderStep}
        onStart={() => void handleStart()}
        starting={pending === 'start'}
        blockedReason={preflight.blocking ? preflight.next : null}
        autoStopS={live?.autoStopS ?? null}
      />
      <Panel padding="none" className="flex min-h-[320px] flex-col overflow-hidden max-lg:aspect-[4/3] max-lg:min-h-0" data-testid="setup-preview">
        <LiveView
          className="flex-1"
          robotId={session.robotId}
          robotType={robotType}
          online={robotOnline}
          live={isTelemetryConnected}
          jointStates={telemetry?.jointStates}
          twinOverlay={twinOverlay}
          cameras={{ names: cameras.cameras, loading: robotOnline && cameras.loading, detail: cameras.detail }}
          defaultMain="twin"
          expandAt="bottom"
          suspended={vrModalOpen}
        />
      </Panel>
    </div>
  );

  const wrapBlocks = phase === 'wrap' && (
    <>
      {isCompleted && session.frameCount === 0 && !session.exportedDatasetId && (
        <div className="flex">
          <LinkButton to="/data-collection/new" leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}>New session</LinkButton>
        </div>
      )}
      {isCompleted && (
        <SessionCompleted
          session={session}
          robotName={robotName}
          episodes={episodes}
          onEditTask={() => { setAnnotationText(session.languageInstr || ''); setModalError(undefined); setAnnotateOpen(true); }}
          onCreateDataset={openExport}
          onRefetch={refetchCompleted}
        />
      )}
    </>
  );

  return (
    // max-sm:pb-[88px]: with the shell's 24 px, nothing hides behind the phone's E-STOP dock.
    // Below 1440 px: 16 px more above the bar, where the shell's section rail
    // runs over the E-STOP's column and would sit 35 px from it (TASK-427). In
    // every phase, so the bar and the E-STOP never move when the phase changes.
    <div className="flex flex-col gap-3 max-sm:pb-[88px] sm:max-[1439px]:pt-4" data-phase={phase} data-role={deviceRole}>
      <SessionCommandBar
        phase={phase}
        tally={tally}
        ready={phase === 'setup' && !!setupModel?.allDone && !preflight.blocking}
        title={sessionName(session)}
        status={session.status}
        robotName={robotName}
        isSim={isSim}
        link={link}
        inputLabel={TELEOPERATION_TYPE_LABELS[session.type]}
        fps={session.fps}
        viewers={isLive ? viewers : []}
        muted={muted}
        onToggleMute={() => setCueMuted(!muted)}
        simulatedInput={isVrSession && simulateVr}
        onEnd={canEndSession(session) ? () => void handleEnd() : undefined}
        endPending={pending === 'end'}
        tools={tools}
        estop={<SessionEStopButton robotId={session.robotId} robotName={robotName} />}
      />

      {/* The headset: Launch VR first, the desktop's blocks behind "Robot setup". */}
      {headset && vrPanelMounted && (
        <HeadsetHero
          launcher={vrPanel('hero')}
          onShowDesktopView={roleOverride ? () => setRoleOverride(null) : undefined}
        />
      )}

      {headset && isLive && isVrSession
        ? <RobotSetupDisclosure>{phase === 'setup' ? setupBlocks : liveBlocks}</RobotSetupDisclosure>
        : phase === 'setup' ? setupBlocks : liveBlocks}
      {wrapBlocks}

      <FormModal
        isOpen={annotateOpen}
        onClose={() => setAnnotateOpen(false)}
        title="Edit task"
        description="The language instruction the policy is trained on."
        submitLabel="Save changes"
        submittingLabel="Saving…"
        isSubmitting={saving}
        error={modalError}
        onSubmit={handleAnnotate}
        noValidate
      >
        <FormField label="Task" required>
          <Textarea rows={3} value={annotationText} onChange={(e) => setAnnotationText(e.target.value)} placeholder="Describe the task…" />
        </FormField>
      </FormModal>

      <FormModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Create dataset"
        description="Packs this session's episodes into a LeRobot dataset you can curate and train on."
        submitLabel="Create dataset"
        submittingLabel="Creating…"
        isSubmitting={saving}
        error={modalError}
        onSubmit={handleExport}
        noValidate
      >
        <FormField label="Dataset name" aside="Optional" hint="Leave empty for a generated name.">
          <Input value={exportName} onChange={(e) => setExportName(e.target.value)} placeholder="e.g. g1-pick-cube" />
        </FormField>
      </FormModal>
    </div>
  );
}
