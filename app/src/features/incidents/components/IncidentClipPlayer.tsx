/**
 * @file IncidentClipPlayer.tsx
 * @description Animated frame player for incident rollout clips (highlight
 * strategy, TASK-179) — cycles base64 JPEG frames on an <img> at the clip's
 * fps with play/pause and a frame scrubber. No external libs.
 * @feature incidents
 */

import { useState, useEffect, useCallback } from 'react';
import { Spinner } from '@/shared/components/ui/Spinner';
import { incidentsApi } from '../api/incidentsApi';
import type { IncidentClip } from '../types/incidents.types';

export interface IncidentClipPlayerProps {
  incidentId: string;
}

export function IncidentClipPlayer({ incidentId }: IncidentClipPlayerProps) {
  const [clip, setClip] = useState<IncidentClip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  // Fetch the clip once
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setClip(null);
    setFrameIndex(0);
    incidentsApi
      .getIncidentClip(incidentId)
      .then((c) => {
        if (cancelled) return;
        if (c.format !== 'jpeg-frames' || !Array.isArray(c.frames) || c.frames.length === 0) {
          setError('Clip is empty or in an unsupported format.');
        } else {
          setClip(c);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load rollout clip.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  // Advance frames while playing
  useEffect(() => {
    if (!clip || !playing) return;
    const fps = clip.fps > 0 ? clip.fps : 10;
    const interval = setInterval(() => {
      setFrameIndex((i) => (i + 1) % clip.frames.length);
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [clip, playing]);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPlaying(false);
    setFrameIndex(parseInt(e.target.value, 10) || 0);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  if (error || !clip) {
    return <p className="text-sm text-theme-tertiary">{error ?? 'No clip available.'}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg overflow-hidden bg-black">
        <img
          src={`data:image/jpeg;base64,${clip.frames[frameIndex]}`}
          alt={`Rollout clip frame ${frameIndex + 1} of ${clip.frames.length}`}
          className="w-full max-h-80 object-contain"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="px-3 py-1 rounded text-xs font-medium bg-theme-base hover:bg-theme-base/70 text-theme-primary transition-colors"
        >
          {playing ? 'Pause' : 'Play'}
        </button>

        <input
          type="range"
          min={0}
          max={clip.frames.length - 1}
          step={1}
          value={frameIndex}
          onChange={handleScrub}
          className="flex-1 h-1 rounded-full appearance-none cursor-pointer bg-theme-base accent-primary-500"
          aria-label="Frame scrubber"
        />

        <span className="text-xs font-mono tabular-nums text-theme-tertiary w-[72px] text-right">
          {frameIndex + 1} / {clip.frames.length}
        </span>
      </div>

      <p className="text-xs text-theme-tertiary">
        {clip.fps} fps · captured {new Date(clip.capturedAt).toLocaleString()}
      </p>
    </div>
  );
}
