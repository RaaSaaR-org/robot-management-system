/**
 * @file ConversationPanel.tsx
 * @description Full-screen chat interface with bottom-to-top messages
 * @feature a2a
 */

import { memo, useRef, useEffect, useState, useCallback, useMemo, type FormEvent, type KeyboardEvent } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { MessageBubble } from './MessageBubble';
import { OrchestrationTimeline } from './OrchestrationTimeline';
import { useConversation } from '../hooks';
import { useA2AStore, selectPendingMessages } from '../store';
import type { A2AAgentCard, A2ATask, A2AChatMode } from '../types';

interface ConversationPanelProps {
  conversationId: string | null;
  targetAgent?: A2AAgentCard;
  chatMode?: A2AChatMode;
  className?: string;
  onNewConversation?: () => void;
  activeTasks?: A2ATask[];
}

// Icons
function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
      />
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
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  );
}

/**
 * Task status badge for inline display
 */
function TaskBadge({ state }: { state: string }) {
  const stateConfig: Record<string, { bg: string; text: string; label: string; pulse?: boolean }> = {
    submitted: { bg: 'glass-subtle', text: 'text-primary-600 dark:text-primary-400', label: 'Submitted' },
    working: { bg: 'bg-primary-100/50 dark:bg-primary-900/30', text: 'text-primary-600 dark:text-primary-400', label: 'Working', pulse: true },
    input_required: { bg: 'bg-amber-100/50 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', label: 'Input Required', pulse: true },
    completed: { bg: 'bg-green-100/50 dark:bg-green-900/30', text: 'text-green-600 dark:text-green-400', label: 'Done' },
    failed: { bg: 'bg-red-100/50 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400', label: 'Failed' },
  };

  const config = stateConfig[state] || stateConfig.submitted;

  return (
    <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium transition-all', config.bg, config.text)}>
      {config.pulse && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1.5" />
      )}
      {config.label}
    </span>
  );
}

/**
 * Full-screen conversation panel with chat interface
 */
