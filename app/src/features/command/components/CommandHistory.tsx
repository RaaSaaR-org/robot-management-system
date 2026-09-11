/**
 * @file CommandHistory.tsx
 * @description Past commands of one robot as compact rows (status, text,
 *              action, relative time) with search, in a kit Panel.
 * @feature command
 */

import { useMemo, useState } from 'react';
import { History, Search } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button, EmptyState, Panel, SearchInput, SkeletonRows, StatusTag } from '@/shared/components/ui';
import { formatDateTime, formatTimeAgo } from '@/shared/utils/format';
import { useRobotCommandHistory } from '../hooks/useCommand';
import type { CommandHistoryEntry } from '../types/command.types';
import { HISTORY_STATUS_LABELS, HISTORY_STATUS_TONE, commandTypeLabel } from '../types/command.types';
import { COMMAND_TYPE_LABELS } from '@/features/robots/types';

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

function HistoryRow({ entry, onSelect }: { entry: CommandHistoryEntry; onSelect?: () => void }) {
  const { originalText, interpretation, status, createdAt } = entry;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="line-clamp-2 min-w-0 text-sm text-ink-primary">{originalText}</span>
        <StatusTag tone={HISTORY_STATUS_TONE[status]} size="sm" className="flex-shrink-0">
          {HISTORY_STATUS_LABELS[status]}
        </StatusTag>
      </div>
      <div className="flex items-center justify-between gap-3 text-[13px] text-ink-tertiary">
        <span>{commandTypeLabel(interpretation.commandType, COMMAND_TYPE_LABELS)}</span>
        <time dateTime={createdAt} title={formatDateTime(createdAt)} className="tabular-nums">
          {formatTimeAgo(createdAt)}
        </time>
      </div>
    </>
  );
  const rowClass = 'flex w-full flex-col gap-1 px-5 py-3 text-left';
  return (
    <li>
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            rowClass,
            'transition-colors hover:bg-ink-primary/[0.035] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'
          )}
        >
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

/**
 * Command history for one robot.
 *
 * @example
 * ```tsx
 * <CommandHistory robotId={robotId} onCommandSelect={(e) => setText(e.originalText)} maxHeight="300px" />
 * ```
 */
export function CommandHistory({ robotId, maxHeight = '400px', onCommandSelect, className }: CommandHistoryProps) {
  const { history, isLoading } = useRobotCommandHistory(robotId);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (e) => e.originalText.toLowerCase().includes(q) || e.interpretation.commandType.toLowerCase().includes(q)
    );
  }, [history, query]);

  return (
    <Panel className={className}>
      <Panel.Header
        title="Command history"
        description={history.length > 0 ? `${filtered.length} of ${history.length}` : undefined}
      />
      {history.length > 0 && (
        <div className="px-5 pb-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search commands" size="sm" />
        </div>
      )}
      {isLoading && history.length === 0 ? (
        <div className="px-5 pb-5">
          <SkeletonRows rows={3} columns={2} dense />
        </div>
      ) : history.length === 0 ? (
        <Panel.Body>
          <EmptyState size="sm" icon={<History />} title="No commands yet" description="Commands you execute appear here." />
        </Panel.Body>
      ) : filtered.length === 0 ? (
        <Panel.Body>
          <EmptyState
            size="sm"
            icon={<Search />}
            title="No commands match"
            action={<Button variant="secondary" size="sm" onClick={() => setQuery('')}>Clear search</Button>}
          />
        </Panel.Body>
      ) : (
        <ul className="divide-y divide-line-subtle overflow-y-auto border-t border-line-subtle" style={{ maxHeight }}>
          {filtered.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              onSelect={onCommandSelect ? () => onCommandSelect(entry) : undefined}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
