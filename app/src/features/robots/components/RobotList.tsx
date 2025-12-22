/**
 * @file RobotList.tsx
 * @description Grid/list display of robots with filtering and pagination
 * @feature robots
 * @dependencies @/shared/components/ui, @/features/robots/hooks
 */

import { useState, useEffect } from 'react';
import { Input, Button, Spinner } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { RobotCard } from './RobotCard';
import { RobotStatusBadge } from './RobotStatusBadge';
import { useRobots } from '../hooks/useRobots';
import { type RobotStatus, ROBOT_STATUS_LABELS } from '../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotListProps {
  /** Callback when a robot is selected */
  onSelectRobot?: (robotId: string) => void;
  /** Currently selected robot ID */
  selectedRobotId?: string | null;
  /** Display mode */
  viewMode?: 'grid' | 'list';
  /** Show filter controls */
  showFilters?: boolean;
  /** Callback to add a robot (shows in empty state) */
  onAddRobot?: () => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// STATUS FILTER OPTIONS
// ============================================================================

const STATUS_OPTIONS: (RobotStatus | 'all')[] = [
  'all',
  'online',
  'busy',
  'charging',
  'offline',
  'error',
  'maintenance',
];

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Displays a filterable, paginated list or grid of robots.
 *
 * @example
 * ```tsx
 * function RobotsPage() {
 *   const navigate = useNavigate();
 *
 *   return (
 *     <RobotList
 *       onSelectRobot={(id) => navigate(`/robots/${id}`)}
 *       showFilters
 *     />
 *   );
 * }
 * ```
 */
export function RobotList({
  onSelectRobot,
  selectedRobotId,
  viewMode: initialViewMode = 'grid',
  showFilters = true,
  onAddRobot,
  className,
}: RobotListProps) {
  const {
    robots,
    isLoading,
    error,
    filters,
    pagination,
    fetchRobots,
    setFilters,
    clearFilters,
    setPage,
  } = useRobots();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>(initialViewMode);
  const [searchValue, setSearchValue] = useState(filters.search ?? '');

  // Fetch robots on mount
  useEffect(() => {
    fetchRobots();
  }, [fetchRobots]);

  // Debounced search
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchValue !== filters.search) {
        setFilters({ search: searchValue || undefined });
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchValue, filters.search, setFilters]);

  const handleStatusFilter = (status: RobotStatus | 'all') => {
    setFilters({ status: status === 'all' ? undefined : status });
  };

  const currentStatus = filters.status as RobotStatus | undefined;

  // Loading state
  if (isLoading && robots.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" color="cobalt" label="Loading robots..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-full bg-red-100 p-4 dark:bg-red-900/30">
          <svg
            className="h-8 w-8 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-medium text-theme-primary">Failed to load robots</h3>
        <p className="mt-1 text-sm text-theme-secondary">{error}</p>
        <Button variant="primary" size="sm" className="mt-4" onClick={() => fetchRobots()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Filters */}
      {showFilters && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Search */}
          <div className="w-full sm:max-w-xs">
            <Input
              placeholder="Search robots..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              leftIcon={
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              }
            />
          </div>

          {/* Status filter + View toggle */}
          <div className="flex items-center gap-4">
            {/* Status filter - glass pill container */}
            <div className="glass-subtle rounded-xl p-1 flex items-center gap-1 overflow-x-auto">
              {STATUS_OPTIONS.map((status) => (
                <button
                  key={status}
                  onClick={() => handleStatusFilter(status)}
                  className={cn(
                    'px-3 py-1.5 text-sm rounded-lg transition-all duration-200 whitespace-nowrap',
                    (status === 'all' && !currentStatus) || currentStatus === status
                      ? 'bg-cobalt-500 text-white shadow-sm'
                      : 'text-theme-secondary hover:text-theme-primary hover:bg-white/5'
                  )}
                >
                  {status === 'all' ? 'All' : ROBOT_STATUS_LABELS[status]}
                </button>
              ))}
            </div>

            {/* View mode toggle - glass container */}
            <div className="glass-subtle rounded-lg p-0.5 flex items-center">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'p-2 rounded-md transition-all duration-200',
                  viewMode === 'grid'
                    ? 'bg-cobalt-500 text-white shadow-sm'
                    : 'text-theme-tertiary hover:text-theme-primary'
                )}
                aria-label="Grid view"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                  />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'p-2 rounded-md transition-all duration-200',
                  viewMode === 'list'
                    ? 'bg-cobalt-500 text-white shadow-sm'
                    : 'text-theme-tertiary hover:text-theme-primary'
                )}
                aria-label="List view"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active filters summary */}
      {(currentStatus || filters.search) && (
        <div className="flex items-center gap-2 text-sm">
          <span className="card-meta">Filters:</span>
          {currentStatus && (
            <RobotStatusBadge status={currentStatus} size="sm" />
          )}
          {filters.search && (
            <span className="px-2 py-0.5 glass-subtle rounded-lg text-theme-primary">
              "{filters.search}"
            </span>
          )}
          <button
            onClick={clearFilters}
            className="text-cobalt-400 hover:text-cobalt-300 ml-2 transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Robot list/grid */}
      {robots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="glass-subtle rounded-2xl p-5">
            <svg
              className="h-8 w-8 text-theme-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
          </div>
          <h3 className="mt-4 text-lg font-medium text-theme-primary">
            {currentStatus || filters.search ? 'No robots found' : 'No robots connected'}
          </h3>
          <p className="mt-1 card-meta">
            {currentStatus || filters.search
              ? 'Try adjusting your filters'
              : 'Add your first robot to get started'}
          </p>
          {!currentStatus && !filters.search && onAddRobot && (
            <Button variant="primary" className="mt-4" onClick={onAddRobot}>
              Add Robot
            </Button>
          )}
        </div>
      ) : (
        <div
          className={cn(
            viewMode === 'grid'
              ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
              : 'flex flex-col gap-3'
          )}
        >
          {robots.map((robot) => (
            <RobotCard
              key={robot.id}
              robot={robot}
              onClick={onSelectRobot ? () => onSelectRobot(robot.id) : undefined}
              selected={selectedRobotId === robot.id}
              compact={viewMode === 'list'}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-glass-subtle pt-4">
          <p className="card-meta">
            Showing {(pagination.page - 1) * pagination.pageSize + 1} to{' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total} robots
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage(pagination.page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-theme-secondary">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Loading overlay for subsequent fetches */}
      {isLoading && robots.length > 0 && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <Spinner size="lg" color="cobalt" />
        </div>
      )}
    </div>
  );
}
