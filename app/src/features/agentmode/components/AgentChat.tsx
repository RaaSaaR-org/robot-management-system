/**
 * @file AgentChat.tsx
 * @description Agent Mode conversation — commands, replies and the block cards
 *              the triggering command produced, rendered inline underneath it.
 * @feature agentmode
 */

import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Mic, SendHorizontal } from 'lucide-react';
import { Button, Eyebrow, Panel, Textarea } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
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
import { PlaceChip } from './PlaceChip';
import type { AgentBlockKind, AgentChatMessage, AgentPlan } from '../types/agentmode.types';

export interface AgentChatProps {
  /** Robot the commands are sent to. */
  robotId: string | null;
  /**
   * Control rendered to the left of the textarea — the page passes the inline
   * `AgentVoiceBar`. Left undefined the composer renders without it, which is
   * what keeps this component's own tests free of the voice SSE hook.
   */
  composerLeading?: ReactNode;
  /**
   * The robot exists but could not be asked what it is doing.
   *
   * Deliberately duplicated with the condition stack above the page: that notice
   * qualifies the PAGE, this line qualifies the ACT OF TYPING. They are the two
   * different ways the operator is about to be wrong, and the second one is only
   * useful where the operator meets it — right where they are about to send a
   * command against data that may be minutes old.
   */
  stateUnknown?: boolean;
  className?: string;
}

/**
 * Blocks whose outcome depends on where the robot is standing when the plan
 * starts. A `speak` or `remember` block does not care; a `walk` does.
 *
 * `vla_skill` (TASK-226) is one of them, and is the strictest of the four: a
 * manipulation policy reaches from wherever the robot happens to be, and Mobi-π
 * (arXiv 2505.23692) measured the base-pose deviation that HALVES success at
 * 0.031 m for one task. A rollout planned against a stale place is a rollout
 * that reaches for empty air, so the warning this list drives is exactly the
 * one the operator wants before that block runs.
 */
const PLACE_DEPENDENT_KINDS: readonly AgentBlockKind[] = ['walk', 'turn', 'goto', 'vla_skill'];

/** Whether this plan moves the robot, i.e. whether its starting place matters. */
function movesFromWhereItStands(plan: AgentPlan): boolean {
  return plan.blocks.some((block) => PLACE_DEPENDENT_KINDS.includes(block.kind));
}

/** Ready-made commands offered on the empty state. */
const SUGGESTIONS = [
  'walk to the table with the hat',
  'turn left and look around',
  'greet the person in the room',
];

/**
 * What the acknowledgement bubble says once the plan it announced has moved on.
 *
 * The robot answers a command with "Planning…" and the bubble used to keep
 * saying that forever, next to a rail reading "Done": two truths of different
 * ages on one screen. The bubble follows the plan while it has one, so the
 * transcript reads like a conversation, not a log of first replies.
 */
export function ackTextFor(message: AgentChatMessage, plan: AgentPlan | null): string {
  if (!message.showsPlan || !plan || plan.id !== message.planId) return message.text;
  switch (plan.status) {
    case 'planning':
      return message.text;
    case 'running':
      return 'On it.';
    case 'done':
      return 'Done.';
    case 'failed':
      return 'That did not work.';
    case 'aborted':
      return 'Stopped.';
    default:
      return message.text;
  }
}

