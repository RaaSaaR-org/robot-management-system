/**
 * @file SessionList.tsx
 * @description List component for displaying teleoperation sessions
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import { Filter, Plus, ChevronLeft, ChevronRight, Video } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import { Spinner } from '@/shared/components/ui/Spinner';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import { SessionCard } from './SessionCard';
import type {
  TeleoperationSession,
  SessionFilters,
  SessionPagination,
  TeleoperationStatus,
  TeleoperationType,
} from '../types/datacollection.types';

// ============================================================================
// TYPES
// ============================================================================

export interface SessionListProps {
  sessions: TeleoperationSession[];
  filters: SessionFilters;
  pagination: SessionPagination;
  isLoading: boolean;
  onFilterChange: (filters: Partial<SessionFilters>) => void;
  onClearFilters: () => void;
  onPageChange: (page: number) => void;
  onSessionClick: (session: TeleoperationSession) => void;
  onNewSession?: () => void;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_OPTIONS: { value: TeleoperationStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'created', label: 'Ready' },
  { value: 'recording', label: 'Recording' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const TYPE_OPTIONS: { value: TeleoperationType | ''; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'vr_quest', label: 'Meta Quest VR' },
  { value: 'vr_vision_pro', label: 'Vision Pro' },
  { value: 'bilateral_aloha', label: 'Bilateral ALOHA' },
  { value: 'kinesthetic', label: 'Kinesthetic' },
  { value: 'keyboard_mouse', label: 'Keyboard & Mouse' },
  { value: 'gamepad', label: 'Gamepad' },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function SessionList({
  sessions,
  filters,
  pagination,
  isLoading,
  onFilterChange,
  onClearFilters,
  onPageChange,
  onSessionClick,
  onNewSession,
  className,
}: SessionListProps) {
  const hasFilters = filters.status || filters.type;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Filters Row */}
      <Card variant="subtle">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
          <Filter size={16} className="text-theme-muted shrink-0" />
          <select
            value={filters.status || ''}
            onChange={(e) =>
              onFilterChange({ status: e.target.value as TeleoperationStatus | undefined || undefined })
            }
            className="px-3 py-1.5 text-sm rounded-brand border border-theme bg-theme-card text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={filters.type || ''}
            onChange={(e) =>
              onFilterChange({ type: e.target.value as TeleoperationType | undefined || undefined })
            }
            className="px-3 py-1.5 text-sm rounded-brand border border-theme bg-theme-card text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              onClick={onClearFilters}
              className="text-sm text-cobalt-400 hover:text-cobalt-300 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" color="cobalt" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && sessions.length === 0 && (
        <Card variant="subtle">
          <EmptyState
            icon={<Video className="w-10 h-10" />}
            title={hasFilters ? 'No sessions match your filters' : 'No sessions yet'}
            description={
              hasFilters
                ? 'Try adjusting your filter criteria or clear all filters.'
                : 'Start by creating a new teleoperation session. Each session records camera frames, joint states, and actions.'
            }
            action={
              !hasFilters && onNewSession ? (
                <button
                  onClick={onNewSession}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-brand text-sm font-medium bg-cobalt-500/15 text-cobalt-400 hover:bg-cobalt-500/25 border border-cobalt-500/20 transition-all"
                >
                  <Plus size={16} />
                  Create Session
                </button>
              ) : undefined
            }
          />
        </Card>
      )}

      {/* Sessions Grid */}
      {!isLoading && sessions.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onClick={() => onSessionClick(session)}
              />
            ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-glass-subtle">
              <p className="text-sm text-theme-muted">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onPageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="p-2 rounded-brand border border-theme disabled:opacity-30 disabled:cursor-not-allowed hover:bg-glass-subtle transition-colors"
                >
                  <ChevronLeft size={18} className="text-theme-secondary" />
                </button>
                <button
                  onClick={() => onPageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                  className="p-2 rounded-brand border border-theme disabled:opacity-30 disabled:cursor-not-allowed hover:bg-glass-subtle transition-colors"
                >
                  <ChevronRight size={18} className="text-theme-secondary" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
