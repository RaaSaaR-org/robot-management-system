/**
 * @file ConversationList.tsx
 * @description List of conversations
 * @feature a2a
 */

import { memo } from 'react';
import { MessageSquare } from 'lucide-react';
import { UI_DATE_LOCALE, cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import type { A2AConversation } from '../types';

interface ConversationListProps {
  conversations: A2AConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onNew?: () => void;
  className?: string;
}

/**
 * Conversation list component
 */
export const ConversationList = memo(function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onDelete,
  onNew,
  className,
}: ConversationListProps) {
  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold text-theme-primary">
          Conversations
        </h3>
        {onNew && (
          <Button size="sm" onClick={onNew}>
            New
          </Button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="w-10 h-10" />}
            title="No conversations yet"
            description="Start a conversation to chat with an agent."
            action={
              onNew && (
                <Button variant="ghost" onClick={onNew}>
                  Start a new one
                </Button>
              )
            }
            size="sm"
          />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.conversationId}
                conversation={conversation}
                isSelected={selectedId === conversation.conversationId}
                onSelect={() => onSelect(conversation.conversationId)}
                onDelete={onDelete ? () => onDelete(conversation.conversationId) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Individual conversation list item
 */
const ConversationListItem = memo(function ConversationListItem({
  conversation,
  isSelected,
  onSelect,
  onDelete,
}: {
  conversation: A2AConversation;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  const messageCount = conversation.messages.length;

  return (
    <div
      className={cn(
        'px-4 py-3 cursor-pointer transition-colors',
        'hover:bg-gray-50 dark:hover:bg-gray-700/50',
        isSelected && 'bg-primary-50 dark:bg-primary-900/20'
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Name */}
          <p className={cn(
            'font-medium truncate',
            isSelected
              ? 'text-primary-600 dark:text-primary-400'
              : 'text-theme-primary'
          )}>
            {conversation.name}
          </p>

          {/* Last message preview */}
          {lastMessage && (
            <p className="text-sm text-theme-tertiary truncate mt-0.5">
              {lastMessage.parts
                .filter((p) => p.kind === 'text')
                .map((p) => (p as { kind: 'text'; text: string }).text)
                .join(' ')}
            </p>
          )}

          {/* Meta info */}
          <div className="flex items-center gap-2 mt-1 text-xs text-theme-muted">
            <span>{messageCount} message{messageCount !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{new Date(conversation.updatedAt).toLocaleDateString(UI_DATE_LOCALE)}</span>
          </div>
        </div>

        {/* Delete button */}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 text-theme-muted hover:text-red-500 rounded"
            title="Delete conversation"
            aria-label="Delete conversation"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
