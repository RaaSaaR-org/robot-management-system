/**
 * @file OrchestratorChatPage.tsx
 * @description Orchestrator chat interface - chat with intelligent agent routing
 * @feature a2a
 */

import { memo, useEffect } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';
import { ConversationPanel } from '../components/ConversationPanel';
import { useA2A } from '../hooks/useA2A';
import { useA2AStream } from '../hooks/useA2AStream';
import { useRobotsStore, selectRobots } from '@/features/robots';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Orchestrator chat page - simplified chat with intelligent agent routing.
 *
 * The orchestrator analyzes messages and routes them to the most appropriate
 * agent based on capabilities and context.
 */
export const OrchestratorChatPage = memo(function OrchestratorChatPage() {
  const {
    conversations,
    currentConversation,
    activeTasks,
    isLoading,
    error,
    createConversation,
    selectConversation,
    clearError,
    setChatMode,
  } = useA2A();

  // Get robots from robots store for display count
  const robots = useRobotsStore(selectRobots);

  // WebSocket connection
  const { isConnected } = useA2AStream();

  // Always use orchestration mode on this page
  useEffect(() => {
    setChatMode('orchestration');
  }, [setChatMode]);

  // Auto-create or select orchestrator conversation on mount
  useEffect(() => {
    const initConversation = async () => {
      // Look for existing orchestrator conversation
      const orchestratorConvo = conversations.find(
        (c) => c.name === 'Orchestrator' || c.name?.startsWith('Orchestrator')
      );

      if (orchestratorConvo) {
        selectConversation(orchestratorConvo.conversationId);
      } else if (conversations.length === 0 && !isLoading) {
        // Create new orchestrator conversation
        try {
          await createConversation(undefined, 'Orchestrator');
        } catch {
          // Error handled by store
        }
      } else if (!currentConversation && conversations.length > 0) {
        // Select first conversation if none selected
        selectConversation(conversations[0].conversationId);
      }
    };

    initConversation();
  }, [conversations, currentConversation, isLoading, createConversation, selectConversation]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between h-14 px-6 border-b border-glass-subtle">
        {/* Left: Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg
              className="w-6 h-6 text-cobalt-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <h1 className="text-lg font-semibold text-theme-primary">Orchestrator</h1>
          </div>
          <span className="text-sm text-theme-tertiary">
            Intelligent robot routing
          </span>
        </div>

        {/* Right: Robot count + Connection status */}
        <div className="flex items-center gap-4">
          {/* Available robots count */}
          <div className="flex items-center gap-2 text-sm text-theme-secondary">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <span>{robots.length} robots</span>
          </div>

          {/* Connection status */}
          <div className="flex items-center gap-1.5 glass-subtle px-2.5 py-1 rounded-full">
            <span
              className={cn(
                'w-2 h-2 rounded-full transition-colors',
                isConnected ? 'bg-accent-500' : 'bg-gray-400'
              )}
            />
            <span className="text-xs text-theme-secondary">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center justify-between text-sm">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-hidden">
        {isLoading && !currentConversation ? (
          <div className="flex items-center justify-center h-full">
            <Spinner size="lg" color="cobalt" label="Loading..." />
          </div>
        ) : (
          <ConversationPanel
            conversationId={currentConversation?.conversationId || null}
            targetAgent={undefined}
            chatMode="orchestration"
            onNewConversation={async () => {
              await createConversation(undefined, 'Orchestrator');
            }}
            activeTasks={activeTasks}
          />
        )}
      </div>
    </div>
  );
});
