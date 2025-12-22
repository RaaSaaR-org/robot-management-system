/**
 * @file ConversationSelector.tsx
 * @description Dropdown for selecting/switching conversations in header
 * @feature a2a
 */

import { memo, useState, useRef, useEffect } from 'react';
import { cn } from '@/shared/utils';
import type { A2AConversation } from '../types';

interface ConversationSelectorProps {
  conversations: A2AConversation[];
  current?: A2AConversation;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  );
}

/**
 * Dropdown for switching between conversations
 */
export const ConversationSelector = memo(function ConversationSelector({
  conversations,
  current,
  onSelect,
  onNew,
}: ConversationSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg',
          'text-sm font-medium',
          'hover:bg-gray-100/50 dark:hover:bg-gray-700/50',
          'transition-all duration-200',
          'max-w-[180px]'
        )}
      >
        <ChatIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="truncate text-gray-900 dark:text-gray-100">
          {current?.name || 'No conversation'}
        </span>
        <ChevronDownIcon className={cn('w-4 h-4 flex-shrink-0 text-gray-400 transition-transform duration-200', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute top-full mt-1 left-0 min-w-[220px]',
            'glass-elevated rounded-xl shadow-lg',
            'py-1 z-50 pointer-events-auto',
            'animate-fade-in'
          )}
        >
          {/* New conversation button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNew();
              setIsOpen(false);
            }}
            className={cn(
              'w-full text-left px-3 py-2.5 text-sm',
              'text-primary-600 dark:text-primary-400',
              'hover:bg-gray-100/50 dark:hover:bg-gray-700/50',
              'transition-colors duration-150',
              'flex items-center gap-2',
              'border-b border-glass-subtle'
            )}
          >
            <PlusIcon className="w-4 h-4" />
            New conversation
          </button>

          {/* Conversations list */}
          {conversations.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No conversations yet
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              {conversations.map((conv) => (
                <button
                  key={conv.conversationId}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(conv.conversationId);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2.5 text-sm',
                    'hover:bg-gray-100/50 dark:hover:bg-gray-700/50',
                    'transition-colors duration-150',
                    current?.conversationId === conv.conversationId &&
                      'bg-primary-50/50 dark:bg-primary-900/20'
                  )}
                >
                  <div className="font-medium truncate text-gray-900 dark:text-gray-100">
                    {conv.name}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    <span>{conv.messages?.length || 0} messages</span>
                    <span>·</span>
                    <span>
                      {new Date(conv.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
