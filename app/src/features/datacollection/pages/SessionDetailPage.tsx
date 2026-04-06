/**
 * @file SessionDetailPage.tsx
 * @description Page for viewing teleoperation session details
 * @feature datacollection
 */

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Pause,
  Square,
  Clock,
  Video,
  Bot,
  User,
  FileVideo,
  Download,
  Edit2,
  AlertCircle,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import { Spinner } from '@/shared/components/ui/Spinner';
import { InfoIcon } from '@/shared/components/ui/Tooltip';
import { SessionStatusBadge } from '../components/SessionStatusBadge';
import { QualityIndicator } from '../components/QualityIndicator';
import { useSessionDetail } from '../hooks/datacollection';
import { useDataCollectionStore } from '../store/datacollectionStore';
import {
  TELEOPERATION_TYPE_LABELS,
  formatDuration,
  canStartSession,
  canPauseSession,
  canEndSession,
} from '../types/datacollection.types';

// ============================================================================
// COMPONENT
// ============================================================================

export function SessionDetailPage() {
  const { sessionId: id } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const { session, isLoading, error, annotateSession, exportSession } = useSessionDetail(id!);
  const qualityFeedback = useDataCollectionStore((state) => state.qualityFeedback);
  const storeStartSession = useDataCollectionStore((state) => state.startSession);
  const storePauseSession = useDataCollectionStore((state) => state.pauseSession);
  const storeResumeSession = useDataCollectionStore((state) => state.resumeSession);
  const storeEndSession = useDataCollectionStore((state) => state.endSession);

  const [showAnnotateModal, setShowAnnotateModal] = useState(false);
  const [annotationText, setAnnotationText] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportName, setExportName] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const handleBack = () => {
    navigate('/data-collection');
  };

  const handleStart = async () => {
    if (!session) return;
    setActionLoading(true);
    try {
      await storeStartSession(session.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePause = async () => {
    if (!session) return;
    setActionLoading(true);
    try {
      await storePauseSession(session.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    if (!session) return;
    setActionLoading(true);
    try {
      await storeResumeSession(session.id);
    } finally {
      setActionLoading(false);
    }
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

  const handleAnnotate = async () => {
    if (!annotationText.trim()) return;
    setActionLoading(true);
    try {
      await annotateSession(annotationText);
      setShowAnnotateModal(false);
      setAnnotationText('');
    } finally {
      setActionLoading(false);
    }
  };

  const handleExport = async () => {
    setActionLoading(true);
    try {
      await exportSession({ datasetName: exportName || undefined });
      setShowExportModal(false);
      setExportName('');
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 5000);
    } finally {
      setActionLoading(false);
    }
  };

  // Loading state
  if (isLoading && !session) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" color="cobalt" />
      </div>
    );
  }

  // Error state
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

  return (
    <div className="space-y-6 max-w-5xl">
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
                {TELEOPERATION_TYPE_LABELS[session.type]}
              </h1>
              <SessionStatusBadge status={session.status} showPulse={isRecording} />
            </div>
            <p className="text-theme-muted mt-0.5 font-mono text-sm">
              Session {session.id.slice(0, 8)}
            </p>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center gap-2">
          {canStartSession(session) && !isRecording && (
            <button
              onClick={isPaused ? handleResume : handleStart}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-brand text-sm font-medium bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20 transition-all disabled:opacity-50"
            >
              <Play size={18} />
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

      {/* Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Info Card */}
        <Card>
          <h2 className="font-semibold text-theme-primary mb-4">Session Info</h2>
          <dl className="space-y-3">
            {session.robot && (
              <div className="flex items-center gap-3">
                <Bot className="w-5 h-5 text-theme-muted" />
                <dt className="text-theme-muted">Robot:</dt>
                <dd className="text-theme-primary">{session.robot.name}</dd>
              </div>
            )}
            {session.operator && (
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-theme-muted" />
                <dt className="text-theme-muted">Operator:</dt>
                <dd className="text-theme-primary">{session.operator.name}</dd>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-theme-muted" />
              <dt className="text-theme-muted">Created:</dt>
              <dd className="text-theme-primary">
                {new Date(session.createdAt).toLocaleString()}
              </dd>
            </div>
          </dl>
        </Card>

        {/* Language Instruction */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-theme-primary">Task Description</h2>
            <button
              onClick={() => {
                setAnnotationText(session.languageInstr || '');
                setShowAnnotateModal(true);
              }}
              className="p-2 hover:bg-glass-subtle rounded-brand transition-colors"
            >
              <Edit2 className="w-4 h-4 text-theme-muted" />
            </button>
          </div>
          {session.languageInstr ? (
            <p className="text-theme-secondary italic">
              &ldquo;{session.languageInstr}&rdquo;
            </p>
          ) : (
            <p className="text-theme-muted">
              No task description added yet
            </p>
          )}
        </Card>
      </div>

      {/* Actions */}
      {isCompleted && !session.exportedDatasetId && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowExportModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-brand text-sm font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all"
          >
            <Download size={18} />
            Export to Dataset
          </button>
        </div>
      )}

      {exportSuccess && (
        <Card variant="subtle" className="!bg-green-500/10 border border-green-500/20">
          <p className="text-green-400 font-medium text-sm px-4 py-3">
            Dataset created successfully!
          </p>
        </Card>
      )}

      {session.exportedDatasetId && (
        <Card variant="subtle" className="!bg-green-500/10 border border-green-500/20">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-green-400 text-sm">
              Session exported to dataset: {session.exportedDatasetId}
            </p>
            <button
              onClick={() => navigate('/datasets')}
              className="text-xs px-3 py-1.5 rounded-brand bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20 transition-all"
            >
              View Datasets
            </button>
          </div>
        </Card>
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
