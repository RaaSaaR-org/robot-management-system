/**
 * @file VoicePipelinePanel.tsx
 * @description Side panel of the voice tab: live pipeline state, mic pause /
 *              session-reset controls, robot speaker volume, component health
 *              (STT / TTS / agent / audio I/O), turn latency and a low-level
 *              mic activity log (discarded / wake-ignored / TTS events).
 * @feature robots
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { cn } from '@/shared/utils';
import { VoiceStateBadge } from './VoiceStateBadge';
import type {
  VoiceHealth,
  VoiceMicActivity,
  VoicePipelineState,
  VoiceStatus,
} from '../../types/voice.types';

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

function HealthChip({ label, ok }: { label: string; ok: boolean | null | undefined }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium',
        ok
          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500 dark:text-emerald-300'
          : 'bg-gray-500/10 border-gray-500/25 text-theme-tertiary'
      )}
      title={ok ? `${label}: ready` : `${label}: unavailable`}
    >
      <span className={cn('w-1 h-1 rounded-full', ok ? 'bg-emerald-400' : 'bg-gray-400')} />
      {label}
    </span>
  );
}

function formatLatency(seconds: number | undefined): string {
  if (seconds === undefined) return '—';
  return seconds >= 1 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds * 1000)} ms`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface VoicePipelinePanelProps {
  pipelineState: VoicePipelineState;
  paused: boolean;
  micLoopDisabled: string | null;
  micActivity: VoiceMicActivity[];
  health: VoiceHealth | null;
  status: VoiceStatus | null;
  /** Voice service reachable (controls are disabled otherwise) */
  available: boolean;
  onToggleListen: () => Promise<void>;
  onResetSession: () => Promise<void>;
  onGetVolume: () => Promise<number>;
  onSetVolume: (volume: number) => Promise<void>;
  className?: string;
}

/** Right-hand pipeline/status panel of the voice tab. */
export const VoicePipelinePanel = memo(function VoicePipelinePanel({
  pipelineState,
  paused,
  micLoopDisabled,
  micActivity,
  health,
  status,
  available,
  onToggleListen,
  onResetSession,
  onGetVolume,
  onSetVolume,
  className,
}: VoicePipelinePanelProps) {
  const [volume, setVolume] = useState<number | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const adapterUp = health?.adapter != null;

  // Volume lives on the audio adapter; fetch once it is reachable.
  useEffect(() => {
    if (!adapterUp) {
      setVolume(null);
      return;
    }
    let cancelled = false;
    onGetVolume()
      .then((v) => {
        if (!cancelled) setVolume(v);
      })
      .catch(() => {
        if (!cancelled) setVolume(null);
      });
    return () => {
      cancelled = true;
    };
  }, [adapterUp, onGetVolume]);

  const commitVolume = useCallback(
    (next: number) => {
      onSetVolume(next).catch(() => {
        // Re-sync with the adapter on failure.
        onGetVolume().then(setVolume).catch(() => setVolume(null));
      });
    },
    [onSetVolume, onGetVolume]
  );

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setIsBusy(true);
    try {
      await action();
    } catch {
      // Health polling surfaces the outage; nothing else to do here.
    } finally {
      setIsBusy(false);
    }
  }, []);

  const service = health?.service ?? null;
  const turnMetrics = status?.metrics ?? {};

  const actionButton =
    'flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-theme text-theme-secondary ' +
    'hover:text-theme-primary hover:bg-theme-elevated transition-colors duration-150 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* State + controls */}
      <section className="flex flex-col gap-3 p-3 rounded-xl glass-subtle border border-theme">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-theme-tertiary">
            Pipeline
          </h3>
          <VoiceStateBadge state={pipelineState} />
        </div>

        {micLoopDisabled && (
          <p className="text-[11px] text-amber-500 dark:text-amber-300">
            Mic loop disabled — missing: {micLoopDisabled}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            className={actionButton}
            disabled={!available || isBusy}
            onClick={() => void runAction(onToggleListen)}
            data-testid="voice-listen-toggle"
          >
            {paused ? 'Resume mic' : 'Pause mic'}
          </button>
          <button
            type="button"
            className={actionButton}
            disabled={!available || isBusy}
            onClick={() => void runAction(onResetSession)}
            data-testid="voice-session-reset"
          >
            New session
          </button>
        </div>

        {/* Speaker volume (G1 audio adapter) */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-theme-tertiary w-14 shrink-0">Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={volume ?? 0}
            disabled={!adapterUp || volume === null}
            onChange={(event) => setVolume(Number(event.target.value))}
            onMouseUp={() => volume !== null && commitVolume(volume)}
            onTouchEnd={() => volume !== null && commitVolume(volume)}
            onKeyUp={(event) => {
              if (volume !== null && (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End')) {
                commitVolume(volume);
              }
            }}
            className="flex-1 accent-[#2A5FFF] disabled:opacity-40"
            aria-label="Robot speaker volume"
          />
          <span className="text-[11px] text-theme-secondary tabular-nums w-8 text-right">
            {volume === null ? '—' : `${volume}`}
          </span>
        </div>
      </section>

      {/* Component health */}
      <section className="flex flex-col gap-2 p-3 rounded-xl glass-subtle border border-theme">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-theme-tertiary">
          Components
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <HealthChip label="Mic" ok={service?.components.audio_in} />
          <HealthChip label="Speaker" ok={service?.components.audio_out} />
          <HealthChip label="STT" ok={service?.models_loaded.stt} />
          <HealthChip label="TTS" ok={service?.models_loaded.tts} />
          <HealthChip label="Agent" ok={service?.agent_reachable} />
          <HealthChip label="Adapter" ok={adapterUp} />
        </div>
        {(turnMetrics.stt || turnMetrics.agent || turnMetrics.tts) && (
          <dl className="grid grid-cols-3 gap-1 mt-1 text-center">
            {(['stt', 'agent', 'tts'] as const).map((key) => (
              <div key={key} className="rounded-lg bg-theme-elevated/50 px-1 py-1.5">
                <dt className="text-[9px] uppercase tracking-wider text-theme-tertiary">{key} p50</dt>
                <dd className="text-[11px] font-medium text-theme-secondary tabular-nums">
                  {formatLatency(turnMetrics[key]?.p50)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* Low-level mic activity */}
      <section className="flex flex-col gap-2 p-3 rounded-xl glass-subtle border border-theme min-h-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-theme-tertiary">
          Mic activity
        </h3>
        {micActivity.length === 0 ? (
          <p className="text-[11px] text-theme-tertiary">
            Nothing yet — VAD segments, ignored utterances and TTS events show up here.
          </p>
        ) : (
          <ul className="flex flex-col-reverse gap-1 overflow-y-auto max-h-40 pr-1">
            {micActivity.map((item) => (
              <li key={item.id} className="flex items-baseline gap-2 text-[11px]">
                <span className="text-theme-tertiary tabular-nums shrink-0">{formatTime(item.ts)}</span>
                <span className="text-theme-secondary">{item.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
});
