/**
 * @file VoiceStateBadge.tsx
 * @description Live pipeline state pill for the voice tab (listening / thinking /
 *              speaking / paused …) with a pulsing dot while the state is active.
 * @feature robots
 */

import { memo } from 'react';
import { cn } from '@/shared/utils';
import type { VoicePipelineState } from '../../types/voice.types';

interface StateStyle {
  label: string;
  dotClass: string;
  textClass: string;
  bgClass: string;
  pulse: boolean;
}

const STATE_STYLES: Record<VoicePipelineState, StateStyle> = {
  idle: {
    label: 'Idle',
    dotClass: 'bg-gray-400',
    textClass: 'text-theme-secondary',
    bgClass: 'bg-gray-500/10 border-gray-500/25',
    pulse: false,
  },
  listening: {
    label: 'Listening',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-500 dark:text-emerald-300',
    bgClass: 'bg-emerald-500/10 border-emerald-500/25',
    pulse: true,
  },
  capturing: {
    label: 'Capturing speech',
    dotClass: 'bg-cobalt-400',
    textClass: 'text-cobalt-500 dark:text-cobalt-300',
    bgClass: 'bg-cobalt-500/10 border-cobalt-500/30',
    pulse: true,
  },
  thinking: {
    label: 'Thinking',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-500 dark:text-amber-300',
    bgClass: 'bg-amber-500/10 border-amber-500/25',
    pulse: true,
  },
  speaking: {
    label: 'Speaking',
    dotClass: 'bg-cobalt-400',
    textClass: 'text-cobalt-500 dark:text-cobalt-300',
    bgClass: 'bg-cobalt-500/15 border-cobalt-500/40',
    pulse: true,
  },
  paused: {
    label: 'Mic paused',
    dotClass: 'bg-gray-400',
    textClass: 'text-theme-secondary',
    bgClass: 'bg-gray-500/10 border-gray-500/25',
    pulse: false,
  },
  unknown: {
    label: 'Unknown',
    dotClass: 'bg-gray-500',
    textClass: 'text-theme-tertiary',
    bgClass: 'bg-gray-500/5 border-gray-500/15',
    pulse: false,
  },
};

export interface VoiceStateBadgeProps {
  state: VoicePipelineState;
  className?: string;
}

/** Pipeline state pill, e.g. "● Listening". */
export const VoiceStateBadge = memo(function VoiceStateBadge({
  state,
  className,
}: VoiceStateBadgeProps) {
  const style = STATE_STYLES[state] ?? STATE_STYLES.unknown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium',
        style.bgClass,
        style.textClass,
        className
      )}
      data-testid="voice-state-badge"
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', style.dotClass, style.pulse && 'animate-pulse')} />
      {style.label}
    </span>
  );
});
