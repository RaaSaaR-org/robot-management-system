/**
 * @file ArmTable.tsx
 * @description Every arm of an experiment: what it varies, its status, its
 *   result with the count behind it, and its delta against the baseline
 *   (TASK-242). Doubles as the table view of the comparison chart.
 * @feature experiments
 */

import { Link } from 'react-router-dom';
import { StatusTag } from '@/shared/components/ui';
import type { ExperimentArm, ExperimentVerdict } from '../types/experiment.types';
import { armVaries, deltaPts, rateWithCount } from '../utils/experiments';

const DIRECTION_LABEL = {
  better: 'better',
  worse: 'worse',
  within_noise: 'within noise',
  too_few_episodes: 'too few rollouts',
} as const;

export interface ArmTableProps {
  arms: ExperimentArm[];
  verdict: ExperimentVerdict | null;
}

export function ArmTable({ arms, verdict }: ArmTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]" data-testid="arm-table">
        <thead className="text-ink-tertiary">
          <tr>
            <th className="py-2 pr-3 font-medium">Arm</th>
            <th className="py-2 pr-3 font-medium">Varies</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Success</th>
            <th className="py-2 pr-3 font-medium">vs baseline</th>
          </tr>
        </thead>
        <tbody>
          {arms.map((arm) => {
            const cmp = verdict?.deltas.find((d) => d.armId === arm.id);
            return (
              <tr key={arm.id} className="border-t border-border-subtle align-top">
                <td className="py-2 pr-3 text-ink-primary">
                  {arm.modelVersionId ? <Link to={`/models?model=${encodeURIComponent(arm.modelVersionId)}`}>{arm.name}</Link> : arm.name}
                </td>
                <td className="py-2 pr-3 text-ink-secondary">{armVaries(arm)}</td>
                <td className="py-2 pr-3">
                  <StatusTag status={arm.status} />
                  {arm.failureReason && <div className="mt-1 text-[12px] text-ink-tertiary">{arm.failureReason}</div>}
                </td>
                <td className="py-2 pr-3 font-mono text-ink-primary">{arm.result ? rateWithCount(arm.result) : '—'}</td>
                <td className="py-2 pr-3 text-ink-secondary">
                  {cmp ? `${deltaPts(cmp.delta)} · ${DIRECTION_LABEL[cmp.direction]}` : arm.isBaseline ? 'baseline' : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
