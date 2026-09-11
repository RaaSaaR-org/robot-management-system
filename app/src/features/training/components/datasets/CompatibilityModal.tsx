/**
 * @file CompatibilityModal.tsx
 * @description Pick up to eight ready datasets, see whether they train together, and hand the mixture to the wizard
 * @feature training
 */

import { useEffect, useState } from 'react';
import { Button, Checkbox, Modal } from '@/shared/components/ui';
import { DatasetCompatibilityPanel } from '../DatasetCompatibilityPanel';
import type { CompatibilityReport, Dataset } from '../../types';

/** What POST /api/datasets/compatibility accepts in one request. */
export const MAX_MIXTURE_MEMBERS = 8;

export interface CompatibilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Ready datasets to pick from. */
  datasets: Dataset[];
  /** Pre-selected ids when the modal opens. */
  initialIds?: string[];
  /** Continue with the checked ids into the training wizard. */
  onContinue: (ids: string[]) => void;
}

export function CompatibilityModal({ isOpen, onClose, datasets, initialIds, onContinue }: CompatibilityModalProps) {
  const [ids, setIds] = useState<string[]>([]);
  const [step, setStep] = useState<'pick' | 'report'>('pick');
  const [report, setReport] = useState<CompatibilityReport | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setIds(initialIds ?? []);
    setStep('pick');
    setReport(null);
  }, [isOpen, initialIds]);

  const toggle = (id: string) =>
    setIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_MIXTURE_MEMBERS
          ? prev
          : [...prev, id],
    );

  const full = ids.length >= MAX_MIXTURE_MEMBERS;

  const footer =
    step === 'pick' ? (
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={ids.length < 2} onClick={() => setStep('report')}>Check {ids.length || ''} datasets</Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={() => setStep('pick')}>Back</Button>
        <Button
          disabled={!report || report.verdict === 'incompatible'}
          onClick={() => onContinue(ids)}
        >
          Continue to training
        </Button>
      </>
    );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size={step === 'report' ? 'xl' : 'md'}
      title={step === 'pick' ? 'Check compatibility' : 'Can these be trained together?'}
      description={
        step === 'pick'
          ? `Pick two to ${MAX_MIXTURE_MEMBERS} ready datasets to compare their robot, action space and cameras.`
          : undefined
      }
      footer={footer}
    >
      {step === 'pick' ? (
        <div className="flex flex-col gap-3" data-testid="mixture-picker">
          <p className="text-[13px] text-ink-tertiary" data-testid="mixture-count">
            {ids.length} selected
            {ids.length === 1 && ' — pick another to compare them'}
            {full && ` — ${MAX_MIXTURE_MEMBERS} is the most one comparison takes`}
          </p>
          {datasets.length === 0 ? (
            <p className="text-sm text-ink-secondary">No dataset is ready yet.</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {datasets.map((d) => (
                <li key={d.id} className="rounded-control px-2 py-1.5 hover:bg-ink-primary/[0.035]">
                  <Checkbox
                    label={d.name}
                    description={`${d.demonstrationCount} episodes · ${d.fps} fps`}
                    checked={ids.includes(d.id)}
                    disabled={!ids.includes(d.id) && full}
                    onChange={() => toggle(d.id)}
                    aria-label={`Select ${d.name} for a training mixture`}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <DatasetCompatibilityPanel datasetIds={ids} onReport={setReport} />
      )}
    </Modal>
  );
}
