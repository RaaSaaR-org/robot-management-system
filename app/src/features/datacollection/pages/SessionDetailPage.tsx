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
 * @feature datacollection
 */

import { useState, Suspense, lazy, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowRight, Database, Pause, Play, Plus, Square } from 'lucide-react';
import {
  Button, EmptyState, ErrorState, FormField, FormModal, Input, LinkButton, PageHeader, Panel,
  Skeleton, SkeletonText, StatusTag, Textarea, confirm, errorMessage, toast,
} from '@/shared/components/ui';
import { SessionStatusBadge } from '../components/SessionStatusBadge';
import { QualityIndicator } from '../components/QualityIndicator';
import { CameraStreamView } from '../components/CameraStreamView';
import { SessionStepIndicator } from '../components/SessionStepIndicator';
import { EpisodePanel } from '../components/EpisodePanel';
import { PreflightChecklist } from '../components/PreflightChecklist';
import { VRSessionPanel } from '../components/VRSessionPanel';
import { SessionHud, type HudPhase } from '../components/session/SessionHud';
import { SessionCompleted } from '../components/session/SessionCompleted';
import { QuickCheckCard } from '../components/session/QuickCheckCard';
import { SessionEStopButton } from '../components/session/SessionEStopButton';
import { isDialogOpen, isTypingTarget } from '../utils/hotkeys';
import { isCueMuted, scheduleAutoStopWarning, setCueMuted, subscribeCueMuted } from '@/shared/utils/sessionCues';
import { useSessionDetail } from '../hooks/datacollection';
import { useTeleopEvents } from '../hooks/useTeleopEvents';
import { useDataCollectionStore, selectKept, selectTakeElapsedS } from '../store/datacollectionStore';
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
const BACK = { to: '/data-collection', label: 'Data collection' };

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
  const [showManual, setShowManual] = useState(false);
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
   * The headset's one button. Returns whether the boundary was actually drawn:
   * the VR rig buzzes the controller only when it was, so a refused boundary
   * must return false. Between takes it starts one; while recording it moves
   * to the next. Recorders without explicit takes keep the old boundary.
   */
  const handleNextEpisode = useCallback(async (): Promise<boolean> => {
    if (!session || session.status !== 'recording') return false;
    if (takeMode) {
      return live?.phase === 'capturing' ? storeNextTake(session.id, 'vr') : storeStartTake(session.id, 'vr');
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

  const run = async (kind: 'start' | 'pause' | 'end', act: () => Promise<unknown>, ok: string, fail: string) => {
    setPending(kind);
    try { await act(); toast.success(ok); } catch (err) { toast.error(fail, { description: errorMessage(err) }); } finally { setPending(null); }
  };

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
    if (ok) await run('end', () => storeEnd(session.id), 'Session ended', "Couldn't end session");
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
  const { lease, connected: leaseConnected } = useSessionControlLease(
    session?.robotId ?? '',
    robot?.a2aAgentUrl,
    robotOnline && sessionIsLive && leaseInputs,
  );
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
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Build" back={BACK} title={error && !isLoading ? 'Session' : 'Loading…'} />
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

  const actions = (() => {
    if (session.status === 'created') {
      return (
        <Button
          isLoading={pending === 'start'}
          disabled={preflight.blocking}
          title={preflight.blocking ? preflight.next : undefined}
          leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />}
          onClick={() => void handleStart()}
        >
          Start session
        </Button>
      );
    }
    const end = (variant: 'danger' | 'secondary') => (
      <Button variant={variant} isLoading={pending === 'end'} leftIcon={<Square className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void handleEnd()}>End session</Button>
    );
    if (isRecording) {
      // Between takes IS the pause for a recorder with explicit takes (TASK-408 D6).
      if (takeMode) return end('secondary');
      return <><Button variant="secondary" isLoading={pending === 'pause'} leftIcon={<Pause className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void handlePause()}>Pause</Button>{end('danger')}</>;
    }
    if (isPaused) {
      return <>{end('secondary')}<Button isLoading={pending === 'start'} leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void handleStart()}>Resume</Button></>;
    }
    if (isCompleted && session.exportedDatasetId) {
      return <LinkButton to={`/datasets/${session.exportedDatasetId}/episodes`} rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.75} />}>Open dataset</LinkButton>;
    }
    if (isCompleted && session.frameCount === 0) {
      return <LinkButton to="/data-collection/new" leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}>New session</LinkButton>;
    }
    if (isCompleted) return <Button leftIcon={<Database className="h-4 w-4" strokeWidth={1.75} />} onClick={openExport}>Create dataset</Button>;
    return null;
  })();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        back={BACK}
        title={sessionName(session)}
        description={`${robotName} · ${TELEOPERATION_TYPE_LABELS[session.type]}`}
        meta={<>
          <SessionStatusBadge status={session.status} showPulse={isRecording} />
          {isSim && <StatusTag tone="sim">Sim</StatusTag>}
          {isTelemetryConnected && <StatusTag tone="live" dot pulse>Live</StatusTag>}
        </>}
        actions={<>
          <SessionEStopButton robotId={session.robotId} robotName={robotName} />
          {actions}
        </>}
      >
        <SessionStepIndicator session={session} />
      </PageHeader>

      {isLive && (
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
          muted={muted}
          onToggleMute={() => setCueMuted(!muted)}
          tone={isRecording ? 'live' : undefined}
        />
      )}

      {isLive && lastQuickCheck && (
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

      {isCreated && <PreflightChecklist items={preflightItems} summary={preflight} />}

      {isLive && lease.enabled && leaseInputs && robot && (
        <Panel data-testid="session-control-lease">
          <Panel.Header title="Control" description="Gamepad and simulated VR input drive the robot only while you hold control." />
          <Panel.Body>
            <ControlLeaseBar lease={lease} robotId={robot.id} robotName={robotName} connected={leaseConnected} />
          </Panel.Body>
        </Panel>
      )}

      {isLive && isVrSession && modeControlOn && robot && (
        <Panel data-testid="session-robot-mode">
          <Panel.Header
            title="Robot mode"
            description="Limp, Stand up and Balance without the remote. The changes need control — take it in the VR window (or here, for simulated input)."
          />
          <Panel.Body>
            <RobotModeControl robotId={robot.id} lease={lease} baseMode={baseMode} />
          </Panel.Body>
        </Panel>
      )}

      {isLive && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="flex flex-col gap-6 xl:col-span-2">
            <Panel padding="none">
              <Panel.Header title="Robot" description={robotOnline ? robotType.toUpperCase() : undefined} />
              {robotOnline ? (
                <div className="h-64 sm:h-80">
                  <Suspense fallback={<Skeleton className="h-full w-full" />}>
                    <Robot3DViewer robotType={robotType} jointStates={telemetry?.jointStates} isAnimating={isTelemetryConnected} />
                  </Suspense>
                </div>
              ) : (
                <EmptyState size="sm" title="Robot offline" description="Start the robot agent to see the live model." />
              )}
            </Panel>
            <Panel>
              <Panel.Header title="Cameras" />
              <Panel.Body className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {robotOnline && cameras.loading ? (
                  <Skeleton className="h-44 w-full sm:col-span-2" />
                ) : robotOnline && cameras.cameras.length === 0 ? (
                  <EmptyState
                    size="sm"
                    className="sm:col-span-2"
                    title="No camera"
                    description={cameras.detail ? `The robot serves no camera: ${cameras.detail}` : 'The robot serves no camera. Episodes record without video.'}
                  />
                ) : (
                  (cameras.cameras.length > 0 ? cameras.cameras.slice(0, 4) : ['top', 'wrist']).map((name) => (
                    <CameraStreamView
                      key={name}
                      robotId={session.robotId}
                      cameraName={name}
                      label={cameraLabel(name)}
                      className="h-44"
                      isRecording={isRecording}
                      offline={!robotOnline}
                    />
                  ))
                )}
              </Panel.Body>
            </Panel>
          </div>
          {/* Takes first below xl: on a tablet the controls must not sit under the 3D view. */}
          <div className="order-first flex flex-col gap-6 xl:order-none">
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
            <Panel>
              <Panel.Header title="Quality" />
              <Panel.Body><QualityIndicator feedback={isRecording || isPaused ? qualityFeedback : null} /></Panel.Body>
            </Panel>
          </div>
        </div>
      )}

      {isLive && isVrSession && (
        <VRSessionPanel
          robot={robot}
          lease={lease}
          simulate={simulateVr}
          onSimulateChange={setSimulateVr}
          onNextEpisode={handleNextEpisode}
          // 1-based, matching the HUD; frames are the CURRENT take's count.
          recording={isRecording ? {
            episode: currentEpisode + 1,
            frames: live ? live.takeFrames : episodes.find((e) => e.episodeIndex === currentEpisode)?.frameCount ?? liveFrameCount,
          } : null}
        />
      )}

      {isLive && !isVrSession && (
        <Panel>
          <Panel.Header
            title="Manual control"
            description="Keyboard or gamepad fallback, and the live joint states."
            actions={<Button variant="ghost" size="sm" onClick={() => setShowManual((v) => !v)}>{showManual ? 'Hide' : 'Show'}</Button>}
          />
          {showManual && (
            <Panel.Body className="flex flex-col gap-6">
              {robot && gamepadEligible && <KeyboardTeleopSection robot={robot} />}
              <JointStateGrid
                jointStates={telemetry?.jointStates ?? []}
                columns={2}
                positionUnit={jointPositionUnit(telemetry?.robotType ?? (robot?.metadata as Record<string, unknown> | undefined)?.robotType)}
              />
            </Panel.Body>
          )}
        </Panel>
      )}

      {isCompleted && (
        <SessionCompleted
          session={session}
          robotName={robotName}
          episodes={episodes}
          onEditTask={() => { setAnnotationText(session.languageInstr || ''); setModalError(undefined); setAnnotateOpen(true); }}
          onCreateDataset={openExport}
        />
      )}

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
