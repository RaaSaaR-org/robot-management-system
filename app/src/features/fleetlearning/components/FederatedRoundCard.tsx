/**
 * @file FederatedRoundCard.tsx
 * @description Card component for displaying federated round summary
 * @feature fleetlearning
 */

import { cn } from '@/shared/utils/cn';
import { Bot, Clock, Database, TrendingUp, ChevronRight } from 'lucide-react';
import { RoundStatusBadge } from './RoundStatusBadge';
import type { FederatedRound } from '../types/fleetlearning.types';
import {
  AGGREGATION_METHOD_LABELS,
  formatDuration,
  isRoundActive,
} from '../types/fleetlearning.types';

// ============================================================================
// TYPES
// ============================================================================

export interface FederatedRoundCardProps {
  round: FederatedRound;
  onClick?: () => void;
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function FederatedRoundCard({ round, onClick, className }: FederatedRoundCardProps) {
  const active = isRoundActive(round);
  const completionRate = round.participantCount > 0
    ? Math.round((round.completedParticipants / round.participantCount) * 100)
    : 0;

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4',
        'hover:border-primary-300 dark:hover:border-primary-700 transition-colors',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              Round {round.id.slice(0, 8)}
            </h3>
            <RoundStatusBadge status={round.status} showPulse={active} size="sm" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Model: {round.globalModelVersion}
          </p>
        </div>
        {onClick && (
          <ChevronRight className="w-5 h-5 text-gray-400" />
        )}
      </div>

      {/* Progress bar (for active rounds) */}
      {active && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>Progress</span>
            <span>{completionRate}%</span>
          </div>
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-300"
              style={{ width: `${completionRate}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-gray-400" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Participants</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {round.completedParticipants} / {round.participantCount}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-gray-400" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Local Samples</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {round.totalLocalSamples.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-400" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Aggregation</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {AGGREGATION_METHOD_LABELS[round.config.aggregationMethod]}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Duration</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {round.startedAt && round.completedAt
                ? formatDuration(
                    Math.floor(
                      (new Date(round.completedAt).getTime() -
                        new Date(round.startedAt).getTime()) /
                        1000
                    )
                  )
                : round.startedAt
                ? 'In progress'
                : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* Metrics (if completed) */}
      {round.status === 'completed' && round.metrics && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-4 text-sm">
            {round.metrics.avgLocalLoss !== undefined && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Avg Loss: </span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {round.metrics.avgLocalLoss.toFixed(4)}
                </span>
              </div>
            )}
            {round.metrics.lossImprovement !== undefined && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Improvement: </span>
                <span
                  className={cn(
                    'font-medium',
                    round.metrics.lossImprovement > 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {round.metrics.lossImprovement > 0 ? '+' : ''}
                  {(round.metrics.lossImprovement * 100).toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {round.status === 'failed' && round.errorMessage && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-red-600 dark:text-red-400">{round.errorMessage}</p>
        </div>
      )}

      {/* Timestamp */}
      <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">
        Created {new Date(round.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}
