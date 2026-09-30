/**
 * @file ModelExperimentsLink.tsx
 * @description On a model's detail view: the experiments that produced or
 *   started from this model (TASK-242). Renders nothing when there are none.
 * @feature experiments
 */

import { Link } from 'react-router-dom';
import { useExperiments } from '../hooks/useExperiments';

export function ModelExperimentsLink({ modelVersionId }: { modelVersionId: string }) {
  const { experiments } = useExperiments({ modelVersionId });
  if (experiments.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="model-experiments">
      <div className="text-sm font-semibold text-ink-primary">Experiments</div>
      <ul className="flex flex-col gap-1 text-[13px]">
        {experiments.map((e) => {
          const arm = e.arms.find((a) => a.modelVersionId === modelVersionId);
          return (
            <li key={e.id}>
              <Link to={`/experiments/${encodeURIComponent(e.id)}`} className="text-ink-primary underline-offset-2 hover:underline">
                {e.title}
              </Link>
              <span className="text-ink-tertiary"> · {arm ? `produced by arm "${arm.name}"` : 'started from this model'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
