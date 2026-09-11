/**
 * @file OrchestratorChatPage.tsx
 * @description Orchestrator chat for the dashboard drawer: one conversation, agent routing
 * @feature a2a
 */

import { useEffect } from 'react';
import { Button, ErrorState, Spinner, StatusTag } from '@/shared/components/ui';
import { ConversationPanel } from '../components/ConversationPanel';
import { useA2A } from '../hooks/useA2A';
import { useA2AStream } from '../hooks/useA2AStream';
import { useRobotsStore, selectRobots } from '@/features/robots';

/**
 * Orchestrated chat body. Rendered inside the dashboard's chat drawer, which owns
 * the title, so this component has no heading of its own.
 */
export function OrchestratorChatPage() {
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
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);
  const { isConnected } = useA2AStream();

  useEffect(() => {
    fetchRobots();
  }, [fetchRobots]);

  useEffect(() => {
    setChatMode('orchestration');
  }, [setChatMode]);

  // Select the orchestrator conversation, or create one
  useEffect(() => {
    const init = async () => {
      const existing = conversations.find((c) => c.name?.startsWith('Orchestrator'));
      if (existing) {
        selectConversation(existing.conversationId);
      } else if (conversations.length === 0 && !isLoading && !error) {
        try {
          await createConversation(undefined, 'Orchestrator');
        } catch {
          // the store keeps the error
        }
      } else if (!currentConversation && conversations.length > 0) {
        selectConversation(conversations[0].conversationId);
      }
    };
    void init();
  }, [conversations, currentConversation, isLoading, error, createConversation, selectConversation]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-line-subtle px-4 py-2">
        <span className="text-[13px] text-ink-tertiary">The orchestrator routes each message to the right robot.</span>
        {isConnected ? (
          <StatusTag tone="success" dot>
            {robots.length > 0 ? `${robots.length} robots` : 'Connected'}
          </StatusTag>
        ) : (
          <StatusTag status="offline" dot />
        )}
      </div>

      {error && (
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-line-subtle px-4 py-2 text-[13px] text-signal-stopped">
          <span role="alert">{error}</span>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {isLoading && !currentConversation ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-tertiary">
            <Spinner size="sm" color="current" /> Loading…
          </div>
        ) : error && !currentConversation ? (
          <div className="flex h-full items-center justify-center p-6">
            <ErrorState size="sm" title="Couldn't start the orchestrator chat" message={error} onRetry={clearError} />
          </div>
        ) : (
          <ConversationPanel
            conversationId={currentConversation?.conversationId ?? null}
            chatMode="orchestration"
            onNewConversation={() => void createConversation(undefined, 'Orchestrator').catch(() => undefined)}
            activeTasks={activeTasks}
          />
        )}
      </div>
    </div>
  );
}
