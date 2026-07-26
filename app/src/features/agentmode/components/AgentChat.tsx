/**
 * @file AgentChat.tsx
 * @description Agent Mode conversation — commands, replies and the block cards
 *              the triggering command produced, rendered inline underneath it.
 * @feature agentmode
 */

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/shared/utils';
import {
  useAgentModeStore,
  selectMessages,
  selectPlan,
  selectPlanHistory,
  selectIsSending,
  selectEstopActive,
  selectEnabled,
  selectPendingCommand,
} from '../store/agentmodeStore';
import { BlockCard } from './BlockCard';
import type { AgentChatMessage, AgentPlan } from '../types/agentmode.types';

export interface AgentChatProps {
  /** Robot the commands are sent to. */
  robotId: string | null;
  className?: string;
}

/** Ready-made commands offered on the empty state. */
const SUGGESTIONS = [
  'walk to the table with the hat',
  'turn left and look around',
  'greet the person in the room',
];

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
    </svg>
  );
}

function MessageRow({ message, plan }: { message: AgentChatMessage; plan: AgentPlan | null }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        data-testid={isUser ? 'agent-user-message' : 'agent-agent-message'}
        className={cn(
          'max-w-[85%] px-3.5 py-2.5 rounded-brand-lg text-sm leading-snug whitespace-pre-wrap',
          isUser
            ? 'bg-cobalt-500 text-white rounded-br-md'
            : message.isError
              ? 'bg-red-500/10 text-red-600 dark:text-red-400 rounded-bl-md border border-red-500/30'
              : 'glass-card text-theme-primary rounded-bl-md'
        )}
      >
        {message.text}
      </div>

      {/* Blocks the command produced, inline underneath its acknowledgement */}
      {message.showsPlan && plan && (
        <div
          data-testid="agent-plan-blocks"
          data-plan-id={plan.id}
          className="w-full mt-2 space-y-2"
        >
          {plan.blocks.map((block, index) => (
            <BlockCard key={block.id} block={block} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The conversation. Enter sends, Shift+Enter adds a newline — same idiom as
 * the A2A conversation panel.
 */
export const AgentChat = memo(function AgentChat({ robotId, className }: AgentChatProps) {
  // Actions are read once — subscribing to them would re-render on every event.
  const actions = useMemo(() => {
    const store = useAgentModeStore.getState();
    return { sendCommand: store.sendCommand };
  }, []);

  const messages = useAgentModeStore(selectMessages);
  const plan = useAgentModeStore(selectPlan);
  const planHistory = useAgentModeStore(selectPlanHistory);
  const isSending = useAgentModeStore(selectIsSending);
  const estopActive = useAgentModeStore(selectEstopActive);
  const enabled = useAgentModeStore(selectEnabled);
  const pendingCommand = useAgentModeStore(selectPendingCommand);

  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const plansById = useMemo(() => {
    const map = new Map<string, AgentPlan>();
    for (const p of planHistory) map.set(p.id, p);
    if (plan) map.set(plan.id, plan);
    return map;
  }, [plan, planHistory]);

  const canSend = Boolean(robotId) && enabled && !estopActive;
  const isPlanning = Boolean(pendingCommand) && plan?.id !== pendingCommand?.planId;

  // Keep the newest message in view.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, plan]);

  const submit = () => {
    const text = inputValue.trim();
    if (!text || !robotId || isSending || !canSend) return;
    setInputValue('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    void actions.sendCommand(robotId, text);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`;
  };

  const placeholder = !robotId
    ? 'Select a robot first…'
    : !enabled
      ? 'Agent Mode is off — turn it on to send commands'
      : estopActive
        ? 'E-Stop latched — reset it to send commands'
        : 'Tell the robot what to do, e.g. "walk to the table with the hat"';

  return (
    <div
      data-testid="agent-chat"
      className={cn('glass-card flex flex-col overflow-hidden', className)}
    >
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-8">
            <p className="text-theme-secondary text-sm">
              Say what the robot should do. The local planner turns it into blocks and
              runs them one by one.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setInputValue(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="glass-subtle px-3 py-1.5 text-xs text-theme-secondary hover:text-theme-primary transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                plan={
                  message.showsPlan && message.planId
                    ? plansById.get(message.planId) ?? null
                    : null
                }
              />
            ))}

            {isPlanning && (
              <div className="flex justify-start">
                <div className="glass-card rounded-brand-lg px-3.5 py-2.5 flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-cobalt-500 animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-cobalt-500 animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-cobalt-500 animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                  <span className="text-xs text-theme-muted ml-1.5">Planning…</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-glass-subtle px-3 py-2.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            data-testid="agent-command-input"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={!canSend || isSending}
            rows={1}
            className={cn(
              'flex-1 resize-none rounded-brand border border-glass-subtle glass-subtle',
              'px-3 py-2.5 text-sm text-theme-primary transition-all duration-200',
              'focus:ring-2 focus:ring-cobalt-500/40 focus:border-cobalt-500/50 focus:outline-none',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500',
              'min-h-[40px] max-h-24 overflow-y-auto',
              !canSend && 'opacity-50 cursor-not-allowed'
            )}
          />
          <button
            type="submit"
            data-testid="agent-send-button"
            aria-label="Send command"
            disabled={!inputValue.trim() || !canSend || isSending}
            className={cn(
              // 44x44 touch target on coarse pointers (WCAG 2.5.5).
              'h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11',
              'rounded-brand flex items-center justify-center shrink-0 transition-all duration-150',
              inputValue.trim() && canSend && !isSending
                ? 'bg-cobalt-500 hover:bg-cobalt-600 text-white active:scale-95'
                : 'bg-gray-200 dark:bg-gray-700 text-theme-muted'
            )}
          >
            <SendIcon className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
});
