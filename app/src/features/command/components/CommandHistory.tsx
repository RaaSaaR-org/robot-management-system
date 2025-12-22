/**
 * @file CommandHistory.tsx
 * @description Command history list component
 * @feature command
 * @dependencies @/shared/utils/cn, @/shared/components/ui, @/features/command/hooks
 */

import { useState, useCallback, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { Badge } from '@/shared/components/ui/Badge';
import { Input } from '@/shared/components/ui/Input';
import { Spinner } from '@/shared/components/ui/Spinner';
import { useRobotCommandHistory } from '../hooks/useCommand';
import type { CommandHistoryEntry } from '../types/command.types';
import { HISTORY_STATUS_LABELS, HISTORY_STATUS_COLORS } from '../types/command.types';
import { COMMAND_TYPE_LABELS } from '@/features/robots/types';

// ============================================================================
// TYPES
// ============================================================================

export interface CommandHistoryProps {
  /** Robot ID to show history for */
  robotId: string;
  /** Maximum height for the list container */
  maxHeight?: string;
  /** Callback when a command is selected for re-use */
  onCommandSelect?: (entry: CommandHistoryEntry) => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface HistoryItemProps {
  entry: CommandHistoryEntry;
  onSelect?: () => void;
}

function HistoryItem({ entry, onSelect }: HistoryItemProps) {
  const { originalText, interpretation, status, createdAt } = entry;
  const commandLabel = COMMAND_TYPE_LABELS[interpretation.commandType] || interpretation.commandType;
  const statusLabel = HISTORY_STATUS_LABELS[status];
  const statusColor = HISTORY_STATUS_COLORS[status];

  const formattedTime = useMemo(() => {
    const date = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }, [createdAt]);

  return (
    <button
      onClick={onSelect}
      disabled={!onSelect}
      className={cn(
        'w-full text-left p-3 rounded-lg transition-colors',
        'bg-theme-elevated hover:bg-theme-card',
        'focus:outline-none focus:ring-2 focus:ring-cobalt-500',
        !onSelect && 'cursor-default'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-theme-primary line-clamp-2">
          {originalText}
        </span>
        <Badge variant={statusColor} className="flex-shrink-0">
          {statusLabel}
        </Badge>
      </div>
      <div className="flex items-center justify-between text-xs text-theme-tertiary">
        <span>{commandLabel}</span>
        <span>{formattedTime}</span>
      </div>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <svg
        className="w-12 h-12 text-theme-tertiary mb-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        />
      </svg>
      <p className="text-sm text-theme-tertiary">No command history yet</p>
      <p className="text-xs text-theme-tertiary mt-1">
        Commands you execute will appear here
      </p>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Command history list component.
 * Shows past commands for a robot with search/filter capability.
 *
 * @example
 * ```tsx
 * function RobotHistory({ robotId }: { robotId: string }) {
 *   const handleSelect = (entry: CommandHistoryEntry) => {
 *     // Pre-fill command bar with selected command
 *     setCommandText(entry.originalText);
 *   };
 *
 *   return (
 *     <CommandHistory
 *       robotId={robotId}
 *       onCommandSelect={handleSelect}
 *       maxHeight="300px"
 *     />
 *   );
 * }
 * ```
 */
export function CommandHistory({
  robotId,
  maxHeight = '400px',
  onCommandSelect,
  className,
}: CommandHistoryProps) {
  const { history, isLoading } = useRobotCommandHistory(robotId);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter history by search query
  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history;

    const query = searchQuery.toLowerCase();
    return history.filter(
      (entry) =>
        entry.originalText.toLowerCase().includes(query) ||
        entry.interpretation.commandType.toLowerCase().includes(query)
    );
  }, [history, searchQuery]);

  const handleSelect = useCallback(
    (entry: CommandHistoryEntry) => {
      onCommandSelect?.(entry);
    },
    [onCommandSelect]
  );

  return (
    <Card className={cn('p-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-theme-primary">Command History</h3>
        {history.length > 0 && (
          <span className="text-xs text-theme-tertiary">
            {filteredHistory.length} of {history.length}
          </span>
        )}
      </div>

      {/* Search */}
      {history.length > 0 && (
        <div className="mb-4">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search commands..."
            size="sm"
            fullWidth
            leftIcon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : history.length === 0 ? (
        <EmptyState />
      ) : filteredHistory.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-theme-tertiary">No commands match your search</p>
        </div>
      ) : (
        <div
          className="space-y-2 overflow-y-auto"
          style={{ maxHeight }}
        >
          {filteredHistory.map((entry) => (
            <HistoryItem
              key={entry.id}
              entry={entry}
              onSelect={onCommandSelect ? () => handleSelect(entry) : undefined}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
