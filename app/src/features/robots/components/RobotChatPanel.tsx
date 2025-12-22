/**
 * @file RobotChatPanel.tsx
 * @description Chat panel for direct communication with a specific robot
 * @feature robots
 */

import { memo, useEffect, useCallback } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';
import { ConversationPanel } from '@/features/a2a/components/ConversationPanel';
import { useA2A } from '@/features/a2a/hooks/useA2A';
import { useA2AStream } from '@/features/a2a/hooks/useA2AStream';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotChatPanelProps {
  /** Robot ID */
  robotId: string;
  /** Robot display name */
  robotName: string;
  /** Robot's A2A agent URL for direct messaging */
  agentUrl?: string;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Chat panel for direct communication with a specific robot.
 *
 * Uses the A2A messaging infrastructure in direct mode,
 * targeting the robot's A2A agent endpoint.
 */
export const RobotChatPanel = memo(function RobotChatPanel({
  robotId,
  robotName,
  agentUrl,
  className,
}: RobotChatPanelProps) {
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

  // WebSocket connection
  const { isConnected } = useA2AStream();

  // Always use direct mode for robot chat
  useEffect(() => {
    setChatMode('direct');
  }, [setChatMode]);

  // Get or create conversation for this robot
  useEffect(() => {
    const initConversation = async () => {
      // Look for existing conversation for this robot
      const robotConvo = conversations.find(
        (c) => c.robotId === robotId || c.name === `Chat with ${robotName}`
      );

      if (robotConvo) {
        if (currentConversation?.conversationId !== robotConvo.conversationId) {
          selectConversation(robotConvo.conversationId);
        }
      } else if (!isLoading) {
        // Create new conversation for this robot
        try {
          await createConversation(robotId, `Chat with ${robotName}`);
        } catch {
          // Error handled by store
        }
      }
    };

    initConversation();
  }, [robotId, robotName, conversations, currentConversation, isLoading, createConversation, selectConversation]);

  const handleNewConversation = useCallback(async () => {
    try {
      await createConversation(robotId, `Chat with ${robotName}`);
    } catch {
      // Error handled by store
    }
  }, [createConversation, robotId, robotName]);

  // No A2A agent URL - show setup message
  if (!agentUrl) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
        <div className="glass-subtle rounded-2xl p-5 mb-4">
          <svg
            className="w-10 h-10 text-theme-tertiary"
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
        </div>
        <h3 className="text-lg font-medium text-theme-primary mb-2">
          A2A Chat Not Available
        </h3>
        <p className="text-sm text-theme-secondary max-w-sm">
          This robot does not have an A2A agent configured.
          Chat functionality will be available once the robot's A2A endpoint is registered.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-glass-subtle">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-cobalt-500"
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
            <span className="font-medium text-theme-primary">
              Chat with {robotName}
            </span>
          </div>
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
            targetAgent={{ name: robotName, url: agentUrl } as never}
            chatMode="direct"
            onNewConversation={handleNewConversation}
            activeTasks={activeTasks}
          />
        )}
      </div>
    </div>
  );
});
