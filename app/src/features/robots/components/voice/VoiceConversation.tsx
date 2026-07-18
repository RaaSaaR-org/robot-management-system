/**
 * @file VoiceConversation.tsx
 * @description Scrollable voice conversation feed: messages typed for the robot
 *              to speak (right, accent), what the robot microphone heard (left,
 *              mic icon), agent replies spoken back (left, robot icon), plus
 *              error rows and session-reset dividers. Auto-follows the newest
 *              entry unless the user scrolled up.
 * @feature robots
 */

import { memo, useEffect, useRef } from 'react';
import { cn } from '@/shared/utils';
import { EmptyState } from '@/shared/components/ui';
import type { VoiceHistoryEntry } from '../../types/voice.types';

// ============================================================================
// ICONS
// ============================================================================

const MicIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
    />
  </svg>
);

const RobotIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 3v3m-6 3.75h12A2.25 2.25 0 0120.25 12v6A2.25 2.25 0 0118 20.25H6A2.25 2.25 0 013.75 18v-6A2.25 2.25 0 016 9.75zm2.25 4.5h.008v.008H8.25v-.008zm7.5 0h.008v.008h-.008v-.008z"
    />
  </svg>
);

const SpeakerIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
    />
  </svg>
);

// ============================================================================
// HELPERS
// ============================================================================

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ============================================================================
// COMPONENT
// ============================================================================

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

  // Auto-follow new entries, but respect a user who scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
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
          icon={<span className="text-theme-tertiary [&>svg]:w-10 [&>svg]:h-10">{SpeakerIcon}</span>}
          title="No voice activity yet"
          description="Type a message below and the robot will say it out loud. Anything the robot microphone hears shows up here too."
        />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={cn('overflow-y-auto pr-1 flex flex-col gap-2', className)}
      role="log"
      aria-label="Voice conversation history"
      data-testid="voice-conversation"
    >
      {entries.map((entry) => {
        if (entry.kind === 'reset') {
          return (
            <div key={entry.id} className="flex items-center gap-2 my-1" aria-label="New session">
              <div className="flex-1 h-px bg-theme-primary/10" />
              <span className="text-[10px] uppercase tracking-wider text-theme-tertiary">
                New session · {formatTime(entry.ts)}
              </span>
              <div className="flex-1 h-px bg-theme-primary/10" />
            </div>
          );
        }

        if (entry.kind === 'error') {
          return (
            <div
              key={entry.id}
              className="self-start max-w-[85%] px-3 py-2 rounded-xl text-xs bg-red-500/10 border border-red-500/25 text-red-400"
            >
              {entry.text}
              <span className="block mt-0.5 text-[10px] text-red-400/60">{formatTime(entry.ts)}</span>
            </div>
          );
        }

        const isTyped = entry.kind === 'typed';
        const meta =
          entry.kind === 'typed'
            ? { icon: SpeakerIcon, label: 'Spoken by robot' }
            : entry.kind === 'heard'
              ? { icon: MicIcon, label: 'Robot heard' }
              : { icon: RobotIcon, label: 'Robot replied' };

        return (
          <div
            key={entry.id}
            className={cn('flex flex-col max-w-[85%]', isTyped ? 'self-end items-end' : 'self-start items-start')}
          >
            <div
              className={cn(
                'flex items-center gap-1 mb-0.5 text-[10px] text-theme-tertiary',
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
                'px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words',
                isTyped
                  ? 'bg-cobalt-500/15 border border-cobalt-500/30 text-theme-primary'
                  : entry.kind === 'heard'
                    ? 'glass-subtle border border-dashed border-theme text-theme-secondary italic'
                    : 'glass-subtle border border-theme text-theme-primary'
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
