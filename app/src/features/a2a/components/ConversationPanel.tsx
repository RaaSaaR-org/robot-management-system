/**
 * @file ConversationPanel.tsx
 * @description Messages of one conversation plus the composer, bottom-anchored
 * @feature a2a
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MessageSquare, Plus, SendHorizontal } from 'lucide-react';
import { Button, EmptyState, Spinner, StatusTag, Textarea } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { MessageBubble } from './MessageBubble';
import { OrchestrationTimeline } from './OrchestrationTimeline';
import { TaskStatusBadge } from './TaskStatusBadge';
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

type OrchPhase = 'analyzing' | 'selecting' | 'forwarding' | 'waiting';

/**
 * Conversation panel: scrollable messages, active task tags, composer.
 */
export const ConversationPanel = memo(function ConversationPanel({
  conversationId,
  targetAgent,
  chatMode = 'direct',
  className,
  onNewConversation,
  activeTasks = [],
}: ConversationPanelProps) {
  const { messages, isLoading, isSending, error, sendMessage } = useConversation(conversationId);
  const pendingMessages = useA2AStore(selectPendingMessages);

  const [inputValue, setInputValue] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Optimistic orchestration timeline while waiting for the routed answer
  const [orchPhase, setOrchPhase] = useState<OrchPhase | null>(null);
  const orchTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevAgentCount = useRef(0);

  useEffect(() => {
    const agentCount = messages.filter((m) => m.role === 'agent').length;
    if (agentCount > prevAgentCount.current && orchPhase !== null) {
      setOrchPhase(null);
      orchTimers.current.forEach(clearTimeout);
      orchTimers.current = [];
    }
    prevAgentCount.current = agentCount;
  }, [messages, orchPhase]);

  const startOrchestration = useCallback(() => {
    if (chatMode !== 'orchestration') return;
    orchTimers.current.forEach(clearTimeout);
    orchTimers.current = [
      setTimeout(() => setOrchPhase('selecting'), 1200),
      setTimeout(() => setOrchPhase('forwarding'), 2800),
      setTimeout(() => setOrchPhase('waiting'), 4000),
    ];
    setOrchPhase('analyzing');
  }, [chatMode]);

  useEffect(() => () => orchTimers.current.forEach(clearTimeout), []);

  const lastOrchAgent = useMemo(() => {
    if (orchPhase === null) return undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const meta = messages[i].metadata as Record<string, unknown> | undefined;
      if (messages[i].role === 'agent' && meta?.orchestrated) return meta.agentName as string | undefined;
    }
    return undefined;
  }, [messages, orchPhase]);

  const hasInputRequired = activeTasks.some((t) => t.status.state === 'input_required');
  const canSend = chatMode === 'orchestration' || !!targetAgent;
  const placeholder =
    chatMode === 'orchestration'
      ? 'Message the fleet — the orchestrator picks the agent'
      : targetAgent
        ? `Message ${targetAgent.name}`
        : 'Choose an agent to start';

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || isSending || !canSend) return;
    setInputValue('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    startOrchestration();
    try {
      await sendMessage(text, targetAgent?.url);
    } catch {
      // the hook keeps the error
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as FormEvent);
    }
  };

  if (!conversationId) {
    return (
      <div className={cn('flex h-full items-center justify-center p-6', className)}>
        <EmptyState
          icon={<MessageSquare />}
          title="No conversation open"
          description="Start one to talk to an agent."
          action={
            onNewConversation && (
              <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={onNewConversation}>
                New conversation
              </Button>
            )
          }
        />
      </div>
    );
  }

  const orchSteps =
    orchPhase === null
      ? []
      : [
          { step: 'analyzing' as const },
          ...(orchPhase !== 'analyzing' ? [{ step: 'agent_selected' as const, agentName: lastOrchAgent }] : []),
          ...(orchPhase === 'forwarding' || orchPhase === 'waiting'
            ? [{ step: 'forwarding' as const, agentName: lastOrchAgent }]
            : []),
        ];

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div ref={messagesRef} className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        <div className="px-4 py-4">
          {isLoading && messages.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-tertiary">
              <Spinner size="sm" color="current" /> Loading messages…
            </div>
          ) : messages.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-tertiary">
              No messages yet. {canSend ? 'Say hello below.' : 'Choose an agent, then write below.'}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m) => (
                <MessageBubble
                  key={m.messageId}
                  message={m}
                  pendingStatus={pendingMessages[m.messageId]}
                  defaultAgentName={targetAgent?.name}
                />
              ))}
              {chatMode === 'orchestration' && orchSteps.length > 0 && <OrchestrationTimeline steps={orchSteps} />}
              {isSending && chatMode !== 'orchestration' && (
                <div className="flex items-center gap-2 self-start rounded-panel border border-line-subtle bg-inset px-4 py-2.5 text-xs text-ink-tertiary">
                  <Spinner size="xs" color="current" />
                  {targetAgent?.name ?? 'Agent'} is thinking…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-line-subtle">
        {(activeTasks.length > 0 || hasInputRequired) && (
          <div className="flex items-center gap-2 overflow-x-auto border-b border-line-subtle px-4 py-2">
            <span className="flex-shrink-0 text-xs text-ink-muted">Active tasks</span>
            {activeTasks.slice(0, 3).map((t) => (
              <TaskStatusBadge key={t.id} state={t.status.state} />
            ))}
            {activeTasks.length > 3 && <span className="text-xs text-ink-muted">+{activeTasks.length - 3}</span>}
            {hasInputRequired && <StatusTag tone="warning">Input required</StatusTag>}
          </div>
        )}
        {error && (
          <p role="alert" className="border-b border-line-subtle px-4 py-2 text-[13px] text-signal-stopped">
            {error}
          </p>
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-2 p-3">
          <Textarea
            ref={inputRef}
            rows={1}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              resize(e.target);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label="Message"
            disabled={isSending || !canSend}
            className="max-h-32 min-h-[38px] flex-1 resize-none"
          />
          <Button
            type="submit"
            iconOnly
            aria-label="Send message"
            isLoading={isSending}
            disabled={!inputValue.trim() || isSending || !canSend}
          >
            <SendHorizontal className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </form>
      </div>
    </div>
  );
});
