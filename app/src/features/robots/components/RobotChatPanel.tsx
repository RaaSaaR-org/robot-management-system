/**
 * @file RobotChatPanel.tsx
 * @description Chat panel for direct communication with a specific robot
 * @feature robots
 */

import { memo, useEffect, useCallback, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button, EmptyState, Spinner, StatusTag } from '@/shared/components/ui';
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
  /** Render the panel's own title/status header (default true). Set false when an
   *  outer container already provides a header. */
  showHeader?: boolean;
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
  showHeader = true,
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

  const { isConnected } = useA2AStream();

  // Always use direct mode for robot chat
  useEffect(() => {
    setChatMode('direct');
  }, [setChatMode]);

  // Refs for frequently-changing values to prevent effect re-fires
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const currentConversationRef = useRef(currentConversation);
  currentConversationRef.current = currentConversation;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const hasInitConversation = useRef(false);

  useEffect(() => {
    hasInitConversation.current = false;
  }, [robotId]);

  // Get or create the conversation for this robot
  useEffect(() => {
    if (hasInitConversation.current || !agentUrl) return;

    const initConversation = async () => {
      const convos = conversationsRef.current;
      const currentConvo = currentConversationRef.current;
      const robotConvo = convos.find(
        (c) => c.robotId === robotId || c.name === `Chat with ${robotName}`
      );

      if (robotConvo) {
        hasInitConversation.current = true;
        if (currentConvo?.conversationId !== robotConvo.conversationId) {
          selectConversation(robotConvo.conversationId);
        }
      } else if (!isLoadingRef.current) {
        hasInitConversation.current = true;
        try {
          await createConversation(robotId, `Chat with ${robotName}`);
        } catch {
          // Error handled by store — allow retry
          hasInitConversation.current = false;
        }
      }
    };

    void initConversation();
  }, [robotId, robotName, agentUrl, conversations, selectConversation, createConversation]);

  const handleNewConversation = useCallback(async () => {
    try {
      await createConversation(robotId, `Chat with ${robotName}`);
    } catch {
      // Error handled by store
    }
  }, [createConversation, robotId, robotName]);

  if (!agentUrl) {
    return (
      <div className={cn('flex flex-col items-center justify-center p-6', className)}>
        <EmptyState
          icon={<MessageSquare />}
          title="A2A Chat Not Available"
          description="This robot has no A2A agent configured. Chat becomes available once the robot's A2A endpoint is registered."
        />
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {showHeader && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink-primary">
            <MessageSquare className="h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} />
            <span className="truncate">Chat with {robotName}</span>
          </span>
          {/* The stream is the app's link to the server, not to the robot. */}
          <StatusTag tone={isConnected ? 'live' : 'neutral'} dot>
            {isConnected ? 'Server linked' : 'Server offline'}
          </StatusTag>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-signal-stopped/30 bg-signal-stopped/10 px-5 py-2 text-sm text-signal-stopped"
        >
          <span className="min-w-0">{error}</span>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading && !currentConversation ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size="lg" color="primary" label="Loading…" />
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
