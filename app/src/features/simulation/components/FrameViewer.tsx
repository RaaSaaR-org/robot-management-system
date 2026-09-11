/**
 * @file FrameViewer.tsx
 * @description Episode replay of a sim run: the frames the VLA server received, per episode and step
 * @feature simulation
 */

import { useEffect, useMemo, useState } from 'react';
import { InfoIcon, Panel, SegmentedControl } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { simulationApi } from '../api/simulationApi';
import type { SimJob } from '../types';
import { GLOSSARY } from './simFormat';

export function FrameViewer({ job }: { job: SimJob }) {
  const frames = useMemo(() => job.frames ?? [], [job.frames]);
  const episodes = useMemo(() => [...new Set(frames.map((f) => f.episode))].sort((a, b) => a - b), [frames]);
  const [episode, setEpisode] = useState(episodes[0] ?? 1);
  const [index, setIndex] = useState(0);
  const episodeFrames = useMemo(() => frames.filter((f) => f.episode === episode), [frames, episode]);

  useEffect(() => setIndex(0), [episode]);

  if (frames.length === 0) return null;
  const current = episodeFrames[index];

  return (
    <Panel>
      <Panel.Header
        title={
          <span className="inline-flex items-center gap-1.5">
            Episode replay <InfoIcon content={GLOSSARY.frames} />
          </span>
        }
        description="Pick a step to see what the policy saw."
        actions={
          episodes.length > 1 ? (
            <SegmentedControl
              label="Episode"
              size="sm"
              options={episodes.map((e) => ({ value: String(e), label: `Ep ${e}` }))}
              value={String(episode)}
              onChange={(v) => setEpisode(Number(v))}
            />
          ) : undefined
        }
      />
      <Panel.Body className="flex flex-col gap-4">
        {current && (
          <figure className="flex flex-col items-center gap-2">
            <img
              src={simulationApi.getFrameUrl(job.jobId, current.file)}
              alt={`Episode ${current.episode}, step ${current.step}`}
              className="w-full max-w-2xl rounded-control border border-line"
              loading="lazy"
            />
            <figcaption className="text-xs text-ink-tertiary">Step {current.step}</figcaption>
          </figure>
        )}
        {episodeFrames.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {episodeFrames.map((frame, i) => (
              <button
                key={frame.file}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Step ${frame.step}`}
                aria-pressed={i === index}
                className={cn(
                  'shrink-0 overflow-hidden rounded-control border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  i === index ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100'
                )}
              >
                <img src={simulationApi.getFrameUrl(job.jobId, frame.file)} alt="" className="h-16 w-24 object-cover" loading="lazy" />
                <div className="bg-inset py-0.5 text-center text-xs text-ink-tertiary">{frame.step}</div>
              </button>
            ))}
          </div>
        )}
      </Panel.Body>
    </Panel>
  );
}
