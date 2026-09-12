/**
 * @file VoiceStateBadge.tsx
 * @description Live pipeline state of the voice service (listening / thinking /
 *              speaking / paused …) as a StatusTag; pulses while active.
 * @feature robots
 */

import { memo } from 'react';
import { StatusTag, type Tone } from '@/shared/components/ui';
import type { VoicePipelineState } from '../../types/voice.types';

const STATE_STYLES: Record<VoicePipelineState, { label: string; tone: Tone; pulse: boolean }> = {
  idle: { label: 'Idle', tone: 'neutral', pulse: false },
  listening: { label: 'Listening', tone: 'live', pulse: true },
  capturing: { label: 'Capturing speech', tone: 'sim', pulse: true },
  thinking: { label: 'Thinking', tone: 'gated', pulse: true },
  speaking: { label: 'Speaking', tone: 'sim', pulse: true },
  paused: { label: 'Mic paused', tone: 'neutral', pulse: false },
  unknown: { label: 'Unknown', tone: 'neutral', pulse: false },
};

export interface VoiceStateBadgeProps {
  state: VoicePipelineState;
  className?: string;
}

/** Pipeline state tag, e.g. "● Listening". */
export const VoiceStateBadge = memo(function VoiceStateBadge({
  state,
  className,
}: VoiceStateBadgeProps) {
  const style = STATE_STYLES[state] ?? STATE_STYLES.unknown;
  return (
    <span className={className} data-testid="voice-state-badge">
      <StatusTag tone={style.tone} dot pulse={style.pulse}>
        {style.label}
      </StatusTag>
    </span>
  );
});
