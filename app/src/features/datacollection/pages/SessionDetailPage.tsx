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
  Loader2,
  AlertCircle,
} from 'lucide-react';
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
  const { id } = useParams<{ id: string }>();
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
    } finally {
      setActionLoading(false);
    }
  };

  // Loading state
  if (isLoading && !session) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </div>
    );
  }

  // Error state
  if (error && !session) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Error Loading Session
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Back to Sessions
          </button>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const isRecording = session.status === 'recording';
  const isPaused = session.status === 'paused';
  const isCompleted = session.status === 'completed';

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {TELEOPERATION_TYPE_LABELS[session.type]}
              </h1>
              <SessionStatusBadge status={session.status} showPulse={isRecording} />
            </div>
            <p className="text-gray-500 dark:text-gray-400 mt-0.5">
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
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <Play size={18} />
              {isPaused ? 'Resume' : 'Start'}
            </button>
          )}
          {canPauseSession(session) && (
            <button
              onClick={handlePause}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50"
            >
              <Pause size={18} />
              Pause
            </button>
          )}
          {canEndSession(session) && (
            <button
              onClick={handleEnd}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              <Square size={18} />
              End
            </button>
          )}
        </div>
      </div>

      {/* Quality Feedback (during recording) */}
      {(isRecording || isPaused) && (
        <QualityIndicator feedback={qualityFeedback} className="mb-6" />
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Duration</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {formatDuration(session.duration)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <FileVideo className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Frames</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {session.frameCount.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <Video className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">FPS</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {session.fps}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
              <Bot className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Quality</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {session.qualityScore ? `${session.qualityScore}%` : '-'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Info Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Session Info</h2>
          <dl className="space-y-3">
            {session.robot && (
              <div className="flex items-center gap-3">
                <Bot className="w-5 h-5 text-gray-400" />
                <dt className="text-gray-500 dark:text-gray-400">Robot:</dt>
                <dd className="text-gray-900 dark:text-gray-100">{session.robot.name}</dd>
              </div>
            )}
            {session.operator && (
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-gray-400" />
                <dt className="text-gray-500 dark:text-gray-400">Operator:</dt>
                <dd className="text-gray-900 dark:text-gray-100">{session.operator.name}</dd>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-gray-400" />
              <dt className="text-gray-500 dark:text-gray-400">Created:</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {new Date(session.createdAt).toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>

        {/* Language Instruction */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Task Description</h2>
            <button
              onClick={() => {
                setAnnotationText(session.languageInstr || '');
                setShowAnnotateModal(true);
              }}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              <Edit2 className="w-4 h-4 text-gray-500" />
            </button>
          </div>
          {session.languageInstr ? (
            <p className="text-gray-700 dark:text-gray-300 italic">
              "{session.languageInstr}"
            </p>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">
              No task description added yet
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      {isCompleted && !session.exportedDatasetId && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowExportModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Download size={18} />
            Export to Dataset
          </button>
        </div>
      )}

      {session.exportedDatasetId && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-green-700 dark:text-green-300">
            Session exported to dataset: {session.exportedDatasetId}
          </p>
        </div>
      )}

      {/* Annotate Modal */}
      {showAnnotateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Edit Task Description
            </h3>
            <textarea
              value={annotationText}
              onChange={(e) => setAnnotationText(e.target.value)}
              rows={4}
              placeholder="Describe the task..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowAnnotateModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleAnnotate}
                disabled={actionLoading}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {actionLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Export Session
            </h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Dataset Name (optional)
              </label>
              <input
                type="text"
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                placeholder="Leave empty for auto-generated name"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={actionLoading}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {actionLoading ? 'Exporting...' : 'Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
