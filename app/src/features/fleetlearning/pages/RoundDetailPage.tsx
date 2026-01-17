/**
 * @file RoundDetailPage.tsx
 * @description Page for viewing federated round details
 * @feature fleetlearning
 */

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import {
  ArrowLeft,
  Play,
  XCircle,
  Clock,
  Bot,
  Database,
  TrendingUp,
  Settings,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { RoundStatusBadge } from '../components/RoundStatusBadge';
import { ParticipantList } from '../components/ParticipantList';
import { useRoundDetail } from '../hooks/fleetlearning';
import {
  AGGREGATION_METHOD_LABELS,
  SELECTION_STRATEGY_LABELS,
  formatDuration,
  isRoundActive,
  canStartRound,
  canCancelRound,
} from '../types/fleetlearning.types';

// ============================================================================
// COMPONENT
// ============================================================================

export function RoundDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { round, participants, isLoading, error, fetchRound, startRound, cancelRound } =
    useRoundDetail(id!);

  const [actionLoading, setActionLoading] = useState(false);

  const handleBack = () => {
    navigate('/fleet-learning');
  };

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await startRound();
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this round?')) return;
    setActionLoading(true);
    try {
      await cancelRound();
    } finally {
      setActionLoading(false);
    }
  };

  // Loading state
  if (isLoading && !round) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </div>
    );
  }

  // Error state
  if (error && !round) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Error Loading Round
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Back to Fleet Learning
          </button>
        </div>
      </div>
    );
  }

  if (!round) return null;

  const active = isRoundActive(round);
  const completionRate =
    round.participantCount > 0
      ? Math.round((round.completedParticipants / round.participantCount) * 100)
      : 0;

  const roundDuration =
    round.startedAt && round.completedAt
      ? Math.floor(
          (new Date(round.completedAt).getTime() - new Date(round.startedAt).getTime()) / 1000
        )
      : round.startedAt
      ? Math.floor((Date.now() - new Date(round.startedAt).getTime()) / 1000)
      : null;

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
                Round {round.id.slice(0, 8)}
              </h1>
              <RoundStatusBadge status={round.status} showPulse={active} />
            </div>
            <p className="text-gray-500 dark:text-gray-400 mt-0.5">
              Model: {round.globalModelVersion}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={fetchRound}
            disabled={isLoading}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <RefreshCw size={18} className={cn('text-gray-500', isLoading && 'animate-spin')} />
          </button>
          {canStartRound(round) && (
            <button
              onClick={handleStart}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <Play size={18} />
              Start Round
            </button>
          )}
          {canCancelRound(round) && (
            <button
              onClick={handleCancel}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              <XCircle size={18} />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Progress (for active rounds) */}
      {active && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Progress</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">{completionRate}%</span>
          </div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-300"
              style={{ width: `${completionRate}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{round.completedParticipants} completed</span>
            <span>{round.participantCount - round.completedParticipants - round.failedParticipants} in progress</span>
            <span>{round.failedParticipants} failed</span>
          </div>
        </div>
      )}

      {/* Error message */}
      {round.status === 'failed' && round.errorMessage && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3 text-red-700 dark:text-red-400">
          <AlertCircle size={20} />
          <span>{round.errorMessage}</span>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Participants</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {round.completedParticipants} / {round.participantCount}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Database className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Samples</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {round.totalLocalSamples.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <Clock className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Duration</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {roundDuration ? formatDuration(roundDuration) : '-'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
              <TrendingUp className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Improvement</p>
              <p
                className={cn(
                  'text-xl font-bold',
                  round.metrics?.lossImprovement
                    ? round.metrics.lossImprovement > 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                    : 'text-gray-900 dark:text-gray-100'
                )}
              >
                {round.metrics?.lossImprovement
                  ? `${round.metrics.lossImprovement > 0 ? '+' : ''}${(
                      round.metrics.lossImprovement * 100
                    ).toFixed(2)}%`
                  : '-'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Configuration */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Configuration
            </h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-500 dark:text-gray-400">Aggregation Method</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {AGGREGATION_METHOD_LABELS[round.config.aggregationMethod]}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 dark:text-gray-400">Selection Strategy</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {SELECTION_STRATEGY_LABELS[round.config.selectionStrategy]}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 dark:text-gray-400">Participant Range</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {round.config.minParticipants} - {round.config.maxParticipants}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 dark:text-gray-400">Local Epochs</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {round.config.localEpochs}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 dark:text-gray-400">Learning Rate</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {round.config.localLearningRate}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 dark:text-gray-400">Secure Aggregation</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {round.config.secureAggregation ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            {round.config.privacyEpsilon && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-400">Privacy Epsilon</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {round.config.privacyEpsilon}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Metrics (if available) */}
        {round.metrics && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Round Metrics
              </h2>
            </div>
            <div className="p-4 space-y-3">
              {round.metrics.avgLocalLoss !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Avg Local Loss</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {round.metrics.avgLocalLoss.toFixed(4)}
                  </span>
                </div>
              )}
              {round.metrics.convergenceScore !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Convergence Score</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {round.metrics.convergenceScore.toFixed(4)}
                  </span>
                </div>
              )}
              {round.metrics.phaseDurations && (
                <>
                  <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Phase Durations
                    </p>
                  </div>
                  {round.metrics.phaseDurations.selection && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Selection</span>
                      <span className="text-gray-900 dark:text-gray-100">
                        {formatDuration(round.metrics.phaseDurations.selection)}
                      </span>
                    </div>
                  )}
                  {round.metrics.phaseDurations.distribution && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Distribution</span>
                      <span className="text-gray-900 dark:text-gray-100">
                        {formatDuration(round.metrics.phaseDurations.distribution)}
                      </span>
                    </div>
                  )}
                  {round.metrics.phaseDurations.training && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Training</span>
                      <span className="text-gray-900 dark:text-gray-100">
                        {formatDuration(round.metrics.phaseDurations.training)}
                      </span>
                    </div>
                  )}
                  {round.metrics.phaseDurations.collection && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Collection</span>
                      <span className="text-gray-900 dark:text-gray-100">
                        {formatDuration(round.metrics.phaseDurations.collection)}
                      </span>
                    </div>
                  )}
                  {round.metrics.phaseDurations.aggregation && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Aggregation</span>
                      <span className="text-gray-900 dark:text-gray-100">
                        {formatDuration(round.metrics.phaseDurations.aggregation)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* New Model Version */}
      {round.newModelVersion && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-green-700 dark:text-green-300">
            <span className="font-medium">New model version created:</span> {round.newModelVersion}
          </p>
        </div>
      )}

      {/* Participants */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Bot className="w-4 h-4" />
            Participants
          </h2>
        </div>
        <ParticipantList participants={participants} />
      </div>

      {/* Timestamps */}
      <div className="mt-4 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-4">
        <span>Created: {new Date(round.createdAt).toLocaleString()}</span>
        {round.startedAt && <span>Started: {new Date(round.startedAt).toLocaleString()}</span>}
        {round.completedAt && <span>Completed: {new Date(round.completedAt).toLocaleString()}</span>}
      </div>
    </div>
  );
}
