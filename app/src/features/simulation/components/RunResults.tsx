/**
 * @file RunResults.tsx
 * @description Results of one sim run in a large modal (opened via ?run=): success, metrics, replay
 * @feature simulation
 */

import { Button, KeyValueList, LinkButton, Modal, ProgressBar, StatRow, StatTile, StatusTag } from '@/shared/components/ui';
import type { SimJob, SimScene } from '../types';
import { FrameViewer } from './FrameViewer';
import {
  backendLabel,
  backendModeTag,
  formatPct,
  formatSeconds,
  runName,
  successInterpretation,
  successTone,
} from './simFormat';

export interface RunResultsProps {
  job: SimJob | null;
  scenes: SimScene[];
  onClose: () => void;
}

export function RunResults({ job, scenes, onClose }: RunResultsProps) {
  if (!job) return null;
  const mode = backendModeTag(job);
  const m = job.metrics;
  const extended = m as (typeof m & { totalEpisodes?: number; successfulEpisodes?: number }) | undefined;

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="xl"
      title={runName(job, scenes)}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusTag status={job.status} dot pulse={job.status === 'running'} />
          {mode && <StatusTag tone={mode.tone}>{mode.label}</StatusTag>}
        </span>
      }
      footer={
        <>
          {m && m.successRate >= 0.5 && (
            <LinkButton to="/deployments" variant="secondary">Deploy the model</LinkButton>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {job.status === 'failed' && (
          <div role="alert" className="rounded-control border border-signal-stopped/30 bg-signal-stopped/10 px-4 py-3 text-sm text-ink-primary">
            The run failed{job.failureReason ? `: ${job.failureReason}` : '.'}
          </div>
        )}

        {!m && job.status !== 'failed' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-secondary">Results appear here when the run finishes.</p>
            <ProgressBar value={job.progress} />
          </div>
        )}

        {m && (
          <>
            <StatRow columns={4}>
              <StatTile
                label="Success rate"
                value={(m.successRate * 100).toFixed(1)}
                unit="%"
                tone={successTone(m.successRate)}
                hint={extended?.successfulEpisodes !== undefined ? `${extended.successfulEpisodes} of ${extended.totalEpisodes ?? job.rolloutCount} episodes` : `${job.rolloutCount} rollouts`}
              />
              <StatTile label="Avg steps" value={m.avgStepsToCompletion.toFixed(0)} unit="/ 200" />
              <StatTile label="Collisions" value={m.collisionCount} tone={m.collisionCount > 3 ? 'warning' : undefined} />
              <StatTile label="Avg duration" value={formatSeconds(m.avgEpisodeDuration)} />
            </StatRow>
            <div className="flex items-start gap-3 rounded-control bg-inset px-4 py-3">
              <StatusTag tone={successTone(m.successRate)}>{successInterpretation(m.successRate).label}</StatusTag>
              <p className="text-sm text-ink-secondary">
                {successInterpretation(m.successRate).detail}
                {m.avgStepsToCompletion >= 200 && m.successRate < 1 && ' Average steps sit at the 200-step cap: most episodes timed out.'}
              </p>
            </div>
          </>
        )}

        {(job.frames?.length ?? 0) > 0 && <FrameViewer job={job} />}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink-primary">Details</h3>
          <KeyValueList
            columns={3}
            items={[
              { label: 'Model label', value: job.modelId },
              { label: 'Environment', value: job.environment },
              { label: 'Backend', value: backendLabel(job.backend) },
              { label: 'Rollouts', value: job.rolloutCount },
              { label: 'Success rate', value: m ? formatPct(m.successRate, 1) : undefined },
              { label: 'Robot', value: job.embodiment },
              { label: 'Started', value: new Date(job.createdAt).toLocaleString() },
              { label: 'Run ID', value: job.jobId, mono: true },
            ]}
          />
        </div>
      </div>
    </Modal>
  );
}
