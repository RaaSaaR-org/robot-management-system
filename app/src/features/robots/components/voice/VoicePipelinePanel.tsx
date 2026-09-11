/**
 * @file VoicePipelinePanel.tsx
 * @description Right column of the voice tab: live pipeline state, mic pause /
 *              session-reset controls, robot speaker volume, component health
 *              (STT / TTS / agent / audio I/O), turn latency and a low-level
 *              mic activity log (discarded / wake-ignored / TTS events).
 * @feature robots
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button, Panel, StatusTag } from '@/shared/components/ui';
import { Readout } from '../common';
import { VoiceStateBadge } from './VoiceStateBadge';
import type {
  VoiceHealth,
  VoiceMicActivity,
  VoicePipelineState,
  VoiceStatus,
} from '../../types/voice.types';

function HealthTag({ label, ok }: { label: string; ok: boolean | null | undefined }) {
  return (
    <span title={ok ? `${label}: ready` : `${label}: unavailable`}>
      <StatusTag tone={ok ? 'live' : 'neutral'} dot>
        {label}
      </StatusTag>
    </span>
  );
}

function formatLatency(seconds: number | undefined): string | null {
  if (seconds === undefined) return null;
  return seconds >= 1 ? seconds.toFixed(1) : String(Math.round(seconds * 1000));
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

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

/** Pipeline, component health and mic activity panels of the voice tab. */
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
      .then((v) => !cancelled && setVolume(v))
      .catch(() => !cancelled && setVolume(null));
    return () => {
      cancelled = true;
    };
  }, [adapterUp, onGetVolume]);

  const commitVolume = useCallback(
    (next: number) => {
      onSetVolume(next).catch(() => {
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

  return (
    <div className={cn('flex min-w-0 flex-col gap-6', className)}>
      <Panel>
        <Panel.Header title="Pipeline" actions={<VoiceStateBadge state={pipelineState} />} />
        <Panel.Body className="flex flex-col gap-4">
          {micLoopDisabled && (
            <p className="text-xs text-signal-unknown">Mic loop disabled — missing: {micLoopDisabled}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              disabled={!available || isBusy}
              onClick={() => void runAction(onToggleListen)}
              data-testid="voice-listen-toggle"
            >
              {paused ? 'Resume mic' : 'Pause mic'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              disabled={!available || isBusy}
              onClick={() => void runAction(onResetSession)}
              data-testid="voice-session-reset"
            >
              New session
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs text-ink-tertiary">Volume</span>
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
              className="flex-1 accent-primary disabled:opacity-40"
              aria-label="Robot speaker volume"
            />
            <span className="w-8 text-right text-xs tabular-nums text-ink-secondary">
              {volume === null ? '—' : volume}
            </span>
          </div>
        </Panel.Body>
      </Panel>

      <Panel>
        <Panel.Header title="Components" />
        <Panel.Body className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            <HealthTag label="Mic" ok={service?.components.audio_in} />
            <HealthTag label="Speaker" ok={service?.components.audio_out} />
            <HealthTag label="STT" ok={service?.models_loaded.stt} />
            <HealthTag label="TTS" ok={service?.models_loaded.tts} />
            <HealthTag label="Agent" ok={service?.agent_reachable} />
            <HealthTag label="Adapter" ok={adapterUp} />
          </div>
          {(turnMetrics.stt || turnMetrics.agent || turnMetrics.tts) && (
            <div className="grid grid-cols-3 gap-3">
              {(['stt', 'agent', 'tts'] as const).map((key) => {
                const p50 = turnMetrics[key]?.p50;
                return (
                  <Readout
                    key={key}
                    label={`${key} p50`}
                    value={formatLatency(p50)}
                    unit={p50 === undefined ? undefined : p50 >= 1 ? 's' : 'ms'}
                  />
                );
              })}
            </div>
          )}
        </Panel.Body>
      </Panel>

      <Panel>
        <Panel.Header title="Mic activity" />
        <Panel.Body>
          {micActivity.length === 0 ? (
            <p className="text-xs text-ink-tertiary">
              Nothing yet — VAD segments, ignored utterances and TTS events show up here.
            </p>
          ) : (
            <ul className="flex max-h-40 flex-col-reverse gap-1 overflow-y-auto pr-1">
              {micActivity.map((item) => (
                <li key={item.id} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 tabular-nums text-ink-tertiary">{formatTime(item.ts)}</span>
                  <span className="text-ink-secondary">{item.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel.Body>
      </Panel>
    </div>
  );
});
