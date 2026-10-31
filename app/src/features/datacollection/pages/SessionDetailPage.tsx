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
 *              TASK-428: Record is a console that fits one screen — the live
 *              view (the head camera, the twin as a picture-in-picture) over the
 *              systems strip, and the take dock over the takes list. The slot
 *              in the dock shows one thing: recovery, a blocker, or the quick
 *              check. The take hotkeys, toasts and confirms are unchanged.
 *              TASK-429: Wrap up (completed and failed) is one summary band
 *              with one dataset action, the takes and the details.
 *              TASK-430: Set up's step 1 leads with Restart when the robot side
 *              runs stale code, and keeps Stop under its Details.
 *              TASK-431: a stop reads the agent's and the sidecar's own latch
 *              (and only without one, a `protective_stop` status), and offers
 *              Reset E-stop, the VR window's reset: lit in Record's recovery
 *              slot, and in Set up as the blocker of step 3. The robot's status
 *              is read again on open and after a reset.
 *              TASK-437: control that step 2 took and that ended on its own (the
 *              robot expired it) says so in the step that needs it; the arm
 *              switch takes it again rather than going out without it.
 * @feature datacollection
 */

import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { Glasses, OctagonX, TriangleAlert } from 'lucide-react';
import {
  Button, ErrorState, FormField, FormModal, Input, Panel,
  SkeletonText, Switch, Textarea, confirm, errorMessage, toast,
} from '@/shared/components/ui';
import { VRSessionPanel } from '../components/VRSessionPanel';
import type { HudPhase } from '../components/session/SessionHud';
import { SessionCompleted } from '../components/session/SessionCompleted';
import { QuickCheckCard } from '../components/session/QuickCheckCard';
import { SessionEStopButton } from '../components/session/SessionEStopButton';
import { WHY_CLASS, heldLine as heldText } from '../components/OperatorCard';
import { OperatorOverlay, OVERLAY_LINK } from '../components/OperatorOverlay';
import { OperatorChip } from '../components/console/OperatorChip';
import { SystemsStrip, type StripCell } from '../components/console/SystemsStrip';
import { TakeDock } from '../components/console/TakeDock';
import { TakesList } from '../components/console/TakesList';
import { EstopRecovery } from '../components/console/EstopRecovery';
import { RESET_DONE, robotStop } from '../utils/robotStop';
import { useEstopReset } from '../hooks/useEstopReset';
import { useTakeHotkeys } from '../hooks/useTakeHotkeys';
import { ReparentHost, useDetachedNode } from '../components/console/Reparent';
import { useViewportFill } from '../hooks/useViewportFill';
import { SessionCommandBar, SessionCommandBarSkeleton, type RobotLink } from '../components/console/SessionCommandBar';
import { TestingToolsRow } from '../components/console/TestingTools';
import { HeadsetHero, RobotSetupDisclosure } from '../components/console/HeadsetHero';
import { SetupRail, type SetupStepContent } from '../components/console/SetupRail';
import { LiveView, cameraLabel } from '../components/console/LiveView';
import { buildSetupModel, leaseWorkDone, modeWord, type SetupStep, type SystemsCellId, type SystemsCellStatus } from '../utils/setupSteps';
import { useLeaseHandOver, useLeaseTake } from '../hooks/useLeaseTake';
import { PageLeaseLine, PageLeaseLostLine } from '../components/console/PageLeaseLine';
import { useDeviceRole, detectDeviceRole, type DeviceRole } from '../hooks/useDeviceRole';
import { commandBarTally, sessionPhase } from '../utils/sessionPhase';
import { EMULATOR_ACTIVE } from '../../robots/components/tabs/vr/vrConstants';
import { ReadinessActions, RobotReadinessPanel, type ReadinessActionId } from '../../robots/components/readiness/RobotReadinessPanel';
import { ReadinessRow } from '../../robots/components/readiness/ReadinessRow';
import { QuestControls } from '../../robots/components/readiness/QuestControls';
import { QuestConnectHelp } from '../../robots/components/tabs/vr/QuestConnectHelp';
import { useRobotReadiness } from '../../robots/hooks/useRobotReadiness';
import type { RowId } from '../../robots/components/readiness/readinessRows';
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
import { buildPreflight, summarizePreflight, wristCamerasRow } from '../utils/preflight';
import { cameraSetLabel, sessionWristCameras } from '../utils/cameras';
import { ControlLeaseBar } from '../../robots/components/tabs/ControlLeaseBar';
import { RobotModeControl } from '../../robots/components/RobotModeControl';
import { useRobotBaseMode } from '../../robots/hooks/useRobotBaseMode';
import { jointPositionUnit } from '../../robots/types/robots.types';
import type { RobotType } from '../../robots/types/robots.types';
import { TELEOPERATION_TYPE_LABELS, formatDuration, canStartSession, canPauseSession, canEndSession } from '../types/datacollection.types';
import { sessionName } from '../utils/sessionFormat';
import { actorTag, describeEStopTake, takeLabel } from '../utils/takeFormat';
import { cn } from '@/shared/utils/cn';

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
  const fetchRobot = useRobotsStore((s) => s.fetchRobot);
  const robot = robots.find((r) => r.id === session?.robotId) ?? null;
  useEffect(() => { if (robots.length === 0) fetchRobots(); }, [robots.length, fetchRobots]);
  // TASK-431: the robot's status as the server has it now, not as the app first
  // loaded it. The page decides from it whether a protective stop shows.
  const sessionRobotId = session?.robotId;
  useEffect(() => { if (sessionRobotId) void fetchRobot(sessionRobotId); }, [sessionRobotId, fetchRobot]);

  const robotOnline = !!robot && robot.status !== 'offline';
  // TASK-431: the stream starts once the robot is known to be online, also when
  // the robot list arrives after the session. The hook connects once per robot
  // id, so the id is handed over only when the stream should run; before this,
  // a robot list that came second left the polled stream (the demo, dev before
  // the first broadcast frame) off for good, and with it the agent's warnings.
  const telemetryOn = !!session && robotOnline && ['recording', 'paused', 'created'].includes(session.status);
  const { telemetry, isConnected: isTelemetryConnected } = useTelemetryStream(telemetryOn ? session!.robotId : '', {
    autoConnect: telemetryOn,
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
  // TASK-428: the legacy Next episode in flight, and the systems cell whose popover is open.
  const [legacyNextBusy, setLegacyNextBusy] = useState(false);
  const [openCell, setOpenCell] = useState<SystemsCellId | null>(null);
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

  // TASK-428: Space / N / Backspace and the Undo window, moved unchanged out of
  // the old take panel; bound while the session records (Record).
  const recordPhase = sessionStatus === 'recording' || sessionStatus === 'paused';
  const takeControls = useTakeHotkeys({
    live,
    isRecording: sessionStatus === 'recording',
    pending: takePending,
    hotkeys: recordPhase,
    onStartTake: () => handleStartTake(),
    onStopTake: () => handleStopTake(),
    onNextTake: () => handleNextTake(),
    onDiscardLast: handleDiscardLast,
    onDiscardTake: (take) => (takeMode ? handleDiscardTake(take) : handleDiscardEpisode(take)),
  });
  // The console fills the viewport below its top: Record never scrolls from 1024 px.
  const consoleRef = useViewportFill({ enabled: recordPhase });
  // The robot-mode controls render once and move between the dock's recovery
  // slot and the Mode cell without a remount (an open confirm or the headset's
  // answer survives the robot reaching Balance).
  const modeNode = useDetachedNode();

  const legacyNext = async () => {
    setLegacyNextBusy(true);
    try { await handleNextEpisode(); } finally { setLegacyNextBusy(false); }
  };

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
  // TASK-442: the wrist cameras this session records; none for a head-only session.
  const sessionCameras = session?.cameras ?? null;
  const wristCameras = useMemo(() => sessionWristCameras({ cameras: sessionCameras }), [sessionCameras]);
  const isCreated = session?.status === 'created';
  const presence = useInputPresence(isCreated && sessionIsVr, sessionIsLive && session?.type === 'gamepad');
  // TASK-428: Record folds the same checks into its systems cells.
  const preflightItems = useMemo(() => (session && sessionIsLive ? buildPreflight({
    robot: robot ? { name: robot.name, online: robotOnline } : null,
    agentConnected: isTelemetryConnected,
    cameras: { loading: cameras.loading, names: cameras.cameras, source: cameras.source, detail: cameras.detail },
    wristCameras,
    sessionType: session.type,
    secureContext: presence.secureContext,
    vrSupported: presence.vrSupported,
    gamepadConnected: presence.gamepadConnected,
    lease: leaseInputs ? { enabled: lease.enabled, bound: lease.state === 'bound' } : undefined,
  }) : []), [session, sessionIsLive, robot, robotOnline, isTelemetryConnected, cameras.loading, cameras.cameras,
    cameras.source, cameras.detail, wristCameras, presence.secureContext, presence.vrSupported, presence.gamepadConnected,
    leaseInputs, lease.enabled, lease.state]);
  const preflight = summarizePreflight(preflightItems);
  // TASK-427: the Set up steps read the robot's readiness (the compact panel's
  // own read before). TASK-428: so do Record's systems cells, on a VR session
  // (where the compact panel read it before).
  const readinessState = useRobotReadiness(session?.robotId ?? '', { enabled: (isCreated || (sessionIsLive && sessionIsVr)) && !!robot });
  // The hand-over is due once the page's lease has done its work: arm control
  // on and the robot balancing (steps 2 and 3), or this page's own VR window
  // opening. Never on the headset's presence: it reports its operator in VR
  // only after it holds the lease, which it cannot while this page keeps it.
  const leaseDone = leaseWorkDone(
    readinessState.readiness,
    { measured: baseMode.status?.base?.mode ?? null, gateOn: modeControlOn },
    questPagePort(),
  );
  // One rising edge per trigger, each with its own message: opening the VR
  // window here is a hand-over even when the robot balanced long before.
  const handOverBalanced = useCallback(() => {
    releaseLease();
    toast.info('You gave control back', { description: 'The robot balances with arm control on. The operator can take control in the headset now.' });
  }, [releaseLease]);
  const handOverVrWindow = useCallback(() => {
    releaseLease();
    toast.info('You gave control back', { description: 'The VR window on this browser takes control itself.' });
  }, [releaseLease]);
  useLeaseHandOver(sessionIsVr && !leaseInputs && leaseDone, pageHoldsLease, handOverBalanced);
  useLeaseHandOver(sessionIsVr && !leaseInputs && vrModalOpen, pageHoldsLease, handOverVrWindow);
  // TASK-431: what holds the robot stopped. The agent's and the sidecar's own
  // latch decide, as readiness and the mode read report them. Only without a
  // latch does a `protective_stop` status count, and the agent's stop warning
  // (its telemetry) names the cause and the reason.
  const readArms = readinessState.readiness?.agent.readiness?.arms ?? null;
  const stop = robotStop({
    agentLatched: !!readArms?.estopLatched || !!baseMode.status?.estopLatched,
    sidecarLatched: !!readArms?.sidecarEstopLatched || !!baseMode.status?.sidecarEstopLatched,
    status: robotOnline && robot ? robot.status : null,
    warnings: telemetry?.warnings,
  });
  const refreshReadiness = readinessState.refresh;
  const refreshBaseMode = baseMode.refresh;
  const estopReset = useEstopReset(session?.robotId ?? null, () => {
    if (session?.robotId) void fetchRobot(session.robotId);
    void refreshReadiness();
    void refreshBaseMode();
  });
  // "The E-stop is reset, stand it up again" holds until the robot balances
  // (it shows only while no stop does).
  const balancingNow = baseMode.status?.base?.mode === 'balance';
  const clearReset = estopReset.clear;
  const resetShown = estopReset.resetAt !== null;
  useEffect(() => {
    if (resetShown && balancingNow) clearReset();
  }, [resetShown, balancingNow, clearReset]);
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
  const operatorViewer = viewers.find((v) => v.role === 'operator') ?? null;

  // TASK-426: the phase engine and the command bar.
  const phase = sessionPhase(session.status);
  const legacyRecording = isRecording && !takeMode;
  const robotFault = robot?.status === 'protective_stop' || robot?.status === 'error';
  const tally = commandBarTally({ status: session.status, capturing: capturing || legacyRecording, fault: robotFault || stop !== null });
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

  // TASK-427: Set up — the guided rail and the preview.
  const operatorName = operatorViewer ? operatorViewer.displayName.split(' ')[0] : null;
  const questPort = questPagePort();
  // TASK-428: Record's systems cells come from the same model.
  const setupModel = phase !== 'wrap' ? buildSetupModel({
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
    stop,
    sessionCameras,
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
  // TASK-437: the control step 2 took ended on its own — the robot expired it
  // (a tab that stopped running missed its renewals) or the socket closed. A
  // VR session has no control bar to say so; the step that needs it does.
  const leaseLost = sessionIsVr && !leaseInputs && leaseTake.wanted && lease.state !== 'bound' && lease.notice?.kind === 'lost'
    ? lease.notice.message
    : null;
  const armControlDone = setupModel?.steps.find((s) => s.id === 'arm_control')?.state === 'done';
  const lostLine = (inStep: 'arm_control' | 'stance', className?: string) => (
    leaseLost && (inStep === 'stance') === armControlDone ? <PageLeaseLostLine message={leaseLost} className={className} /> : null
  );
  // TASK-442: the session's wrist cameras, as a readiness row (only when it records any).
  const wristItem = preflightItems.find((i) => i.id === 'wrist_cameras') ?? null;
  const wristRow = wristItem ? (
    <ul className="flex flex-col gap-1.5" aria-label="Wrist cameras" data-testid="session-wrist-cameras-row">
      <ReadinessRow row={wristCamerasRow(wristItem)} />
    </ul>
  ) : null;
  const detailsFor = (step: SetupStep) => (robot && step.rows.length > 0 ? (
    <RobotReadinessPanel robotId={robot.id} variant="rows" rows={step.rows} readiness={readinessState} />
  ) : undefined);
  const robotActions = (only: ReadinessActionId[], lit: boolean) => (robot ? (
    <ReadinessActions robotId={robot.id} ready={readinessState} lease={readinessLease} only={only} lit={lit} />
  ) : null);
  // TASK-431: the stop and its Reset E-stop, in the step it blocks. That step's
  // own lit action waits behind it. A waiting step does not repeat it.
  const stopIn = (step: SetupStep) => (stop && setupModel?.stopStep === step.id && step.state !== 'waits' ? stop : null);
  const stopBlock = (step: SetupStep, lit: boolean) => {
    const here = stopIn(step);
    return here ? (
      <EstopRecovery
        className="mb-3"
        stop={here}
        lit={lit}
        pending={estopReset.pending}
        error={estopReset.error}
        onReset={() => void estopReset.reset()}
        headset={isVrSession}
        // Only a humanoid session stands up again; the step 3 track drives it.
        standUp={isVrSession && (baseMode.status?.base?.mode ?? null) !== 'balance'}
      />
    ) : null;
  };
  const resetDone = !stop && estopReset.resetAt !== null;
  const renderStep = (step: SetupStep, lit: boolean): SetupStepContent => {
    const stopped = stopIn(step) !== null;
    switch (step.id) {
      case 'robot': {
        // TASK-430: Start, or Restart on stale code, is the step's one lit
        // action; while the robot side runs, Stop waits under Details.
        const side = setupModel?.robotSide ?? { lead: null, stop: false };
        const restarting = readinessState.pending?.action === 'restart';
        const readinessRowsNode = detailsFor(step);
        const rows = wristRow ? <>{readinessRowsNode}<div className={readinessRowsNode ? 'mt-1.5' : undefined}>{wristRow}</div></> : readinessRowsNode;
        return {
          lead: readinessState.readiness?.bringup
            ? `The bridge, the sidecar and the robot agent run on the robot PC.${
              side.lead === 'restart' || restarting
                ? ' Restart stops them and starts them again on the current code, read-only.'
                : side.stop ? ' Stop them under Details when you finish for the day.' : ''
            }`
            : preflightItems.find((i) => i.id === 'robot')?.action ?? `${robotName} is online. Its agent streams the robot state the takes record.`,
          children: stopBlock(step, lit),
          actions: robotActions(['start', 'restart', 'logs'], lit && !stopped),
          details: robot && side.stop && !restarting ? (
            <>
              {rows}
              <div className={rows ? 'mt-3' : undefined} data-testid="setup-robot-stop">
                <ReadinessActions robotId={robot.id} ready={readinessState} lease={readinessLease} only={['stop']} />
              </div>
            </>
          ) : rows,
        };
      }
      case 'arm_control':
        return {
          lead: 'The arms follow the headset only in arm control. Take control, then switch. Nothing moves yet.',
          children: leaseBar ?? heldLine() ?? lostLine('arm_control'),
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
          lead: resetDone ? RESET_DONE : undefined,
          children: robot ? (
            <>
              {stopBlock(step, lit)}
              <div data-testid="session-robot-mode">
                <RobotModeControl
                  robotId={robot.id}
                  variant="step"
                  lit={lit && !stopped}
                  lease={lease}
                  baseMode={baseMode}
                  // Simulated input: step 2's control bar takes it. Otherwise this step does.
                  takeControlHint={leaseInputs ? 'Take control in step 2 first.' : undefined}
                  onTakeControl={readinessLease.take}
                  requestFromHolder={operatorViewer && operatorInVr && !vrModalOpen ? requestMode : undefined}
                />
                {heldLine('mt-3')}
                {lostLine('stance', 'mt-3')}
              </div>
            </>
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
  const setupBlocks = phase === 'setup' && setupModel && (
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

  // TASK-428: Record — the console. The robot-side buttons keep the old Record
  // panel's lease (no Take control of the page's own: the lease Set up took is
  // given back when the session starts).
  const recordLease = { enabled: lease.enabled, state: lease.state, grant: () => lease.grant() };
  const readiness = readinessState.readiness;
  const measuredMode = baseMode.status?.base?.mode ?? null;
  const notBalancing = isVrSession && modeControlOn && measuredMode !== null && measuredMode !== 'balance';
  const operatorState = operator?.state ?? null;
  const operatorInVrNow = operatorState?.inVr === true;
  const recordCells = phase === 'record' && setupModel ? setupModel.cells : [];
  const reasonCellNow = recordCells.find((c) => c.reason) ?? null;
  const reasonOwner = reasonCellNow?.id ?? null;
  const reason = reasonCellNow?.reason ?? null;
  const modeReason = reasonOwner === 'mode' ? reason : null;
  const showRecovery = phase === 'record' && (stop !== null || notBalancing);
  const abortedCheck = lastQuickCheck?.discarded && lastQuickCheck.stopReason === 'estop' ? lastQuickCheck : null;
  const jerky = !!qualityFeedback && (isRecording || isPaused) && qualityFeedback.currentSmoothnessScore < 0.6;
  // The slot's blocker: the first of missed frames, a blocking readiness reason, the headset's block, jerky motion.
  const blockerKind = showRecovery ? null
    : isRecording && degraded ? 'degraded'
      : reason?.severity === 'block' ? 'reason'
        : operatorInVrNow && operatorState!.why.severity === 'block' ? 'operator'
          : jerky ? 'motion' : null;
  /** The readiness reason sentence shows once: in the slot when it holds it, else in its cell's popover. */
  const slotShowsReason = (showRecovery && !!modeReason) || blockerKind === 'reason';
  const FIX: Partial<Record<SystemsCellId, string>> = {
    robot: 'Start robot side…', arm_control: 'Switch to arm control…', control: 'Control…', mode: 'Robot mode…', headset: 'Connect the Quest…',
  };
  const fixButton = (cell: SystemsCellId) => (
    <Button variant="secondary" size="sm" onClick={() => setOpenCell(cell)} data-testid="take-dock-fix">
      {FIX[cell] ?? 'Details…'}
    </Button>
  );
  const modeControl = robot && modeControlOn ? (
    <div data-testid="session-robot-mode">
      <RobotModeControl
        robotId={robot.id}
        variant="step"
        lit={false}
        // In the recovery slot it is the compact form, so the dock still fits one screen.
        dense={showRecovery}
        lease={lease}
        baseMode={baseMode}
        takeControlHint="Take control in the VR window, or through the Control cell."
        requestFromHolder={operatorViewer && operatorInVr && !vrModalOpen ? requestMode : undefined}
      />
    </div>
  ) : null;
  const slotTitle = (tone: 'fault' | 'warn', text: string, testId?: string) => (
    <p className={cn('m-0 flex items-start gap-2 font-semibold', tone === 'fault' ? 'text-signal-stopped' : 'text-signal-unknown')} data-testid={testId}>
      {tone === 'fault'
        ? <OctagonX className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.75} aria-hidden />
        : <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.75} aria-hidden />}
      <span>{text}</span>
    </p>
  );
  const slotLine = 'm-0 ml-6 mt-1 leading-normal text-ink-secondary';
  // TASK-431: a stop leads with its Reset E-stop, the slot's one lit action;
  // the mode buttons wait under it, as they wait for the reset.
  const recovery = showRecovery ? (
    <div className="flex flex-col">
      {stop
        ? slotTitle('fault', stop.title, 'take-dock-recovery-title')
        : slotTitle('warn', modeReason?.text ?? `The robot is in ${modeWord(measuredMode)}. The arms follow only in Balance.`, 'take-dock-recovery-title')}
      {stop && abortedCheck && (
        <p className={cn(slotLine, 'font-medium text-signal-stopped')} role="status" data-testid="quick-check-verdict">
          {describeEStopTake(abortedCheck.take)}
        </p>
      )}
      {stop && (
        <EstopRecovery
          className="ml-6 mt-2"
          dense
          stop={stop}
          lit
          pending={estopReset.pending}
          error={estopReset.error}
          onReset={() => void estopReset.reset()}
          headset={isVrSession}
          standUp={isVrSession && measuredMode !== 'balance'}
        />
      )}
      {!stop && resetDone && <p className={slotLine} data-testid="estop-reset-done">{RESET_DONE}</p>}
      {/* The mode buttons right under the title, so a short slot shows them before it scrolls. */}
      {modeControl && <ReparentHost node={modeNode} className="ml-6 mt-2" />}
      {/* The fallback title already says it; the readiness reason and the stop do not. */}
      {(stop || modeReason) && <p className={cn(slotLine, modeControl && 'mt-1.5')}>The arms will not follow until the robot balances.</p>}
    </div>
  ) : null;
  const blocker = blockerKind === 'degraded' ? (
    <div className="flex flex-col">
      {slotTitle('warn', 'Frames are being missed.', 'hud-degraded')}
      <p className={slotLine}>The robot agent is unreachable; retrying.</p>
    </div>
  ) : blockerKind === 'reason' && reason && reasonOwner ? (
    <div className="flex flex-col">
      {slotTitle('fault', reason.text, 'take-dock-reason')}
      <div className="ml-6 mt-2 flex flex-wrap gap-2">{fixButton(reasonOwner)}</div>
    </div>
  ) : blockerKind === 'operator' && operatorState ? (
    <div className="flex flex-col">
      {slotTitle('fault', operatorState.why.text)}
      {operatorState.held && <p className={slotLine} data-testid="operator-held">{heldText(operatorState.held)}</p>}
      <div className="ml-6 mt-2 flex flex-wrap gap-2">{fixButton('arms')}</div>
    </div>
  ) : blockerKind === 'motion' && qualityFeedback ? (
    <div className="flex flex-col">
      {slotTitle('warn', qualityFeedback.warningMessage ?? 'Motion is jerky.')}
      {(qualityFeedback.suggestions ?? []).slice(0, 2).map((tip) => <p key={tip} className={slotLine}>{tip}</p>)}
    </div>
  ) : null;
  const slotTone: 'fault' | 'warn' = blockerKind === 'degraded' || blockerKind === 'motion' || (showRecovery && !stop) ? 'warn' : 'fault';

  // The cells, with what the page knows live: the lease holder's name and the headset's why line.
  const WHY_STATUS: Record<'block' | 'warn' | 'ok', SystemsCellStatus> = { block: 'fail', warn: 'warn', ok: 'ok' };
  const holderName = lease.holder?.displayName ?? lease.holder?.userId ?? null;
  const stripCells: StripCell[] = recordCells.map((c) => {
    if (c.id === 'control') {
      const first = lease.state !== 'bound' && holderName ? holderName.split(' ')[0] : null;
      return { ...c, value: first ?? c.value, valueTestId: 'control-lease-holder', title: holderName ? `${holderName} has control` : c.value };
    }
    if (c.id === 'arms' && operatorState && operatorInVrNow) {
      const why = operatorState.why;
      return {
        ...c,
        value: why.text.replace(/\.$/, ''),
        status: WHY_STATUS[why.severity],
        valueTestId: 'operator-why',
        valueData: { 'data-severity': why.severity, 'data-code': why.code },
        title: why.text,
      };
    }
    return c;
  });
  const cellReason = (c: StripCell) => (c.reason && !slotShowsReason ? (
    <p
      className={cn('m-0 font-medium', c.reason.severity === 'block' ? 'text-signal-stopped' : 'text-signal-unknown')}
      data-testid="systems-cell-reason"
      data-code={c.reason.code}
    >
      {c.reason.text}
    </p>
  ) : null);
  const rowsFor = (ids: RowId[]) => (robot && readiness ? (
    <RobotReadinessPanel robotId={robot.id} variant="rows" rows={ids} readiness={readinessState} />
  ) : null);
  const recordActions = (only: Array<'start' | 'arm' | 'read_only' | 'logs'>) => (robot ? (
    <div className="flex flex-wrap items-center gap-2">
      <ReadinessActions robotId={robot.id} ready={readinessState} lease={recordLease} only={only} lit={false} />
    </div>
  ) : null);
  const renderCell = (c: StripCell): ReactNode => {
    switch (c.id) {
      case 'robot':
        return (
          <>
            {cellReason(c)}
            <p className="m-0 text-ink-secondary">The bridge, the sidecar and the robot agent run on the robot PC.</p>
            {recordActions(['start', 'logs'])}
            {rowsFor(['preflight', 'link', 'bridge', 'sidecar', 'agent'])}
          </>
        );
      case 'control':
        return (
          <>
            {cellReason(c)}
            {!lease.enabled ? (
              <p className="m-0 text-ink-secondary">This robot runs without control leases: any input drives it.</p>
            ) : leaseInputs && robot ? (
              <div data-testid="session-control-lease">
                <ControlLeaseBar lease={lease} robotId={robot.id} robotName={robotName} connected={leaseConnected} showEstop={false} />
              </div>
            ) : robot ? (
              <>
                <ControlLeaseBar lease={lease} robotId={robot.id} robotName={robotName} connected={false} readOnly showEstop={false} />
                {pageHoldsLease && <PageLeaseLine text={`You have control of ${robotName}.`} onRelease={releaseLease} />}
                {isVrSession && <p className="m-0 text-ink-tertiary">The operator takes control in the headset. This page never takes it from them.</p>}
              </>
            ) : null}
          </>
        );
      case 'arm_control':
        return (
          <>
            {cellReason(c)}
            <p className="m-0 text-ink-secondary">The arms follow the headset only in arm control.</p>
            {recordActions(['arm', 'read_only'])}
            {rowsFor(['sidecar', 'control'])}
          </>
        );
      case 'mode':
        return (
          <>
            {cellReason(c)}
            {showRecovery && modeControl
              ? <p className="m-0 text-ink-secondary">Limp, Stand up and Balance are in the take dock while the robot does not balance.</p>
              : modeControl
                ? <ReparentHost node={modeNode} />
                : <p className="m-0 text-ink-secondary">This robot&apos;s mode cannot be changed from here.</p>}
            {rowsFor(['mode'])}
          </>
        );
      case 'headset': {
        const quest = readiness?.quest ?? null;
        return (
          <>
            {cellReason(c)}
            {operatorInVrNow ? (
              <p className="m-0 text-ink-secondary">{operatorViewer?.displayName ?? 'The operator'} is in VR.</p>
            ) : robot && quest ? (
              <div data-testid="quest-connect-help" data-mode="live">
                <QuestControls robotId={robot.id} quest={quest} sessionId={session.id} port={questPort} />
              </div>
            ) : (
              <QuestConnectHelp location={window.location} robotId={robot?.id} quest={null} sessionId={session.id} />
            )}
            {rowsFor(['quest'])}
          </>
        );
      }
      case 'arms':
        return (
          <>
            {cellReason(c)}
            {operatorState && operatorInVrNow ? (
              <>
                <p className={cn('m-0 font-medium', WHY_CLASS[operatorState.why.severity])}>{operatorState.why.text}</p>
                {operatorState.held && blockerKind !== 'operator' && <p className="m-0 text-ink-tertiary">{heldText(operatorState.held)}</p>}
              </>
            ) : (
              <p className="m-0 text-ink-secondary">The arms follow the operator&apos;s hands while they hold a grip.</p>
            )}
            {rowsFor(['arms'])}
          </>
        );
      case 'hands':
        return (
          <>
            {cellReason(c)}
            {rowsFor(['hand_left', 'hand_right'])}
          </>
        );
      case 'input': {
        const input = preflightItems.find((i) => i.id === 'input');
        return (
          <>
            {cellReason(c)}
            <p className="m-0 text-ink-secondary">{input?.action ?? input?.detail ?? 'The input is not checked.'}</p>
          </>
        );
      }
      case 'cameras':
        return (
          <>
            {cellReason(c)}
            <p className="m-0 text-ink-secondary" data-testid="session-camera-set">
              Every take records {cameraSetLabel(sessionCameras).toLowerCase()}: {(sessionCameras ?? []).map(cameraLabel).join(', ')}.
            </p>
            {wristRow}
          </>
        );
    }
  };

  const quickCheckNode = lastQuickCheck ? (
    <QuickCheckCard
      key={lastQuickCheck.take}
      variant="dock"
      sessionId={session.id}
      quickCheck={lastQuickCheck}
      by={actorTag(episodes.find((e) => e.episodeIndex === lastQuickCheck.take)?.startedBy)}
      onKeep={dismissQuickCheck}
      onDiscard={handleDiscardTake}
    />
  ) : null;

  const recordBlocks = phase === 'record' && (
    <div
      ref={consoleRef}
      className="grid grid-cols-1 gap-3 lg:h-[var(--console-h,640px)] lg:grid-cols-[minmax(0,1fr)_340px] min-[1440px]:grid-cols-[minmax(0,1fr)_380px]"
      data-testid="session-console"
    >
      <section className="flex min-h-0 flex-col rounded-panel border border-line-subtle bg-panel" aria-label="Live view">
        <LiveView
          // Below lg the well keeps 4:3; with the wrist tiles under the main view it is square.
          className={cn('flex-1 rounded-t-[13px] max-lg:flex-none', wristCameras.length > 0 ? 'max-lg:aspect-square' : 'max-lg:aspect-[4/3]')}
          robotId={session.robotId}
          robotType={robotType}
          online={robotOnline}
          live={isTelemetryConnected}
          jointStates={telemetry?.jointStates}
          twinOverlay={twinOverlay}
          cameras={{ names: cameras.cameras, loading: robotOnline && cameras.loading, detail: cameras.detail }}
          wristCameras={wristCameras}
          defaultMain="camera"
          isRecording={capturing || legacyRecording}
          suspended={vrModalOpen}
          bottomLeft={isVrSession ? <OperatorChip operator={operatorState} operatorViewer={operatorViewer} /> : null}
        />
        <SystemsStrip cells={stripCells} renderBody={renderCell} openId={openCell} onOpenChange={setOpenCell} />
      </section>
      <div className="flex min-h-0 flex-col gap-3">
        <TakeDock
          phase={hudPhase}
          take={live ? live.take : isRecording ? currentEpisode : null}
          takeElapsedS={takeMode ? takeElapsedS : isRecording ? sessionElapsedS : null}
          autoStop={autoStopInS !== null ? { inS: autoStopInS, totalS: live?.autoStopS ?? null } : null}
          readouts={{
            duration: isRecording ? formatElapsed(Math.floor(sessionElapsedS)) : formatDuration(session.duration),
            frames: liveFrameCount,
            fps: session.fps,
            fpsActual: isRecording ? live?.fpsActual ?? recordingProgress?.fpsActual : undefined,
            kept,
            streak: streak.current,
            motion: isRecording || isPaused ? qualityFeedback : null,
            live: isRecording,
          }}
          controls={takeControls}
          pending={takePending}
          onStartTake={() => handleStartTake()}
          onStopTake={() => handleStopTake()}
          onNextTake={() => handleNextTake()}
          recovery={recovery}
          blocker={blocker}
          slotTone={slotTone}
          quickCheck={quickCheckNode}
          keepsTake={lastQuickCheck && !lastQuickCheck.discarded ? lastQuickCheck.take : null}
          primaryLit={!(showRecovery && stop)}
          legacy={!takeMode ? {
            recording: isRecording,
            paused: isPaused,
            pending: pending === 'start' || pending === 'pause' ? pending : null,
            nextPending: legacyNextBusy,
            onPause: () => void handlePause(),
            onResume: () => void handleStart(),
            onNextEpisode: () => void legacyNext(),
          } : null}
        />
        <TakesList
          className="lg:flex-1"
          sessionId={session.id}
          episodes={episodes}
          live={live}
          isRecording={isRecording}
          canDiscard={isLive}
          takeElapsedS={takeElapsedS}
          onDiscardTake={(take) => (takeMode ? handleDiscardTake(take) : handleDiscardEpisode(take))}
        />
      </div>
      {modeControl && modeNode && createPortal(modeControl, modeNode)}
    </div>
  );

  // TASK-429: Wrap up is one summary band (the one dataset action), the takes and the details.
  const wrapBlocks = phase === 'wrap' && (
    <SessionCompleted
      session={session}
      robotName={robotName}
      episodes={episodes}
      onEditTask={() => { setAnnotationText(session.languageInstr || ''); setModalError(undefined); setAnnotateOpen(true); }}
      onCreateDataset={openExport}
      onRefetch={refetchCompleted}
    />
  );

  return (
    // max-sm:pb-[88px]: with the shell's 24 px, nothing hides behind the phone's E-STOP dock.
    // The 16 px the section rail needs above the bar below 1440 px is the bar's
    // own margin (SessionCommandBar's SHIM), so it holds in every phase and in
    // the loading skeleton, and is applied nowhere else (TASK-427, TASK-429).
    <div className="flex flex-col gap-3 max-sm:pb-[88px]" data-phase={phase} data-role={deviceRole}>
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
        ? <RobotSetupDisclosure>{phase === 'setup' ? setupBlocks : recordBlocks}</RobotSetupDisclosure>
        : phase === 'setup' ? setupBlocks : recordBlocks}
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
