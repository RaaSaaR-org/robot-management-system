/**
 * @file JobMixture.tsx
 * @description The datasets a training run trains on, with each member's weight and share
 * @feature training
 */

import type { TrainingJobDatasetMember } from '../../types';

export interface JobMixtureProps {
  members: TrainingJobDatasetMember[];
}

/** A mixture's weights are the difference between "both datasets" and "mostly one of them". */
export function JobMixture({ members }: JobMixtureProps) {
  if (members.length === 0) return null;
  const total = members.reduce((sum, m) => sum + (m.weight || 0), 0);

  return (
    <div data-testid="job-mixture" className="text-sm">
      <div className="text-xs text-ink-tertiary">
        {members.length > 1 ? `Mixture · ${members.length} datasets` : 'Dataset'}
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {members.map((member) => (
          <li key={member.datasetId} className="flex items-baseline justify-between gap-2">
            <span className="truncate text-ink-primary">{member.name}</span>
            {members.length > 1 && (
              <span className="shrink-0 text-xs text-ink-secondary">
                weight {member.weight}
                {total > 0 && ` · ${Math.round((member.weight / total) * 100)}%`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
