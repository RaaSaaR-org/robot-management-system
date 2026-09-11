/**
 * @file VoiceComposer.tsx
 * @description Composer for the voice tab: type a message, pick DE/EN, and the
 *              robot speaks it through its speaker (Enter sends, Shift+Enter
 *              breaks the line). Disabled with a hint while the service is down.
 * @feature robots
 */

import { memo, useCallback, useState, type KeyboardEvent } from 'react';
import { Volume2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button, SegmentedControl, Textarea } from '@/shared/components/ui';
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
        <p role="alert" className="text-xs text-signal-stopped">
          {error}
        </p>
      )}
      <Textarea
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
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <SegmentedControl<VoiceLanguage>
            options={[
              { value: 'de', label: 'DE', title: 'Speak German (Piper Thorsten)' },
              { value: 'en', label: 'EN', title: 'Speak English (Piper Lessac)' },
            ]}
            value={language}
            onChange={setLanguage}
            label="Speech language"
            size="sm"
          />
          <span className="text-xs tabular-nums text-ink-tertiary">
            {text.length}/{MAX_TEXT_LENGTH}
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => void handleSend()}
          disabled={!canSend}
          isLoading={isSending}
          loadingText="Speaking…"
          leftIcon={<Volume2 className="h-4 w-4" strokeWidth={1.75} />}
          data-testid="voice-speak-button"
        >
          Speak
        </Button>
      </div>
    </div>
  );
});
