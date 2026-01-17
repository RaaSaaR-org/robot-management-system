/**
 * @file SessionCard.tsx
 * @description Card component displaying teleoperation session summary
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import { Clock, Video, Bot, User, FileVideo } from 'lucide-react';
import { SessionStatusBadge } from './SessionStatusBadge';
import type { TeleoperationSession } from '../types/datacollection.types';
import {
  TELEOPERATION_TYPE_LABELS,
  formatDuration,
} from '../types/datacollection.types';

// ============================================================================
// TYPES
// ============================================================================

export interface SessionCardProps {
  session: TeleoperationSession;
  onClick?: () => void;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Not started';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// COMPONENT
// ============================================================================

export function SessionCard({
  session,
  onClick,
  className,
}: SessionCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700',
        'p-4 transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-primary-300 dark:hover:border-primary-600',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
            <Video className="w-4 h-4 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              {TELEOPERATION_TYPE_LABELS[session.type]}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {session.id.slice(0, 8)}
            </p>
          </div>
        </div>
        <SessionStatusBadge status={session.status} size="sm" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Clock size={14} className="text-gray-400" />
          <span>{formatDuration(session.duration)}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <FileVideo size={14} className="text-gray-400" />
          <span>{session.frameCount.toLocaleString()} frames</span>
        </div>
      </div>

      {/* Robot & Operator */}
      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-3">
        {session.robot && (
          <div className="flex items-center gap-1.5">
            <Bot size={14} />
            <span className="truncate max-w-[100px]">{session.robot.name}</span>
          </div>
        )}
        {session.operator && (
          <div className="flex items-center gap-1.5">
            <User size={14} />
            <span className="truncate max-w-[100px]">{session.operator.name}</span>
          </div>
        )}
      </div>

      {/* Language Instruction */}
      {session.languageInstr && (
        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3 italic">
          "{session.languageInstr}"
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <span>{formatDate(session.startedAt || session.createdAt)}</span>
        {session.qualityScore && (
          <span className="font-medium">Quality: {session.qualityScore}%</span>
        )}
        {session.exportedDatasetId && (
          <span className="text-green-600 dark:text-green-400">Exported</span>
        )}
      </div>
    </div>
  );
}
