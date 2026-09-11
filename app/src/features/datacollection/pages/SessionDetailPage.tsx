/**
 * @file SessionDetailPage.tsx
 * @description Session detail and recording cockpit: status-driven acts
 *              (start, pause, resume, end through confirm), live HUD, robot
 *              viewer, cameras, episodes, and the completed-session review.
 * @feature datacollection
 */

import { useState, Suspense, lazy, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowRight, Database, Pause, Play, Plus, Square } from 'lucide-react';
import {
  Button, EmptyState, ErrorState, FormField, FormModal, Input, LinkButton, PageHeader, Panel,
  PipelineBreadcrumb, Skeleton, SkeletonText, StatusTag, Textarea, confirm, toast,
} from '@/shared/components/ui';
import { SessionStatusBadge } from '../components/SessionStatusBadge';
import { QualityIndicator } from '../components/QualityIndicator';
import { CameraStreamView } from '../components/CameraStreamView';
import { SessionStepIndicator } from '../components/SessionStepIndicator';
import { EpisodePanel } from '../components/EpisodePanel';
import { VRSessionPanel } from '../components/VRSessionPanel';
import { SessionHud } from '../components/session/SessionHud';
import { SessionCompleted } from '../components/session/SessionCompleted';
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
import { TELEOPERATION_TYPE_LABELS, formatDuration, canStartSession, canPauseSession, canEndSession } from '../types/datacollection.types';
import { sessionName } from '../utils/sessionFormat';

