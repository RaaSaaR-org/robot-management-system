/**
 * @file ConversationList.tsx
 * @description Searchable list of chat conversations with the active one marked
 * @feature a2a
 */

import { useMemo, useState } from 'react';
import { MessageSquare, Search, Trash2 } from 'lucide-react';
import { Button, EmptyState, RowActions, SearchInput } from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils';
import { cn } from '@/shared/utils/cn';
import type { A2AConversation } from '../types';
import { getMessageText } from '../types';

interface ConversationListProps {
  conversations: A2AConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (conversation: A2AConversation) => void;
  onNew?: () => void;
  className?: string;
}

/**
 * Conversation list: search on top, rows with title, last message and time.
 */
export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onDelete,
  onNew,
  className,
}: ConversationListProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.messages.some((m) => getMessageText(m).toLowerCase().includes(q)),
    );
  }, [conversations, query]);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {conversations.length > 0 && (
        <div className="border-b border-line-subtle p-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search conversations" size="sm" />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<MessageSquare />}
            title="No conversations yet"
            description="Start one to talk to an agent."
            action={
              onNew && (
                <Button variant="secondary" size="sm" onClick={onNew}>
                  New conversation
                </Button>
              )
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Search />}
            title="No conversations match"
            action={
              <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col py-1">
            {filtered.map((c) => {
              const isActive = c.conversationId === selectedId;
              const last = c.messages[c.messages.length - 1];
              const preview = last ? getMessageText(last) : '';
              return (
                <li key={c.conversationId} className="relative">
                  {isActive && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />}
                  <div
                    className={cn(
                      'group mx-1.5 flex items-start gap-1 rounded-control transition-colors',
                      isActive ? 'bg-primary/10' : 'hover:bg-ink-primary/[0.04]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(c.conversationId)}
                      aria-current={isActive ? 'true' : undefined}
                      className="min-w-0 flex-1 rounded-control px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cn('truncate text-sm font-medium', isActive ? 'text-primary' : 'text-ink-primary')}>
                          {c.name || 'Untitled conversation'}
                        </span>
                        <span className="flex-shrink-0 text-xs text-ink-muted">{formatTimeAgo(c.updatedAt)}</span>
                      </div>
                      <div className="truncate text-[13px] text-ink-tertiary">
                        {preview || `${c.messages.length} message${c.messages.length !== 1 ? 's' : ''}`}
                      </div>
                    </button>
                    {onDelete && (
                      <div className="pr-1 pt-1.5">
                        <RowActions
                          size="sm"
                          label={`Actions for ${c.name || 'conversation'}`}
                          items={[
                            {
                              label: 'Delete',
                              icon: <Trash2 />,
                              tone: 'danger',
                              onSelect: () => onDelete(c),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
