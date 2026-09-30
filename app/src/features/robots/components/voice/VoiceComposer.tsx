/**
 * @file VoiceComposer.tsx
 * @description Composer for the voice tab: type a message, say which language
 *              it is in (DE/EN) and, separately, which voice pack speaks it;
 *              the robot says it through its speaker (Enter sends, Shift+Enter
 *              breaks the line). The pack list comes from the robot, and a
 *              non-commercial or non-real-time pack carries a badge. Disabled
 *              with a hint while the service is down.
 * @feature robots
 */

import { memo, useCallback, useState, type KeyboardEvent } from 'react';
import { Volume2 } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Badge, Button, SegmentedControl, Select, Textarea, errorMessage } from '@/shared/components/ui';
import type { VoiceLanguage, VoicePack } from '../../types/voice.types';

const MAX_TEXT_LENGTH = 500;

export interface VoiceComposerProps {
  /** Speak the text through the robot; resolves when accepted upstream */
  onSay: (text: string, language: VoiceLanguage) => Promise<void>;
  /** Composer is disabled while the voice service is unreachable */
  disabled: boolean;
  /** The robot's voice packs; the picker is hidden while the list is empty */
  voices?: VoicePack[];
  /** Selected pack id (null = none known yet) */
  voice?: string | null;
  onVoiceChange?: (voiceId: string) => void;
  className?: string;
}

/**
 * The two caveats a customer must see before relying on a voice: may it be
 * shipped, and is it fast enough for a conversation. Silence means "yes".
 */
export function VoicePackBadges({ pack }: { pack: VoicePack }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="voice-pack-badges">
      {!pack.commercial && (
        <Badge variant="warning" size="sm" title={`Licence: ${pack.licence}`} data-testid="voice-pack-licence">
          Non-commercial · {pack.licence}
        </Badge>
      )}
      {!pack.realtime && (
        <Badge
          variant="info"
          size="sm"
          title="Synthesis is slower than speech — expect a pause before the robot speaks"
          data-testid="voice-pack-slow"
        >
          Not real-time
        </Badge>
      )}
    </span>
  );
}

/** Text → robot speech composer: a language toggle and, separately, a voice pack. */
export const VoiceComposer = memo(function VoiceComposer({
  onSay,
  disabled,
  voices = [],
  voice = null,
  onVoiceChange = () => undefined,
  className,
}: VoiceComposerProps) {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<VoiceLanguage>('de');
  const selectedPack = voices.find((pack) => pack.id === voice) ?? null;
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
    } catch (err) {
      // A 4xx names the problem (unknown or unloaded voice pack) — show it;
      // anything else is the old "cannot reach" case.
      setError(errorMessage(err, 'Could not reach the robot speaker — check the voice service.'));
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
              { value: 'de', label: 'DE', title: 'The text is German' },
              { value: 'en', label: 'EN', title: 'The text is English' },
            ]}
            value={language}
            onChange={setLanguage}
            label="Speech language"
            size="sm"
          />
          {voices.length > 0 && (
            <Select
              size="sm"
              fullWidth={false}
              value={voice ?? ''}
              onChange={(event) => onVoiceChange(event.target.value)}
              disabled={disabled}
              aria-label="Voice pack"
              data-testid="voice-pack-select"
            >
              {voices.map((pack) => (
                <option
                  key={pack.id}
                  value={pack.id}
                  disabled={!pack.available}
                  title={pack.available ? pack.licence : (pack.reason ?? 'Not loaded on this robot')}
                >
                  {pack.available ? pack.label : `${pack.label} (unavailable)`}
                </option>
              ))}
            </Select>
          )}
          {selectedPack && <VoicePackBadges pack={selectedPack} />}
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