const Robot3DViewer = lazy(() =>
  import('../../robots/components/visualization/Robot3DViewer').then((m) => ({ default: m.Robot3DViewer }))
);

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
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

  // Episode summaries: fetch on load, poll (3s) while recording.
  const sessionStatus = session?.status;
  useEffect(() => {
    if (!id || !sessionStatus) return;
    storeFetchEpisodes(id);
    if (sessionStatus === 'recording') {
      const timer = setInterval(() => storeFetchEpisodes(id), 3000);
      return () => clearInterval(timer);
    }
  }, [id, sessionStatus, storeFetchEpisodes]);

  // Fallback polling while the WebSocket is down.
  useEffect(() => {
    if (!id || isWsConnected || sessionStatus !== 'recording') return;
    const timer = setInterval(() => fetchSession(), 2500);
    return () => clearInterval(timer);
  }, [id, isWsConnected, sessionStatus, fetchSession]);

  /**
   * Returns whether the boundary was actually drawn. The VR rig buzzes the
   * controller only when it was, so a refused boundary must return false.
   */
  const handleNextEpisode = useCallback(async (): Promise<boolean> => {
    if (!session || session.status !== 'recording') return false;
    try { await storeNextEpisode(session.id); return true; } catch { return false; }
  }, [session, storeNextEpisode]);

  const handleDiscardEpisode = useCallback(async (episodeIndex: number) => {
    if (!session) return;
    try {
      await storeDiscardEpisode(session.id, episodeIndex);
      await fetchSession();
      toast.success('Episode discarded', { description: `Episode ${episodeIndex}` });
    } catch (err) {
      toast.error("Couldn't discard episode", { description: errMsg(err) });
    }
  }, [session, storeDiscardEpisode, fetchSession]);

  const robotName = robot?.name ?? session?.robotId ?? 'the robot';

  const run = async (kind: 'start' | 'pause' | 'end', act: () => Promise<unknown>, ok: string, fail: string) => {
    setPending(kind);
    try { await act(); toast.success(ok); } catch (err) { toast.error(fail, { description: errMsg(err) }); } finally { setPending(null); }
  };

  const handleStart = async () => {
    if (!session) return;
    if (session.status === 'paused') {
      return run('start', () => storeResume(session.id), 'Recording resumed', "Couldn't resume recording");
    }
    const ok = await confirm({
      title: `Start recording on ${robotName}?`,
      description: "The robot follows the operator's input and every frame is captured.",
      confirmLabel: 'Start recording',
    });
    if (ok) await run('start', () => storeStart(session.id), 'Recording started', "Couldn't start recording");
  };

  const handlePause = () => session && run('pause', () => storePause(session.id), 'Session paused', "Couldn't pause session");

  const handleEnd = async () => {
    if (!session) return;
    const ok = await confirm({
      title: 'End this session?',
      description: 'Recording stops and the episodes are saved. You can review them afterwards.',
      confirmLabel: 'End session',
      tone: 'danger',
    });
    if (ok) await run('end', () => storeEnd(session.id), 'Session ended', "Couldn't end session");
  };

  // TASK-117 shortcuts: Space = start/pause, E = end, N = next episode.
  // Ignored inside text fields and while any dialog is open.
  useEffect(() => {
    if (!session) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (canPauseSession(session)) void handlePause();
        else if (canStartSession(session)) void handleStart();
      } else if ((ev.key === 'e' || ev.key === 'E') && canEndSession(session)) {
        ev.preventDefault(); void handleEnd();
      } else if ((ev.key === 'n' || ev.key === 'N') && session.status === 'recording') {
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
  useGamepadJoints({
    robot: gamepadEligible ? robot : null,
    enabled: gamepadEligible && (session?.status === 'recording' || session?.status === 'paused'),
  });

  const handleAnnotate = async () => {
    if (!annotationText.trim()) { setModalError('Describe the task the robot should learn.'); return; }
    setSaving(true); setModalError(undefined);
    try {
      await annotateSession(annotationText.trim());
      toast.success('Task updated', { description: annotationText.trim() });
      setAnnotateOpen(false);
    } catch (err) { setModalError(errMsg(err)); } finally { setSaving(false); }
  };

  const handleExport = async () => {
    setSaving(true); setModalError(undefined);
    try {
      await exportSession({ datasetName: exportName.trim() || undefined });
      toast.success('Dataset created', { description: exportName.trim() || undefined });
      setExportOpen(false); setExportName('');
    } catch (err) { setModalError(errMsg(err)); } finally { setSaving(false); }
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
  const liveFrameCount = isRecording && typeof recordingProgress?.frameCount === 'number' ? recordingProgress.frameCount : session.frameCount;
  const currentEpisode = recordingProgress?.currentEpisode ?? Math.max(0, episodes.length - 1);
  const robotType = (telemetry?.robotType as RobotType) ?? ((robot?.metadata as Record<string, unknown>)?.robotType as RobotType) ?? 'generic';
  const openExport = () => { setModalError(undefined); setExportOpen(true); };

  const actions = (() => {
    if (session.status === 'created') {
      return <Button isLoading={pending === 'start'} leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void handleStart()}>Start recording</Button>;
    }
    const end = (variant: 'danger' | 'secondary') => (
      <Button variant={variant} isLoading={pending === 'end'} leftIcon={<Square className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void handleEnd()}>End session</Button>
    );
    if (isRecording) {
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
        actions={actions}
      >
        <div className="flex flex-col gap-4">
          <PipelineBreadcrumb stage="collect" />
          <SessionStepIndicator session={session} />
        </div>
      </PageHeader>

      {isLive && (
        <SessionHud
          duration={isRecording ? formatElapsed(typeof recordingProgress?.elapsedS === 'number' ? Math.floor(recordingProgress.elapsedS) : elapsedSeconds) : formatDuration(session.duration)}
          frames={liveFrameCount}
          fps={session.fps}
          fpsActual={isRecording ? recordingProgress?.fpsActual : undefined}
          episode={currentEpisode + 1}
          numEpisodes={session.numEpisodes}
          tone={isRecording ? 'live' : undefined}
        />
      )}

      {isRecording && recordingProgress?.degraded && (
        <Panel variant="inset" padding="sm" className="text-[13px] text-ink-secondary">
          <span className="font-medium text-signal-estimated">Frames are being missed.</span> The robot agent is unreachable; retrying automatically.
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
                <CameraStreamView robotId={session.robotId} cameraName="top" label="Top camera" className="h-44" isRecording={isRecording} offline={!robotOnline} />
                <CameraStreamView robotId={session.robotId} cameraName="wrist" label="Wrist camera" className="h-44" isRecording={isRecording} offline={!robotOnline} />
              </Panel.Body>
            </Panel>
          </div>
          <div className="flex flex-col gap-6">
            <EpisodePanel
              episodes={episodes}
              currentEpisode={currentEpisode}
              numEpisodes={session.numEpisodes ?? null}
              isRecording={isRecording}
              canDiscard={isLive}
              onNextEpisode={handleNextEpisode}
              onDiscardEpisode={handleDiscardEpisode}
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
          onNextEpisode={handleNextEpisode}
          // 1-based, matching the HUD; frames are the CURRENT take's count.
          recording={isRecording ? {
            episode: currentEpisode + 1,
            frames: episodes.find((e) => e.episodeIndex === currentEpisode)?.frameCount ?? liveFrameCount,
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
