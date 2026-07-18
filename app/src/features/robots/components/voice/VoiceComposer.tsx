/**
 * @file VoiceComposer.tsx
 * @description Composer for the voice tab: type a message, pick DE/EN, and the
 *              robot speaks it through its speaker (Enter sends, Shift+Enter
 *              breaks the line). Disabled with a hint while the service is down.
 * @feature robots
 */

import { memo, useCallback, useState, type KeyboardEvent } from 'react';
import { cn } from '@/shared/utils';
import { SegmentedControl } from '@/shared/components/ui';
import type { VoiceLanguage } from '../../types/voice.types';

const MAX_TEXT_LENGTH = 500;

export interface VoiceComposerProps {
  /** Speak the text through the robot; resolves when accepted upstream */
  onSay: (text: string, language: VoiceLanguage) => Promise<void>;
  /** Composer is disabled while the voice service is unreachable */
  disabled: boolean;
  className?: string;
}

/** Text → robot speech composer with language toggle. */
export const VoiceComposer = memo(function VoiceComposer({
  onSay,
  disabled,
  className,
}: VoiceComposerProps) {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<VoiceLanguage>('de');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = !disabled && !isSending && text.trim().length > 0;

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isSending) return;
    setIsSending(true);
    setError(null);
    try {
      await onSay(trimmed, language);
      setText('');
    } catch {
      setError('Could not reach the robot speaker — check the voice service.');
    } finally {
      setIsSending(false);
    }
  }, [text, language, disabled, isSending, onSay]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      <div
        className={cn(
          'flex flex-col gap-2 p-3 rounded-xl glass-subtle border border-theme',
          disabled && 'opacity-60'
        )}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_TEXT_LENGTH))}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={2}
          placeholder={
            disabled
              ? 'Voice service offline — the robot cannot speak right now'
              : 'Type what the robot should say…'
          }
          aria-label="Message for the robot to speak"
          className={cn(
            'w-full resize-none bg-transparent text-sm text-theme-primary',
            'placeholder:text-theme-tertiary focus:outline-none'
          )}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SegmentedControl<VoiceLanguage>
              options={[
                { value: 'de', label: 'DE', title: 'Speak German (Piper Thorsten)' },
                { value: 'en', label: 'EN', title: 'Speak English (Piper Lessac)' },
              ]}
              value={language}
              onChange={setLanguage}
              label="Speech language"
            />
            <span className="text-[10px] text-theme-tertiary tabular-nums">
              {text.length}/{MAX_TEXT_LENGTH}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white',
              'transition-all duration-150',
              canSend
                ? 'bg-gradient-to-br from-cobalt-500 to-cobalt-700 hover:brightness-110 active:scale-95'
                : 'bg-gray-500/30 cursor-not-allowed'
            )}
            data-testid="voice-speak-button"
          >
            {/* speaker-wave icon */}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
              />
            </svg>
            {isSending ? 'Speaking…' : 'Speak'}
          </button>
        </div>
      </div>
    </div>
  );
});