function MessageRow({ message, plan }: { message: AgentChatMessage; plan: AgentPlan | null }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        data-testid={isUser ? 'agent-user-message' : 'agent-agent-message'}
        className={cn(
          'max-w-[85%] rounded-control px-3.5 py-2.5 text-sm leading-snug whitespace-pre-wrap',
          isUser
            ? 'bg-primary/15 text-ink-primary border border-primary/30'
            : message.isError
              ? 'border border-signal-stopped/40 bg-signal-stopped/10 text-signal-stopped'
              : 'bg-inset text-ink-primary border border-line-subtle'
        )}
      >
        {ackTextFor(message, plan)}
      </div>

      {/* A heard command is not a typed one: the words went through a speech
          model first, so the operator has to be able to see that this is a
          transcript before judging a plan that misread it. */}
      {message.spokenLanguage && (
        <span
          data-testid="agent-spoken-marker"
          className="mt-1 inline-flex items-center gap-1 text-xs text-ink-muted"
        >
          <Mic className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          heard · {message.spokenLanguage.toUpperCase()}
        </span>
      )}

      {/* Blocks the command produced, inline underneath its acknowledgement */}
      {message.showsPlan && plan && (
        <div className="w-full mt-2 space-y-2">
          {/* The belief asserted exactly where it becomes load-bearing: a plan
              that walks, turns or goes somewhere is only correct relative to
              where the robot currently thinks it stands. An unknown place is
              not hidden here — it is the whole point of showing it. */}
          {movesFromWhereItStands(plan) && (
            <div className="flex items-center gap-2 flex-wrap">
              <Eyebrow>Starting from</Eyebrow>
              {/* `testId={null}`: the status rail owns `agent-scene-place`, and
                  two elements answering one selector is an ambiguity, not a
                  second guarantee. */}
              <PlaceChip testId={null} />
            </div>
          )}

          <div
            data-testid="agent-plan-blocks"
            data-plan-id={plan.id}
            className="space-y-2"
          >
            {plan.blocks.map((block, index) => (
              <BlockCard key={block.id} block={block} index={index} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The conversation. Enter sends, Shift+Enter adds a newline — same idiom as
 * the A2A conversation panel.
 */
export const AgentChat = memo(function AgentChat({
  robotId,
  composerLeading,
  stateUnknown,
  className,
}: AgentChatProps) {
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

  /**
   * The plan the robot is holding, when this console has no transcript for it.
   *
   * The conversation lives in this tab: a reload, or a plan adopted from a
   * state snapshot this console was not open for, leaves the store with a plan
   * nobody here wrote a line about while the status rail (reading the same
   * store) says "Done" or shows a running block. Two truths on one screen, and
   * the older-looking one is the empty state. So a plan without a transcript is
   * rendered as the exchange it was — marked as read from the robot, because
   * this console did not see it happen.
   *
   * The test is whether any line already RENDERS this plan, never whether the
   * conversation is empty. Emptiness was the wrong question in both directions:
   * the echo the store writes for a plan somebody else started was itself
   * enough to switch the fallback off, and on a reload the closing "Plan
   * completed" summary — one message, arriving after the fact — made the whole
   * restored exchange disappear from under the operator.
   */
  const restoredRows = useMemo<AgentChatMessage[] | null>(() => {
    if (!plan) return null;
    if (messages.some((m) => m.showsPlan && m.planId === plan.id)) return null;
    return [
      { id: `${plan.id}-command`, role: 'user', text: plan.command, timestamp: plan.createdAt, planId: plan.id },
      {
        id: `${plan.id}-ack`,
        role: 'agent',
        text: 'Planning…',
        timestamp: plan.createdAt,
        planId: plan.id,
        showsPlan: true,
        ...(plan.language ? { spokenLanguage: plan.language } : {}),
      },
    ];
  }, [messages, plan]);

  /**
   * The conversation with the restored exchange spliced into it.
   *
   * It goes where it happened: ahead of the first line that talks about this
   * plan — the closing summary is the one line a live run pushes without an
   * acknowledgement in front of it — and otherwise at the end, after whatever
   * this console was saying before the robot took a command from elsewhere.
   */
  const rows = useMemo<AgentChatMessage[]>(() => {
    if (!restoredRows) return messages;
    const at = messages.findIndex((m) => m.planId === plan?.id);
    if (at === -1) return [...messages, ...restoredRows];
    return [...messages.slice(0, at), ...restoredRows, ...messages.slice(at)];
  }, [messages, restoredRows, plan?.id]);

  /** Where the "read from the robot" caption goes — right above what it labels. */
  const restoredFirstId = restoredRows?.[0]?.id ?? null;

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

  const canSubmit = Boolean(inputValue.trim()) && canSend && !isSending;

  return (
    <Panel
      as="section"
      data-testid="agent-chat"
      className={cn('flex min-w-0 flex-col overflow-hidden', className)}
    >
      <Panel.Header title="Conversation" borderless />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-8 text-center">
            <p className="max-w-sm text-sm text-ink-secondary">
              Say what the robot should do. The local planner turns it into blocks and runs them
              one by one.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setInputValue(suggestion);
                    inputRef.current?.focus();
                  }}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((message) => (
              <Fragment key={message.id}>
                {message.id === restoredFirstId && (
                  <p className="text-center text-xs text-ink-muted" data-testid="agent-chat-restored">
                    Read from the robot — this console was not open when it ran.
                  </p>
                )}
                <MessageRow
                  message={message}
                  plan={
                    message.showsPlan && message.planId
                      ? plansById.get(message.planId) ?? null
                      : null
                  }
                />
              </Fragment>
            ))}

            {isPlanning && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-control border border-line-subtle bg-inset px-3.5 py-2.5">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                  <span className="ml-1.5 text-xs text-ink-muted">Planning…</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-line-subtle px-5 py-3">
        {/* One short neutral hint, only while it is true. The condition stack
            above the page carries the full story; this line qualifies the act
            of typing, right where the operator is about to act on old data. */}
        {stateUnknown && (
          <p data-testid="agent-state-unknown-note" className="mb-2 text-xs text-ink-muted">
            Commands wait until the robot answers.
          </p>
        )}

        <div className="flex items-end gap-2">
          {composerLeading}
          <Textarea
            ref={inputRef}
            data-testid="agent-command-input"
            aria-label="Command"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={!canSend || isSending}
            rows={1}
            className={cn(
              'min-h-10 max-h-24 flex-1 resize-none overflow-y-auto',
              // `truncate` on the placeholder only — long copy ellipsizes on a
              // phone instead of wrapping into a line the 40px height clips.
              'placeholder:truncate'
            )}
          />
          <Button
            type="submit"
            data-testid="agent-send-button"
            aria-label="Send command"
            disabled={!canSubmit}
            leftIcon={<SendHorizontal className="h-4 w-4" strokeWidth={1.75} />}
            // 44px touch target on coarse pointers (WCAG 2.5.5).
            className="h-10 shrink-0 pointer-coarse:h-11 pointer-coarse:min-w-11"
          >
            Send
          </Button>
        </div>
      </form>
    </Panel>
  );
});
