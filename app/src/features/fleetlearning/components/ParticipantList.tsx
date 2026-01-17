/**
 * @file ParticipantList.tsx
 * @description List component for displaying participants in a federated round
 * @feature fleetlearning
 */

import { cn } from '@/shared/utils/cn';
import { Bot, Database, Clock, AlertCircle } from 'lucide-react';
import { ParticipantStatusBadge } from './ParticipantStatusBadge';
import type { FederatedParticipant } from '../types/fleetlearning.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ParticipantListProps {
  participants: FederatedParticipant[];
  className?: string;
}

export interface ParticipantRowProps {
  participant: FederatedParticipant;
}

// ============================================================================
// COMPONENTS
// ============================================================================

function ParticipantRow({ participant }: ParticipantRowProps) {
  const trainingDuration =
    participant.trainingStartedAt && participant.trainingCompletedAt
      ? Math.floor(
          (new Date(participant.trainingCompletedAt).getTime() -
            new Date(participant.trainingStartedAt).getTime()) /
            1000
        )
      : null;

  return (
    <div className="flex items-center justify-between py-3 px-4 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <Bot className="w-4 h-4 text-gray-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {participant.robotId.slice(0, 12)}
          </p>
          <ParticipantStatusBadge status={participant.status} />
        </div>
      </div>

      <div className="flex items-center gap-6">
        {/* Local samples */}
        {participant.localSamples !== undefined && (
          <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
            <Database className="w-4 h-4" />
            <span>{participant.localSamples.toLocaleString()}</span>
          </div>
        )}

        {/* Training duration */}
        {trainingDuration !== null && (
          <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
            <Clock className="w-4 h-4" />
            <span>{trainingDuration}s</span>
          </div>
        )}

        {/* Local loss */}
        {participant.localLoss !== undefined && (
          <div className="text-sm">
            <span className="text-gray-500 dark:text-gray-400">Loss: </span>
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {participant.localLoss.toFixed(4)}
            </span>
          </div>
        )}

        {/* Aggregation weight */}
        {participant.aggregationWeight !== undefined && (
          <div className="text-sm">
            <span className="text-gray-500 dark:text-gray-400">Weight: </span>
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {(participant.aggregationWeight * 100).toFixed(1)}%
            </span>
          </div>
        )}

        {/* Failure reason */}
        {participant.failureReason && (
          <div className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="max-w-32 truncate">{participant.failureReason}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ParticipantList({ participants, className }: ParticipantListProps) {
  if (participants.length === 0) {
    return (
      <div className={cn('text-center py-8 text-gray-500 dark:text-gray-400', className)}>
        No participants yet
      </div>
    );
  }

  // Group by status
  const uploaded = participants.filter((p) => p.status === 'uploaded');
  const training = participants.filter((p) => p.status === 'training');
  const waiting = participants.filter((p) => ['selected', 'model_received'].includes(p.status));
  const failed = participants.filter((p) => ['failed', 'timeout', 'excluded'].includes(p.status));

  return (
    <div className={cn('divide-y divide-gray-200 dark:divide-gray-700', className)}>
      {/* Summary header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-4 text-sm">
        <span className="text-gray-500 dark:text-gray-400">
          Total: <span className="font-medium text-gray-900 dark:text-gray-100">{participants.length}</span>
        </span>
        <span className="text-green-600 dark:text-green-400">
          Completed: <span className="font-medium">{uploaded.length}</span>
        </span>
        <span className="text-yellow-600 dark:text-yellow-400">
          Training: <span className="font-medium">{training.length}</span>
        </span>
        <span className="text-blue-600 dark:text-blue-400">
          Waiting: <span className="font-medium">{waiting.length}</span>
        </span>
        {failed.length > 0 && (
          <span className="text-red-600 dark:text-red-400">
            Failed: <span className="font-medium">{failed.length}</span>
          </span>
        )}
      </div>

      {/* Participant rows */}
      {participants.map((participant) => (
        <ParticipantRow key={participant.id} participant={participant} />
      ))}
    </div>
  );
}
