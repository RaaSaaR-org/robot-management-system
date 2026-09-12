/**
 * @file FactList.tsx
 * @description The editable fact list, shared by the site card and every stop
 *              of a tour: the ONLY ground the robot may answer from. Adding is
 *              blocked at `max` rather than truncated later, so the author sees
 *              which fact did not fit.
 * @feature tour
 */

import { memo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';

export interface FactListProps {
  /** Accessible prefix for every row ("Stop 2 fact"). */
  label: string;
  facts: string[];
  max: number;
  maxLength: number;
  placeholder?: string;
  invalid?: boolean;
  onChange: (facts: string[]) => void;
  testId: string;
}

export const FactList = memo(function FactList({ label, facts, max, maxLength, placeholder, invalid, onChange, testId }: FactListProps) {
  const full = facts.length >= max;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      {facts.map((fact, i) => (
        <div key={i} className="flex min-w-0 items-start gap-2">
          <Input
            aria-label={`${label} ${i + 1}`}
            data-testid={`${testId}-input`}
            maxLength={maxLength}
            value={fact}
            placeholder={placeholder}
            invalid={invalid && fact.length > maxLength}
            onChange={(e) => onChange(facts.map((f, j) => (j === i ? e.target.value : f)))}
          />
          <Button variant="ghost" iconOnly aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(facts.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
          data-testid={`${testId}-add`}
          disabled={full}
          onClick={() => onChange([...facts, ''])}
        >
          Add fact
        </Button>
        <span className={cn('text-xs tabular-nums', full ? 'text-signal-unknown' : 'text-ink-tertiary')}>
          {facts.length} of {max}
        </span>
      </div>
    </div>
  );
});
