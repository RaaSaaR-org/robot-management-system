/**
 * @file VoiceConversation.tsx
 * @description Scrollable voice conversation feed: messages typed for the robot
 *              to speak (right, primary tint), what the robot microphone heard
 *              (left, dashed), agent replies spoken back (left), plus error rows
 *              and session-reset dividers. Auto-follows the newest entry unless
 *              the user scrolled up.
 * @feature robots
 */

import { memo, useEffect, useRef } from 'react';
import { Bot, Mic, Volume2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { EmptyState } from '@/shared/components/ui';
import type { VoiceHistoryEntry } from '../../types/voice.types';

const META_ICON = 'h-3.5 w-3.5';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export interface VoiceConversationProps {
  entries: VoiceHistoryEntry[];
  className?: string;
}

/** The voice history feed (spoken / heard / replies / errors / resets). */
export const VoiceConversation = memo(function VoiceConversation({
  entries,
  className,
}: VoiceConversationProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  if (entries.length === 0) {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <EmptyState
          size="sm"
          icon={<Volume2 />}
          title="No voice activity yet"
          description="Type a message below and the robot says it out loud. Anything its microphone hears shows up here too."
        />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={cn('flex flex-col gap-3 overflow-y-auto pr-1', className)}
      role="log"
      aria-label="Voice conversation history"
      data-testid="voice-conversation"
    >
      {entries.map((entry) => {
        if (entry.kind === 'reset') {
          return (
            <div key={entry.id} className="my-1 flex items-center gap-2" aria-label="New session">
              <div className="h-px flex-1 bg-line" />
              <span className="text-[11px] text-ink-tertiary">New session · {formatTime(entry.ts)}</span>
              <div className="h-px flex-1 bg-line" />
            </div>
          );
        }

        if (entry.kind === 'error') {
          return (
            <div
              key={entry.id}
              className="max-w-[85%] self-start rounded-control border border-signal-stopped/30 bg-signal-stopped/10 px-3 py-2 text-xs text-signal-stopped"
            >
              {entry.text}
              <span className="mt-0.5 block text-[11px] text-ink-tertiary">{formatTime(entry.ts)}</span>
            </div>
          );
        }

        const isTyped = entry.kind === 'typed';
        const meta =
          entry.kind === 'typed'
            ? { icon: <Volume2 className={META_ICON} strokeWidth={1.75} />, label: 'Spoken by robot' }
            : entry.kind === 'heard'
              ? { icon: <Mic className={META_ICON} strokeWidth={1.75} />, label: 'Robot heard' }
              : { icon: <Bot className={META_ICON} strokeWidth={1.75} />, label: 'Robot replied' };

        return (
          <div
            key={entry.id}
            className={cn('flex max-w-[85%] flex-col', isTyped ? 'items-end self-end' : 'items-start self-start')}
          >
            <div
              className={cn(
                'mb-1 flex items-center gap-1 text-[11px] text-ink-tertiary',
                isTyped && 'flex-row-reverse'
              )}
            >
              {meta.icon}
              <span>
                {meta.label}
                {entry.language ? ` · ${entry.language.toUpperCase()}` : ''} · {formatTime(entry.ts)}
              </span>
            </div>
            <div
              className={cn(
                'whitespace-pre-wrap break-words rounded-control border px-3 py-2 text-sm leading-relaxed',
                isTyped
                  ? 'border-primary/30 bg-primary/10 text-ink-primary'
                  : entry.kind === 'heard'
                    ? 'border-dashed border-line bg-inset italic text-ink-secondary'
                    : 'border-line bg-inset text-ink-primary'
              )}
            >
              {entry.text}
            </div>
          </div>
        );
      })}
    </div>
  );
});
