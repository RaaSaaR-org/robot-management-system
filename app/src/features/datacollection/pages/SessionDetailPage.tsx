/**
 * @file SessionDetailPage.tsx
 * @description Session detail page with live teleop dashboard during recording
 * @feature datacollection
 */

import { useState, Suspense, lazy, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Pause,
  Square,
  Clock,
  Video,
  FileVideo,
  Download,
  Edit2,
  AlertCircle,
  Bot,
  Database,
  Folder,
  Loader2,
  Film,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import { Spinner } from '@/shared/components/ui/Spinner';
import { UI_DATE_LOCALE, formatDateTime } from '@/shared/utils/format';
import { InfoIcon } from '@/shared/components/ui/Tooltip';
import { SessionStatusBadge } from '../components/SessionStatusBadge';
import { QualityIndicator } from '../components/QualityIndicator';
import { CameraStreamView } from '../components/CameraStreamView';
import { SessionStepIndicator } from '../components/SessionStepIndicator';
import { EpisodePanel } from '../components/EpisodePanel';
import { VRSessionPanel } from '../components/VRSessionPanel';
import { useSessionDetail } from '../hooks/datacollection';
import { useTeleopEvents } from '../hooks/useTeleopEvents';
import { useDataCollectionStore } from '../store/datacollectionStore';
import { useRobotsStore } from '../../robots/store/robotsStore';
import { useTelemetryStream } from '../../robots/hooks/useTelemetryStream';
import { JointStateGrid } from '../../robots/components/visualization';
import { KeyboardTeleopSection } from '../../robots/components/tabs/TeleopTab';
import { useGamepadJoints } from '../hooks/useGamepadJoints';
import { jointPositionUnit } from '../../robots/types/robots.types';
import type { RobotType } from '../../robots/types/robots.types';
import {
  TELEOPERATION_TYPE_LABELS,
  formatDuration,
  canStartSession,
  canPauseSession,
  canEndSession,
  formatEpisodeStat,
  formatRetargetModes,
} from '../types/datacollection.types';

const Robot3DViewer = lazy(() =>
  import('../../robots/components/visualization/Robot3DViewer').then((m) => ({ default: m.Robot3DViewer }))
);

// ============================================================================
// COMPONENT
// ============================================================================

export function SessionDetailPage() {
  const { sessionId: id } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  // Session data
  const { session, isLoading, error, annotateSession, exportSession, fetchSession } =
    useSessionDetail(id!);
  const qualityFeedback = useDataCollectionStore((state) => state.qualityFeedback);
  const episodes = useDataCollectionStore((state) => state.episodes);
  const recordingProgress = useDataCollectionStore((state) => state.recordingProgress);
  const storeStartSession = useDataCollectionStore((state) => state.startSession);
  const storePauseSession = useDataCollectionStore((state) => state.pauseSession);
  const storeResumeSession = useDataCollectionStore((state) => state.resumeSession);
  const storeEndSession = useDataCollectionStore((state) => state.endSession);
  const storeFetchEpisodes = useDataCollectionStore((state) => state.fetchEpisodes);
  const storeNextEpisode = useDataCollectionStore((state) => state.nextEpisode);
  const storeDiscardEpisode = useDataCollectionStore((state) => state.discardEpisode);

  // Live progress via the app WebSocket (teleop:* events); REST polling backs
  // it up while the socket is down.
  const { isConnected: isWsConnected } = useTeleopEvents();

  // Robot data for live telemetry + keyboard teleop
  const robots = useRobotsStore((state) => state.robots);
  const fetchRobots = useRobotsStore((state) => state.fetchRobots);
  const robot = robots.find((r) => r.id === session?.robotId) ?? null;

  useEffect(() => {
    if (robots.length === 0) fetchRobots();
  }, [robots.length, fetchRobots]);

  // Live telemetry
  const { telemetry, isConnected: isTelemetryConnected } = useTelemetryStream(
    session?.robotId ?? '',
    { autoConnect: !!session && (session.status === 'recording' || session.status === 'paused' || session.status === 'created') }
  );

  // UI state
  const [showAnnotateModal, setShowAnnotateModal] = useState(false);
  const [annotationText, setAnnotationText] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportName, setExportName] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live elapsed timer during recording
  useEffect(() => {
    if (session?.status === 'recording' && session.startedAt) {
      const startTime = new Date(session.startedAt).getTime();
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsedSeconds(0);
    }
  }, [session?.status, session?.startedAt]);

  const formatElapsed = useCallback((secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, []);

  // Episode summaries: fetch on load and poll (3s) while recording so frame
  // counts tick up. After completion one final fetch covers the Review step.
  const sessionStatus = session?.status;
  useEffect(() => {
    if (!id || !sessionStatus) return;
    storeFetchEpisodes(id);
    if (sessionStatus === 'recording') {
      const timer = setInterval(() => storeFetchEpisodes(id), 3000);
      return () => clearInterval(timer);
    }
  }, [id, sessionStatus, storeFetchEpisodes]);

  // Fallback polling while the WebSocket is down: refresh the session (frame
  // count, status) every 2.5s during recording.
  useEffect(() => {
    if (!id || isWsConnected || sessionStatus !== 'recording') return;
    const timer = setInterval(() => fetchSession(), 2500);
    return () => clearInterval(timer);
  }, [id, isWsConnected, sessionStatus, fetchSession]);

  /**
   * Returns whether the boundary was actually drawn.
   *
   * The VR rig buzzes the controller on the way back, and a buzz is a promise:
   * an operator who feels it stops watching and starts the next take. Buzzing
   * for a refused boundary — the session is paused, the robot said no — would
   * be worse than not buzzing at all.
   */
  const handleNextEpisode = useCallback(async (): Promise<boolean> => {
    if (!session || session.status !== 'recording') return false;
    try {
      await storeNextEpisode(session.id);
      return true;
    } catch {
      /* surfaced via store error */
      return false;
    }
  }, [session, storeNextEpisode]);

  const handleDiscardEpisode = useCallback(
    async (episodeIndex: number) => {
      if (!session) return;
      try {
        await storeDiscardEpisode(session.id, episodeIndex);
        await fetchSession(); // refresh frameCount
      } catch {
        /* surfaced via store error */
      }
    },
    [session, storeDiscardEpisode, fetchSession]
  );

  const handleBack = () => navigate('/data-collection');

  const handleStart = async () => {
    if (!session) return;
    setActionLoading(true);
    try {
      const isPaused = session.status === 'paused';
      if (isPaused) await storeResumeSession(session.id);
      else await storeStartSession(session.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePause = async () => {
    if (!session) return;
    setActionLoading(true);
    try { await storePauseSession(session.id); } finally { setActionLoading(false); }
  };

  const handleEnd = async () => {
    if (!session) return;
    setActionLoading(true);
    try {
      await storeEndSession(session.id);
    } finally {
      setActionLoading(false);
    }
  };

  // TASK-117: keyboard shortcuts on the record page.
  // Space  → Start (or Pause if already recording)
  // E      → End the session
  // Shortcuts ignore key events that originate inside text inputs so they
  // don't fight the modal forms (annotate / export).
  useEffect(() => {
    if (!session) return;
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (showAnnotateModal || showExportModal) return;

      if (ev.code === 'Space') {
        ev.preventDefault();
        if (canPauseSession(session)) {
          handlePause();
        } else if (canStartSession(session)) {
          handleStart();
        }
      } else if (ev.key === 'e' || ev.key === 'E') {
        if (canEndSession(session)) {
          ev.preventDefault();
          handleEnd();
        }
      } else if (ev.key === 'n' || ev.key === 'N') {
        if (session.status === 'recording') {
          ev.preventDefault();
          handleNextEpisode();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // We intentionally re-bind whenever the session status changes so the
    // canStart/canPause/canEnd predicates pick up the new state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, showAnnotateModal, showExportModal]);

  // TASK-117: gamepad fallback. Forwards left/right stick to the same
  // /ws/keyboard-teleop sidecar WebSocket the keyboard fallback uses, so
  // operators without a leader arm or keyboard can still drive the
  // follower with a controller while recording.
  const gamepadEligible = !!robot && !!session && (
    session.type === 'gamepad'
    || session.type === 'keyboard_mouse'
    || session.type === 'bilateral_aloha'
  );
  const gamepadActive = gamepadEligible
    && (session?.status === 'recording' || session?.status === 'paused');
  useGamepadJoints({
    robot: gamepadEligible ? robot : null,
    enabled: gamepadActive,
  });

  const handleAnnotate = async () => {
    if (!annotationText.trim()) return;
    setActionLoading(true);
    try {
      await annotateSession(annotationText);
      setShowAnnotateModal(false);
      setAnnotationText('');
    } finally { setActionLoading(false); }
  };

  const handleExport = async () => {
    setActionLoading(true);
    try {
      await exportSession({ datasetName: exportName || undefined });
      setShowExportModal(false);
      setExportName('');
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 5000);
    } finally { setActionLoading(false); }
  };

  // Loading / error states
  if (isLoading && !session) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" color="cobalt" />
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <h2 className="text-xl font-semibold text-theme-primary mb-2">
          Error Loading Session
        </h2>
        <p className="text-theme-muted mb-4">{error}</p>
        <button
          onClick={handleBack}
          className="px-4 py-2 rounded-brand text-sm font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all"
        >
          Back to Sessions
        </button>
      </div>
    );
  }

  if (!session) return null;

  const isRecording = session.status === 'recording';
  const isPaused = session.status === 'paused';
  const isCompleted = session.status === 'completed';
  const isLive = isRecording || isPaused || session.status === 'created';
  const isVrSession = session.type === 'vr_quest' || session.type === 'vr_vision_pro';
  const canDiscardEpisodes = isLive; // created / recording / paused — before export
  const liveFrameCount =
    isRecording && typeof recordingProgress?.frameCount === 'number'
      ? recordingProgress.frameCount
      : session.frameCount;
  const currentEpisode = recordingProgress?.currentEpisode ?? Math.max(0, episodes.length - 1);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-glass-subtle rounded-brand transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-theme-muted" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-theme-primary">
                {session.languageInstr || TELEOPERATION_TYPE_LABELS[session.type]}
              </h1>
              <SessionStatusBadge status={session.status} showPulse={isRecording} />
              {isTelemetryConnected && (
                <span className="flex items-center gap-1 text-xs text-green-500">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Live
                </span>
              )}
            </div>
            <p className="text-theme-muted mt-0.5 text-sm">
              {TELEOPERATION_TYPE_LABELS[session.type]} — {robot?.name ?? session.robotId}
            </p>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center gap-2">
          {canStartSession(session) && !isRecording && (
            <button
              onClick={handleStart}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-brand text-sm font-medium bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20 transition-all disabled:opacity-50"
            >
              <Play size={16} />
              {isPaused ? 'Resume' : 'Start'}
            </button>
          )}
          {canPauseSession(session) && (
            <button
              onClick={handlePause}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-brand text-sm font-medium bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 border border-yellow-500/20 transition-all disabled:opacity-50"
            >
              <Pause size={18} />
              Pause
            </button>
          )}
          {canEndSession(session) && (
            <button
              onClick={handleEnd}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-brand text-sm font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20 transition-all disabled:opacity-50"
            >
              {actionLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Square size={18} />
                  End
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Step indicator: Connect input → Record episodes → Review → Export */}
      <SessionStepIndicator session={session} />

      {/* Quality Feedback (during recording) */}
      {(isRecording || isPaused) && (
        <QualityIndicator feedback={qualityFeedback} className="mb-0" />
      )}

      {/* Recorder degraded warning */}
      {isRecording && recordingProgress?.degraded && (
        <Card variant="subtle" className="!bg-yellow-500/10 border border-yellow-500/20">
          <div className="flex items-center gap-3 px-4 py-3 text-yellow-400 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            Robot agent unreachable — frames are being missed. Retrying automatically.
          </div>
        </Card>
      )}

      {/* Stats Grid — live HUD while recording */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-brand bg-cobalt-500/10">
              <Clock className="w-5 h-5 text-cobalt-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm text-theme-muted">Duration</p>
                <InfoIcon content="Total recording time for this session, excluding pauses when the live recorder reports it." size={12} />
              </div>
              <p className="text-xl font-bold text-theme-primary" data-testid="hud-duration">
                {isRecording
                  ? formatElapsed(
                      typeof recordingProgress?.elapsedS === 'number'
                        ? Math.floor(recordingProgress.elapsedS)
                        : elapsedSeconds
                    )
                  : formatDuration(session.duration)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-brand bg-turquoise-500/10">
              <FileVideo className="w-5 h-5 text-turquoise-400" />
            </div>
            <div>
              <p className="text-sm text-theme-muted">Frames</p>
              <p className="text-xl font-bold text-theme-primary" data-testid="hud-frames">
                {liveFrameCount.toLocaleString(UI_DATE_LOCALE)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-brand bg-green-500/10">
              <Video className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm text-theme-muted">FPS</p>
                <InfoIcon content="Target recording rate. While recording, the measured actual rate is shown next to it." size={12} />
              </div>
              <p className="text-xl font-bold text-theme-primary" data-testid="hud-fps">
                {session.fps}
                {isRecording && typeof recordingProgress?.fpsActual === 'number' && (
                  <span className="ml-1.5 text-sm font-medium text-theme-muted">
                    ({recordingProgress.fpsActual.toFixed(1)} actual)
                  </span>
                )}
              </p>
            </div>
          </div>
        </Card>

        {isLive ? (
          <Card className="!p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-brand bg-primary-500/10">
                <Film className="w-5 h-5 text-primary-400" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm text-theme-muted">Episode</p>
                  <InfoIcon content="Episode currently being recorded. Press N to move to the next episode." size={12} />
                </div>
                <p className="text-xl font-bold text-theme-primary" data-testid="hud-episode">
                  {currentEpisode + 1}
                  {session.numEpisodes ? (
                    <span className="text-sm font-medium text-theme-muted"> of {session.numEpisodes}</span>
                  ) : null}
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="!p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-brand bg-accent-500/10">
                <Bot className="w-5 h-5 text-accent-400" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm text-theme-muted">Quality</p>
                  <InfoIcon content="Overall quality score based on smoothness, jerkiness, and frame consistency. Higher is better." size={12} />
                </div>
                <p className="text-xl font-bold text-theme-primary">
                  {session.qualityScore ? `${session.qualityScore}%` : '-'}
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* ================================================================ */}
      {/* LIVE TELEOP VIEW (recording / paused / created) */}
      {/* ================================================================ */}
      {isLive && (
        <div className="space-y-4">
          {/* Row 1: 3D Model + Cameras */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 3D Viewer */}
            <Card className="overflow-hidden !p-0">
              <div className="px-4 py-2 border-b border-glass-subtle flex items-center justify-between">
                <h3 className="text-sm font-medium text-theme-secondary">3D Model</h3>
                <span className="text-xs text-theme-muted">{(telemetry?.robotType as string)?.toUpperCase() ?? ''}</span>
              </div>
              <div className="h-[300px]">
                <Suspense fallback={<div className="flex items-center justify-center h-full"><Spinner size="md" color="cobalt" /></div>}>
                  <Robot3DViewer
                    robotType={(telemetry?.robotType as RobotType) ?? (robot?.metadata as Record<string, unknown>)?.robotType as RobotType ?? 'generic'}
                    jointStates={telemetry?.jointStates}
                    isAnimating={isTelemetryConnected}
                  />
                </Suspense>
              </div>
            </Card>

            {/* Cameras */}
            <div className="grid grid-rows-2 gap-2">
              <CameraStreamView robotId={session.robotId} cameraName="top" label="Top Camera" className="h-[146px]" isRecording={isRecording} />
              <CameraStreamView robotId={session.robotId} cameraName="wrist" label="Wrist Camera" className="h-[146px]" isRecording={isRecording} />
            </div>
          </div>

          {/* Row 2: Joint States + Episodes */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Joint States */}
            <Card>
              <h3 className="text-sm font-medium text-theme-secondary mb-3">Joint States</h3>
              <JointStateGrid
                jointStates={telemetry?.jointStates ?? []}
                columns={2}
                positionUnit={jointPositionUnit(
                  telemetry?.robotType ?? (robot?.metadata as Record<string, unknown> | undefined)?.robotType
                )}
              />
            </Card>

            {/* Episode controls: next episode, per-episode discard, target progress */}
            <EpisodePanel
              episodes={episodes}
              currentEpisode={currentEpisode}
              numEpisodes={session.numEpisodes ?? null}
              isRecording={isRecording}
              canDiscard={canDiscardEpisodes}
              onNextEpisode={handleNextEpisode}
              onDiscardEpisode={handleDiscardEpisode}
            />
          </div>

          {/* Row 3: Input control surface */}
          {isVrSession ? (
            /* VR sessions: WebXR rig + synthetic-input toggle + collapsed keyboard fallback */
            <VRSessionPanel
              robot={robot}
              onNextEpisode={handleNextEpisode}
              // 1-based, matching the "Recording episode N of M" readout above —
              // the last number the operator saw before the headset went on. The
              // review table's `Ep 0` is a 0-based storage index and is a
              // different thing.
              recording={
                isRecording
                  ? {
                      episode: currentEpisode + 1,
                      // The CURRENT episode's frames, not the session's. The
                      // HUD reads `ep 2 · 412 fr`, and 412 has to be this
                      // take's count or the two halves of that line contradict
                      // each other.
                      frames:
                        episodes.find((e) => e.episodeIndex === currentEpisode)?.frameCount ??
                        liveFrameCount,
                    }
                  : null
              }
            />
          ) : (
            /*
              Keyboard / gamepad fallback for sessions where the operator
              has no leader-arm hardware. Always rendered for the keyboard
              and gamepad session types, and additionally surfaced for
              bilateral_aloha as a fallback if the leader USB is missing
              (TASK-117 — "Keyboard-Fallback ohne Leader Arm").
            */
            (session.type === 'keyboard_mouse'
              || session.type === 'gamepad'
              || session.type === 'bilateral_aloha') && (
              <Card>
                <h3 className="text-sm font-medium text-theme-secondary mb-3">Manual Control (Fallback)</h3>
                {robot ? (
                  <KeyboardTeleopSection robot={robot} />
                ) : (
                  <p className="text-sm text-theme-muted">Robot not connected</p>
                )}
              </Card>
            )
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* COMPLETED VIEW — recording summary + dataset info */}
      {/* ================================================================ */}
      {isCompleted && (
        <div className="space-y-4">
          {/* Session warnings (e.g. zero frames recorded, export failure) */}
          {session.errorMessage && (
            <Card variant="subtle" className="!bg-yellow-500/10 border border-yellow-500/20">
              <div className="flex items-center gap-3 px-4 py-3 text-yellow-400 text-sm" data-testid="session-warning">
                <AlertCircle size={16} className="shrink-0" />
                {session.errorMessage}
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recording Summary */}
            <Card>
              <h2 className="font-semibold text-theme-primary mb-4">Recording Summary</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-theme-muted">Task</dt>
                  <dd className="text-theme-primary font-medium italic">
                    {session.languageInstr || 'No description'}
                    <button onClick={() => { setAnnotationText(session.languageInstr || ''); setShowAnnotateModal(true); }}
                      className="ml-2 text-theme-muted hover:text-theme-secondary"><Edit2 size={12} /></button>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-theme-muted">Duration</dt>
                  <dd className="text-theme-primary">{formatDuration(session.duration)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-theme-muted">Frames</dt>
                  <dd className="text-theme-primary">{session.frameCount.toLocaleString(UI_DATE_LOCALE)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-theme-muted">FPS</dt>
                  <dd className="text-theme-primary">{session.fps}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-theme-muted">Quality Score</dt>
                  <dd className="text-theme-primary font-bold">
                    {session.qualityScore ? `${session.qualityScore}%` : 'Not computed'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-theme-muted">Robot</dt>
                  <dd className="text-theme-primary">{robot?.name ?? session.robotId}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-theme-muted">Created</dt>
                  <dd className="text-theme-primary">{formatDateTime(session.createdAt)}</dd>
                </div>
              </dl>
            </Card>

            {/* Dataset Info */}
            <Card>
              <h2 className="font-semibold text-theme-primary mb-4">Dataset</h2>
              {session.exportedDatasetId ? (
                <div className="space-y-3" data-testid="dataset-card">
                  <div className="flex items-center gap-2 text-green-400 mb-3">
                    <Database size={18} />
                    <span className="font-medium">Exported successfully</span>
                  </div>
                  <div className="text-sm space-y-2">
                    <div className="flex items-center gap-2 text-theme-muted">
                      <Folder size={14} />
                      <span className="font-mono text-xs">{session.exportedDatasetId}</span>
                    </div>
                  </div>
                  <button onClick={() => navigate(`/datasets/${session.exportedDatasetId}/episodes`)}
                    data-testid="open-dataset"
                    className="mt-4 w-full px-4 py-2 rounded-brand text-sm font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all">
                    Open in Datasets
                  </button>
                  <p className="text-xs text-theme-tertiary">
                    Tip: use the episode viewer's curation tools (trim / delete / AI suggest) to
                    clean the dataset before training.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-theme-muted">Recording ready to be packed into a dataset.</p>
                  {!!(session as unknown as Record<string, unknown>).sidecarDatasetPath && (
                    <div className="flex items-center gap-2 text-xs text-theme-muted">
                      <Folder size={14} />
                      <span className="font-mono">{String((session as unknown as Record<string, unknown>).sidecarDatasetPath)}</span>
                    </div>
                  )}
                  <button onClick={() => setShowExportModal(true)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-brand text-sm font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all">
                    <Download size={16} /> Pack into Dataset
                  </button>
                </div>
              )}
            </Card>
          </div>

          {/* Review: per-episode summary table */}
          {episodes.length > 0 && (
            <Card data-testid="review-episodes">
              <h2 className="font-semibold text-theme-primary mb-4">Episodes</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-theme-muted border-b border-glass-subtle">
                      <th className="pb-2 pr-4 font-medium">Episode</th>
                      <th className="pb-2 pr-4 font-medium">Frames</th>
                      <th className="pb-2 pr-4 font-medium">Dropped</th>
                      <th className="pb-2 pr-4 font-medium">fps</th>
                      <th className="pb-2 pr-4 font-medium">Duration</th>
                      <th className="pb-2 pr-4 font-medium">Start</th>
                      {/* How the demonstration was DRIVEN. It belongs next to
                          the frame counts because it is the same kind of fact:
                          something about this take that cannot be recovered
                          from the frames afterwards. */}
                      <th className="pb-2 font-medium">Input</th>
                    </tr>
                  </thead>
                  <tbody>
                    {episodes.map((ep) => (
                      <tr key={ep.episodeIndex} className="border-b border-glass-subtle last:border-0">
                        <td className="py-2 pr-4 font-mono font-semibold text-theme-primary">
                          Ep {ep.episodeIndex}
                        </td>
                        <td className="py-2 pr-4 text-theme-secondary">
                          {ep.frameCount.toLocaleString(UI_DATE_LOCALE)}
                        </td>
                        {/* Yellow only when frames were actually lost. An
                            em-dash means the episode predates TASK-215 and never
                            counted, which is not the same claim as "none". */}
                        <td
                          className={`py-2 pr-4 ${
                            (ep.droppedFrames ?? 0) > 0 ? 'text-yellow-400' : 'text-theme-secondary'
                          }`}
                        >
                          {formatEpisodeStat(ep.droppedFrames)}
                        </td>
                        <td className="py-2 pr-4 text-theme-secondary">
                          {formatEpisodeStat(ep.fpsActual, 1)}
                        </td>
                        <td className="py-2 pr-4 text-theme-secondary">{ep.durationS.toFixed(1)}s</td>
                        <td className="py-2 pr-4 text-theme-muted">{ep.startTime.toFixed(1)}s</td>
                        <td
                          className="py-2 font-mono text-xs text-theme-muted"
                          data-testid={`episode-input-${ep.episodeIndex}`}
                        >
                          {formatRetargetModes(ep.retargetModes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {exportSuccess && (
            <Card variant="subtle" className="!bg-green-500/10 border border-green-500/20">
              <p className="text-green-400 font-medium text-sm px-4 py-3">
                Dataset created successfully!
              </p>
            </Card>
          )}
        </div>
      )}

      {/* Annotate Modal */}
      {showAnnotateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-theme-primary mb-4">
              Edit Task Description
            </h3>
            <textarea
              value={annotationText}
              onChange={(e) => setAnnotationText(e.target.value)}
              rows={4}
              placeholder="Describe the task..."
              className="w-full rounded-brand border border-theme bg-theme-card px-3 py-2.5 text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowAnnotateModal(false)}
                className="px-4 py-2 text-theme-secondary hover:text-theme-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAnnotate}
                disabled={actionLoading}
                className="px-4 py-2 rounded-brand text-sm font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all disabled:opacity-50"
              >
                {actionLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-theme-primary mb-4">
              Export Session
            </h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-theme-secondary mb-1.5">
                Dataset Name (optional)
              </label>
              <input
                type="text"
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                placeholder="Leave empty for auto-generated name"
                className="w-full rounded-brand border border-theme bg-theme-card px-3 py-2.5 text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 text-theme-secondary hover:text-theme-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={actionLoading}
                className="px-4 py-2 rounded-brand text-sm font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all disabled:opacity-50"
              >
                {actionLoading ? 'Exporting...' : 'Export'}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

