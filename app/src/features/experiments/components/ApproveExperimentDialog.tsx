/**
 * @file ApproveExperimentDialog.tsx
 * @description The human gate (TASK-242): before anything trains, spell out
 *   the spend and what every arm changes against the baseline.
 * @feature experiments
 */

import { useState } from 'react';
import { Button, KeyValueList, Modal } from '@/shared/components/ui';
import type { Experiment } from '../types/experiment.types';
import { armVaries } from '../utils/experiments';

export interface ApproveExperimentDialogProps {
  experiment: Experiment | null;
  onClose: () => void;
  onApprove: () => Promise<unknown>;
  onReject: () => Promise<unknown>;
}

export function ApproveExperimentDialog({ experiment, onClose, onApprove, onReject }: ApproveExperimentDialogProps) {
  const [busy, setBusy] = useState(false);
  if (!experiment) return null;
  const { budget, evaluation, arms } = experiment;
  const gpuHours = arms.length * budget.gpuHoursPerArm;
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Approve "${experiment.title}"?`}
      description={`Proposed by ${experiment.displayName} (${experiment.actorType}). Approving starts ${arms.length} training runs.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={run(onReject)} disabled={busy}>
            Reject
          </Button>
          <Button onClick={run(onApprove)} disabled={busy} data-testid="approve-experiment">
            Approve and train
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="approve-dialog">
        <p className="text-sm text-ink-primary">{experiment.hypothesis}</p>
        <KeyValueList
          items={[
            { label: 'Arms', value: `${arms.length} (budget ${budget.maxArms})` },
            { label: 'GPU hours', value: `${gpuHours} of ${budget.maxGpuHours} (${budget.gpuHoursPerArm} per arm)` },
            { label: 'Model', value: `${experiment.baseModel} · ${experiment.fineTuneMethod}` },
            { label: 'Evaluation', value: `${evaluation.rolloutCount} sim rollouts in ${evaluation.environment}` },
          ]}
        />
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-ink-primary">What each arm changes</div>
          <ul className="flex flex-col gap-1 text-[13px]">
            {arms.map((arm) => (
              <li key={arm.id} className="flex flex-wrap gap-x-2" data-testid="arm-diff">
                <span className="font-medium text-ink-primary">{arm.name}</span>
                <span className="text-ink-secondary">{armVaries(arm)}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] text-ink-tertiary">
          Approval freezes every dataset view the arms cite and is written to the compliance log with this budget.
        </p>
      </div>
    </Modal>
  );
}