export const ConversationPanel = memo(function ConversationPanel({
  conversationId,
  targetAgent,
  chatMode = 'direct',
  className,
  onNewConversation,
  activeTasks = [],
}: ConversationPanelProps) {
  const {
    messages,
    isLoading,
    isSending,
    error,
    sendMessage,
  } = useConversation(conversationId);

  const pendingMessages = useA2AStore(selectPendingMessages);

  const [inputValue, setInputValue] = useState('');
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Optimistic orchestration timeline — shows animated steps while waiting for response
  type OrchPhase = 'analyzing' | 'selecting' | 'forwarding' | 'waiting';
  const [orchPhase, setOrchPhase] = useState<OrchPhase | null>(null);
  const orchTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clear orchestration when a new AGENT message arrives (not user messages)
  const prevAgentMessageCountRef = useRef(0);
  useEffect(() => {
    const agentMsgCount = messages.filter((m) => m.role === 'agent').length;
    if (agentMsgCount > prevAgentMessageCountRef.current && orchPhase !== null) {
      setOrchPhase(null);
      orchTimerRef.current.forEach(clearTimeout);
      orchTimerRef.current = [];
    }
    prevAgentMessageCountRef.current = agentMsgCount;
  }, [messages, orchPhase]);

  // Start orchestration animation on send
  const handleOrchestrationStart = useCallback(() => {
    if (chatMode !== 'orchestration') return;
    orchTimerRef.current.forEach(clearTimeout);
    orchTimerRef.current = [];
    setOrchPhase('analyzing');
    // Stagger the phases for a realistic feel
    orchTimerRef.current.push(setTimeout(() => setOrchPhase('selecting'), 1200));
    orchTimerRef.current.push(setTimeout(() => setOrchPhase('forwarding'), 2800));
    orchTimerRef.current.push(setTimeout(() => setOrchPhase('waiting'), 4000));
  }, [chatMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => orchTimerRef.current.forEach(clearTimeout);
  }, []);

  // Extract agent name from the last orchestrated response for the timeline
  const lastOrchAgent = useMemo(() => {
    if (orchPhase === null) return undefined;
    // Check the latest agent message for metadata
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'agent' && (m.metadata as Record<string, unknown>)?.orchestrated) {
        return (m.metadata as Record<string, unknown>)?.agentName as string | undefined;
      }
    }
    return undefined;
  }, [messages, orchPhase]);

  // Check if any tasks require input
  const hasInputRequired = useMemo(
    () => activeTasks.some((t) => t.status.state === 'input_required'),
    [activeTasks]
  );

  // Check if user can send messages
  // In direct mode: need a target agent
  // In orchestration mode: always can send (host agent routes)
  const canSend = chatMode === 'orchestration' || !!targetAgent;

  // Get placeholder text based on mode
  const getPlaceholder = () => {
    if (chatMode === 'orchestration') {
      return 'Message all robots (AI will route to the right one)...';
    }
    if (targetAgent) {
      return `Message ${targetAgent.name}...`;
    }
    return 'Select a robot to start chatting...';
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when conversation changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  // Auto-resize textarea (capped at 96px to keep input fixed)
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    // Reset height to auto to get the correct scrollHeight
    e.target.style.height = 'auto';
    // Set height to scrollHeight, but cap at 96px (max-h-24)
    e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isSending) return;

    const message = inputValue.trim();
    setInputValue('');
    handleOrchestrationStart();
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    try {
      await sendMessage(message, targetAgent?.url);
    } catch {
      // Error is handled by the hook
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  // No conversation selected
  if (!conversationId) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full p-8', className)}>
        <div className="text-center max-w-md">
          <div className="glass-subtle w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center">
            <ChatIcon className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            No conversation selected
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Start a new conversation to begin chatting
          </p>
          {onNewConversation && (
            <Button onClick={onNewConversation} variant="primary" className="gap-2">
              <PlusIcon className="w-4 h-4" />
              Start New Conversation
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      {/* Messages area - scrollable, bottom-anchored */}
      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto flex flex-col-reverse"
      >
        <div className="px-3 py-4">
          {isLoading && messages.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF6700] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF6700] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF6700] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs">Loading...</span>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-gray-500">
              <ChatIcon className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-xs">No messages yet</p>
              <p className="text-[10px] mt-0.5 opacity-70">Send a message to start the conversation</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <MessageBubble
                  key={message.messageId}
                  message={message}
                  pendingStatus={pendingMessages[message.messageId]}
                />
              ))}

              {/* Orchestration timeline — shown during orchestrated message routing */}
              {chatMode === 'orchestration' && orchPhase !== null && (
                <OrchestrationTimeline
                  steps={[
                    ...(orchPhase ? [{ step: 'analyzing' as const, agentCount: 1 }] : []),
                    ...(['selecting', 'forwarding', 'waiting'].includes(orchPhase) ? [{ step: 'agent_selected' as const, agentName: lastOrchAgent || 'Selecting...' }] : []),
                    ...(['forwarding', 'waiting'].includes(orchPhase) ? [{ step: 'forwarding' as const, agentName: lastOrchAgent }] : []),
                  ]}
                />
              )}

              {/* Typing indicator — shown while waiting for agent response (direct mode only) */}
              {isSending && chatMode !== 'orchestration' && (
                <div className="flex justify-start">
                  <div className="glass-card rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Agent</div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#FF6700] animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 rounded-full bg-[#FF6700] animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 rounded-full bg-[#FF6700] animate-bounce" style={{ animationDelay: '300ms' }} />
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom section */}
      <div className="flex-shrink-0 border-t border-glass-subtle">
        {/* Active tasks inline */}
        {activeTasks.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto border-b border-gray-100 dark:border-gray-700/50">
            <span className="text-[10px] text-gray-400 flex-shrink-0">Active:</span>
            {activeTasks.slice(0, 3).map((task) => (
              <TaskBadge key={task.id} state={task.status.state} />
            ))}
            {activeTasks.length > 3 && (
              <span className="text-[10px] text-gray-400">+{activeTasks.length - 3}</span>
            )}
          </div>
        )}

        {/* Input required banner */}
        {hasInputRequired && (
          <div className="px-3 py-1.5 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 text-xs flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            <span>Input required</span>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
            {error}
          </div>
        )}

        {/* Input form */}
        <form onSubmit={handleSubmit} className="px-3 py-2.5">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={getPlaceholder()}
                disabled={isSending || !canSend}
                rows={1}
                className={cn(
                  'w-full resize-none rounded-xl border border-glass-subtle',
                  'glass-subtle px-3 py-2.5 text-sm',
                  'focus:ring-2 focus:ring-[#FF6700]/40 focus:border-[#FF6700]/50 focus:outline-none',
                  'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  'text-gray-900 dark:text-gray-100',
                  'transition-all duration-200',
                  'min-h-[40px] max-h-20 overflow-y-auto',
                  !canSend && 'opacity-50 cursor-not-allowed'
                )}
                style={{ height: 'auto', maxHeight: '80px' }}
              />
            </div>
            <button
              type="submit"
              disabled={!inputValue.trim() || isSending || !canSend}
              className={cn(
                'h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0',
                'transition-all duration-150',
                inputValue.trim() && canSend && !isSending
                  ? 'bg-[#FF6700] hover:bg-[#e55900] text-white shadow-md shadow-[#FF6700]/25 active:scale-95'
                  : isSending
                    ? 'bg-[#FF6700]/60 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
              )}
            >
              {isSending ? (
                <div className="flex gap-0.5">
                  <span className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              ) : (
                <SendIcon className="w-4 h-4" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});
