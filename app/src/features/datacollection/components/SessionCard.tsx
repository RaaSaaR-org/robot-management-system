/**
 * @file SessionCard.tsx
 * @description Card component displaying teleoperation session summary
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import { UI_DATE_LOCALE, formatDateTime } from '@/shared/utils/format';
import { Clock, Video, Bot, User, FileVideo } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
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

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Not started';
  const date = new Date(dateString);
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDateTime(dateString, { year: 'numeric', month: 'short', day: 'numeric' });
}

function qualityColor(score: number | null | undefined): string {
  if (score == null) return 'text-theme-muted';
  if (score >= 80) return 'text-green-400';
  if (score >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

/** Rough max frames for a typical session (30fps * 5min = 9000) */
const FRAME_REFERENCE = 9000;

// ============================================================================
// COMPONENT
// ============================================================================

export function SessionCard({
  session,
  onClick,
  className,
}: SessionCardProps) {
  const framePercent = Math.min(100, (session.frameCount / FRAME_REFERENCE) * 100);

  return (
    <Card
      interactive={!!onClick}
      onClick={onClick}
      className={cn('!p-4', className)}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-brand bg-cobalt-500/10 shrink-0">
            <Video className="w-4 h-4 text-cobalt-400" />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-theme-primary truncate">
              {TELEOPERATION_TYPE_LABELS[session.type]}
            </h3>
            <p className="text-xs text-theme-muted font-mono">
              {session.id.slice(0, 8)}
            </p>
          </div>
        </div>
        <SessionStatusBadge status={session.status} size="sm" />
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
        <div className="flex items-center gap-1.5 text-theme-secondary">
          <Clock size={12} className="text-theme-muted" />
          <span>{formatDuration(session.duration)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-theme-secondary">
          <FileVideo size={12} className="text-theme-muted" />
          <span>{session.frameCount.toLocaleString(UI_DATE_LOCALE)} frames</span>
        </div>
      </div>

      {/* Frame Count Progress Bar */}
      <div className="mb-3">
        <div className="h-1.5 rounded-full bg-glass-subtle overflow-hidden">
          <div
            className="h-full rounded-full bg-cobalt-500/60 transition-all"
            style={{ width: `${framePercent}%` }}
          />
        </div>
      </div>

      {/* Robot & Operator */}
      <div className="flex items-center gap-3 text-xs text-theme-muted mb-3">
        {session.robot && (
          <div className="flex items-center gap-1">
            <Bot size={12} />
            <span className="truncate max-w-[80px]">{session.robot.name}</span>
          </div>
        )}
        {session.operator && (
          <div className="flex items-center gap-1">
            <User size={12} />
            <span className="truncate max-w-[80px]">{session.operator.name}</span>
          </div>
        )}
      </div>

      {/* Language Instruction */}
      {session.languageInstr && (
        <p className="text-xs text-theme-secondary line-clamp-2 mb-3 italic">
          &ldquo;{session.languageInstr}&rdquo;
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-glass-subtle text-xs">
        <span className="text-theme-muted">
          {formatRelativeTime(session.startedAt || session.createdAt)}
        </span>
        <div className="flex items-center gap-2">
          {session.qualityScore != null && (
            <span className={cn('font-semibold', qualityColor(session.qualityScore))}>
              {session.qualityScore}%
            </span>
          )}
          {session.exportedDatasetId && (
            <a
              href="/datasets"
              onClick={(e) => e.stopPropagation()}
              className="text-green-400 font-medium hover:underline"
            >
              Dataset
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}
