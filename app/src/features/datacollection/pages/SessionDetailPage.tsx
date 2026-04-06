/**
 * @file SessionDetailPage.tsx
 * @description Session detail page with live teleop dashboard during recording
 * @feature datacollection
 */

import { useState, Suspense, lazy, useEffect } from 'react';
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
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import { Spinner } from '@/shared/components/ui/Spinner';
import { InfoIcon } from '@/shared/components/ui/Tooltip';
import { SessionStatusBadge } from '../components/SessionStatusBadge';
import { QualityIndicator } from '../components/QualityIndicator';
import { CameraStreamView } from '../components/CameraStreamView';
import { useSessionDetail } from '../hooks/datacollection';
import { useDataCollectionStore } from '../store/datacollectionStore';
import { useRobotsStore } from '../../robots/store/robotsStore';
import { useTelemetryStream } from '../../robots/hooks/useTelemetryStream';
import { JointStateGrid } from '../../robots/components/visualization';
import { KeyboardTeleopSection } from '../../robots/components/tabs/TeleopTab';
import type { RobotType } from '../../robots/types/robots.types';
import {
  TELEOPERATION_TYPE_LABELS,
  formatDuration,
  canStartSession,
  canPauseSession,
  canEndSession,
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
  const { session, isLoading, error, annotateSession, exportSession } = useSessionDetail(id!);
  const qualityFeedback = useDataCollectionStore((state) => state.qualityFeedback);
  const storeStartSession = useDataCollectionStore((state) => state.startSession);
  const storePauseSession = useDataCollectionStore((state) => state.pauseSession);
  const storeResumeSession = useDataCollectionStore((state) => state.resumeSession);
  const storeEndSession = useDataCollectionStore((state) => state.endSession);

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
    try { await storeEndSession(session.id); } finally { setActionLoading(false); }
  };

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
              <Square size={18} />
              End
            </button>
          )}
        </div>
      </div>

      {/* Quality Feedback (during recording) */}
      {(isRecording || isPaused) && (
        <QualityIndicator feedback={qualityFeedback} className="mb-0" />
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-brand bg-cobalt-500/10">
              <Clock className="w-5 h-5 text-cobalt-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm text-theme-muted">Duration</p>
                <InfoIcon content="Total recording time for this session, including pauses." size={12} />
              </div>
              <p className="text-xl font-bold text-theme-primary">
                {formatDuration(session.duration)}
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
              <p className="text-xl font-bold text-theme-primary">
                {session.frameCount.toLocaleString()}
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
                <InfoIcon content="Frames per second — the recording rate set when the session was created." size={12} />
              </div>
              <p className="text-xl font-bold text-theme-primary">
                {session.fps}
              </p>
            </div>
          </div>
        </Card>

        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-brand bg-orange-500/10">
              <Bot className="w-5 h-5 text-orange-400" />
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

          {/* Row 2: Joint States + Keyboard Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Joint States */}
            <Card>
              <h3 className="text-sm font-medium text-theme-secondary mb-3">Joint States</h3>
              <JointStateGrid jointStates={telemetry?.jointStates ?? []} columns={2} />
            </Card>

            {/* Keyboard Teleop */}
            <Card>
              <h3 className="text-sm font-medium text-theme-secondary mb-3">Keyboard Control</h3>
              {robot ? (
                <KeyboardTeleopSection robot={robot} />
              ) : (
                <p className="text-sm text-theme-muted">Robot not connected</p>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* COMPLETED VIEW — recording summary + dataset info */}
      {/* ================================================================ */}
      {isCompleted && (
        <div className="space-y-4">
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
                  <dd className="text-theme-primary">{session.frameCount.toLocaleString()}</dd>
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
                  <dd className="text-theme-primary">{new Date(session.createdAt).toLocaleString()}</dd>
                </div>
              </dl>
            </Card>

            {/* Dataset Info */}
            <Card>
              <h2 className="font-semibold text-theme-primary mb-4">Dataset</h2>
              {session.exportedDatasetId ? (
                <div className="space-y-3">
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
                  <button onClick={() => navigate('/datasets')}
                    className="mt-4 w-full px-4 py-2 rounded-brand text-sm font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all">
                    View in Datasets
                  </button>
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

