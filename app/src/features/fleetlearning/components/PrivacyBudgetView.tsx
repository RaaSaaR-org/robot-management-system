/**
 * @file PrivacyBudgetView.tsx
 * @description Table of each robot's differential-privacy budget (ε) spend
 * @feature fleetlearning
 */

import { Shield } from 'lucide-react';
import { DataTable, EmptyState, Panel, ProgressBar, StatusTag, type DataTableColumn } from '@/shared/components/ui';
import type { RobotPrivacyBudget } from '../types/fleetlearning.types';

export interface PrivacyBudgetViewProps {
  budgets: RobotPrivacyBudget[];
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Remaining ε below this reads as low. */
  warningThreshold?: number;
  /** Maps a robot id to its name. */
  robotName?: (robotId: string) => string;
  className?: string;
}

type BudgetState = 'exhausted' | 'low' | 'healthy';

function budgetState(b: RobotPrivacyBudget, threshold: number): BudgetState {
  if (b.remainingEpsilon <= 0) return 'exhausted';
  if (b.remainingEpsilon < threshold) return 'low';
  return 'healthy';
}

const STATE_TAG: Record<BudgetState, { tone: 'danger' | 'warning' | 'success'; label: string }> = {
  exhausted: { tone: 'danger', label: 'Exhausted' },
  low: { tone: 'warning', label: 'Low' },
  healthy: { tone: 'success', label: 'Healthy' },
};

export function PrivacyBudgetView({
  budgets, isLoading = false, error, onRetry, warningThreshold = 1.0, robotName, className,
}: PrivacyBudgetViewProps) {
  const columns: DataTableColumn<RobotPrivacyBudget>[] = [
    {
      key: 'robotId', header: 'Robot', sortable: true,
      cell: (b) => <span className="font-medium text-ink-primary">{robotName?.(b.robotId) ?? b.robotId}</span>,
    },
    {
      key: 'used', header: 'Spent ε', hideBelow: 'sm', width: '32%',
      cell: (b) => {
        const pct = b.totalEpsilon > 0 ? (b.usedEpsilon / b.totalEpsilon) * 100 : 0;
        const state = budgetState(b, warningThreshold);
        return (
          <ProgressBar value={Math.min(pct, 100)} size="sm" showValue={false}
            variant={state === 'exhausted' ? 'error' : state === 'low' ? 'warning' : 'default'}
            label={`${b.usedEpsilon.toFixed(2)} of ${b.totalEpsilon.toFixed(1)} ε spent`} />
        );
      },
    },
    {
      key: 'remainingEpsilon', header: 'Remaining', align: 'right', sortable: true,
      cell: (b) => `${b.remainingEpsilon.toFixed(2)} / ${b.totalEpsilon.toFixed(1)} ε`,
    },
    { key: 'roundsParticipated', header: 'Rounds', align: 'right', sortable: true, hideBelow: 'md' },
    {
      key: 'state', header: 'Status', sortValue: (b) => b.remainingEpsilon,
      cell: (b) => {
        const tag = STATE_TAG[budgetState(b, warningThreshold)];
        return <StatusTag tone={tag.tone} dot>{tag.label}</StatusTag>;
      },
    },
  ];

  return (
    <Panel padding="none" className={className}>
      <Panel.Header title="Privacy budgets" description="Each robot's ε limits how much its data can shape the model." />
      <DataTable
        caption="Privacy budgets"
        columns={columns}
        rows={budgets}
        getRowId={(b) => b.robotId}
        defaultSort={{ key: 'remainingEpsilon', direction: 'asc' }}
        isLoading={isLoading}
        error={error}
        errorTitle="Couldn't load privacy budgets"
        onRetry={onRetry}
        empty={<EmptyState icon={<Shield />} title="No privacy budgets yet"
          description="A robot gets a budget the first time it joins a round with differential privacy." />}
      />
    </Panel>
  );
}
