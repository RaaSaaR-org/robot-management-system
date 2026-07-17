/**
 * @file TwinLifecycleStepper.tsx
 * @description Horizontal Scan → Build → Zones → Export progress indicator for a
 *   digital twin, derived from its status + zone count. Guides first-time users
 *   through the lifecycle and lets them jump between the Scan/Zones tabs.
 * @feature digitaltwin
 */

import { memo } from 'react';
import type { TwinStatus } from '../types/twin.types';

type StepState = 'done' | 'active' | 'todo';

export interface TwinLifecycleStepperProps {
  status: TwinStatus;
  zoneCount: number;
  hasOccupancy: boolean;
  /** Jump to a tab when a step is clicked. */
  onNavigate?: (tab: 'scan' | 'zones') => void;
}

interface Step {
  key: string;
  label: string;
  state: StepState;
  tab?: 'scan' | 'zones';
}

function deriveSteps(status: TwinStatus, zoneCount: number, hasOccupancy: boolean): Step[] {
  const built = status === 'ready';
  const scan: StepState =
    status === 'recording' ? 'active' : status === 'processing' || built ? 'done' : 'active';
  const build: StepState = built ? 'done' : status === 'processing' ? 'active' : 'todo';
  const zones: StepState = built ? (zoneCount > 0 ? 'done' : 'active') : 'todo';
  const exportState: StepState = built && hasOccupancy ? 'active' : 'todo';
  return [
    { key: 'scan', label: 'Scan', state: scan, tab: 'scan' },
    { key: 'build', label: 'Build', state: build },
    { key: 'zones', label: 'Zones', state: zones, tab: 'zones' },
    { key: 'export', label: 'Export', state: exportState, tab: 'zones' },
  ];
}

const DOT: Record<StepState, string> = {
  done: 'bg-cobalt text-white border-cobalt',
  active: 'bg-transparent text-cobalt border-cobalt',
  todo: 'bg-transparent text-theme-tertiary border-surface-600',
};

const LABEL: Record<StepState, string> = {
  done: 'text-theme-secondary',
  active: 'text-cobalt font-medium',
  todo: 'text-theme-tertiary',
};

export const TwinLifecycleStepper = memo(function TwinLifecycleStepper({
  status, zoneCount, hasOccupancy, onNavigate,
}: TwinLifecycleStepperProps) {
  const steps = deriveSteps(status, zoneCount, hasOccupancy);

  return (
    <ol className="flex items-center gap-1 rounded-lg border border-theme bg-theme-surface px-3 py-2">
      {steps.map((step, i) => {
        const clickable = !!step.tab && !!onNavigate;
        return (
          <li key={step.key} className="flex items-center gap-1">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => step.tab && onNavigate?.(step.tab)}
              className={`flex items-center gap-2 rounded px-1.5 py-0.5 ${clickable ? 'cursor-pointer hover:bg-theme-secondary/15' : 'cursor-default'}`}
            >
              <span className={`flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold ${DOT[step.state]}`}>
                {step.state === 'done' ? '✓' : i + 1}
              </span>
              <span className={`text-xs ${LABEL[step.state]}`}>{step.label}</span>
            </button>
            {i < steps.length - 1 && (
              <span className={`w-6 h-px ${step.state === 'done' ? 'bg-cobalt/60' : 'bg-surface-600'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
});
