/**
 * @file SessionList.tsx
 * @description List component for displaying teleoperation sessions
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import { Filter, Plus, ChevronLeft, ChevronRight, Loader2, Video } from 'lucide-react';
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
    <div className={cn('flex flex-col', className)}>
      {/* Header with Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <Filter size={18} className="text-gray-400" />
          <select
            value={filters.status || ''}
            onChange={(e) =>
              onFilterChange({ status: e.target.value as TeleoperationStatus | undefined || undefined })
            }
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
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
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
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
              className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400"
            >
              Clear
            </button>
          )}
        </div>

        {onNewSession && (
          <button
            onClick={onNewSession}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus size={18} />
            <span>New Session</span>
          </button>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
          <Video className="w-12 h-12 mb-3 opacity-50" />
          <p className="text-lg mb-2">No sessions found</p>
          <p className="text-sm">
            {hasFilters ? 'Try adjusting your filters' : 'Start by creating a new session'}
          </p>
          {!hasFilters && onNewSession && (
            <button
              onClick={onNewSession}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <Plus size={18} />
              <span>Create Session</span>
            </button>
          )}
        </div>
      )}

      {/* Sessions Grid */}
      {!isLoading && sessions.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
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
            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onPageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={() => onPageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                  className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
