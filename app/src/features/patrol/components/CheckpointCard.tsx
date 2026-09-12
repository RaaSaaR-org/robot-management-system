/**
 * @file CheckpointCard.tsx
 * @description One checkpoint in the route editor's stepper: number, name and
 *              place id, then (unfolded) heading, actions, dwell and the
 *              expectations the robot checks. Reorder and remove with icon
 *              buttons; no confirm, because the draft is not saved yet.
 * @feature patrol
 */

import { memo } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Trash2 } from 'lucide-react';
import { Button, FormField, Input, Panel, Textarea, ToggleChip } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { PatrolCheckpoint, PatrolCheckpointAction } from '../types/patrol.types';
import { PatrolCheckpointActions } from '../types/patrol.types';

const ACTION_LABEL: Record<PatrolCheckpointAction, string> = { capture: 'Capture photo', dwell: 'Dwell', scan: 'Scan' };

export interface CheckpointCardProps {
  checkpoint: PatrolCheckpoint;
  index: number;
  count: number;
  open: boolean;
  placeError?: string;
  /** id of the datalist with the robot's places, when it has any. */
  placesListId?: string;
  onToggle: () => void;
  onChange: (patch: Partial<PatrolCheckpoint>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

export const CheckpointCard = memo(function CheckpointCard({
  checkpoint: cp,
  index,
  count,
  open: openProp,
  placeError,
  placesListId,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: CheckpointCardProps) {
  const n = index + 1;
  const open = openProp || Boolean(placeError);
  const detailsId = `patrol-checkpoint-details-${cp.id}`;
  const summary = [
    cp.actions.map((a) => ACTION_LABEL[a]).join(', ') || 'No actions',
    typeof cp.headingDeg === 'number' && Number.isFinite(cp.headingDeg) ? `facing ${cp.headingDeg}°` : null,
    (cp.expectations ?? []).filter((e) => e.trim()).length ? `${(cp.expectations ?? []).filter((e) => e.trim()).length} expectations` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="flex min-w-0 items-start gap-3" data-testid="patrol-checkpoint" data-index={index}>
      <span
        className={cn(
          'relative z-10 mt-3 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
          placeError ? 'border-signal-stopped text-signal-stopped bg-panel' : 'border-primary/30 bg-primary/10 text-primary',
        )}
        aria-hidden="true"
      >
        {n}
      </span>
      <Panel variant="inset" padding="sm" className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 flex-col items-start rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={`Checkpoint ${n} details`}
            onClick={onToggle}
          >
            <span className="flex max-w-full items-center gap-2">
              <span className="truncate text-sm font-medium text-ink-primary">{cp.name || cp.placeId || 'Unnamed checkpoint'}</span>
              <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-tertiary transition-transform', open && 'rotate-180')} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="text-xs text-ink-tertiary">{summary}</span>
          </button>
          <div className="flex shrink-0 gap-0.5">
            <Button variant="ghost" size="sm" iconOnly aria-label={`Move checkpoint ${n} up`} data-testid="patrol-checkpoint-up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <Button variant="ghost" size="sm" iconOnly aria-label={`Move checkpoint ${n} down`} data-testid="patrol-checkpoint-down" disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <Button variant="ghost" size="sm" iconOnly aria-label={`Remove checkpoint ${n}`} data-testid="patrol-checkpoint-remove" onClick={onRemove}>
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </div>

        {/* Folded with `hidden`, never unmounted: typed values survive a fold. */}
        <div id={detailsId} className={cn('flex min-w-0 flex-col gap-4', !open && 'hidden')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Name">
              <Input value={cp.name} aria-label={`Checkpoint ${n} name`} onChange={(e) => onChange({ name: e.target.value })} />
            </FormField>
            <FormField label="Place id" required error={placeError}>
              <Input
                className="font-mono"
                value={cp.placeId}
                aria-label={`Checkpoint ${n} place id`}
                list={placesListId}
                onChange={(e) => onChange({ placeId: e.target.value })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-[8rem_minmax(0,1fr)_8rem]">
            <FormField label="Heading" hint="Degrees; empty keeps it">
              <Input
                type="number"
                aria-label={`Checkpoint ${n} heading`}
                value={cp.headingDeg ?? ''}
                onChange={(e) => onChange({ headingDeg: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </FormField>
            <div className="order-last col-span-2 flex min-w-0 flex-col gap-1.5 sm:order-none sm:col-span-1">
              <span className="text-[13px] font-medium text-ink-secondary">Actions</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Checkpoint ${n} actions`}>
                {PatrolCheckpointActions.map((action) => {
                  const on = cp.actions.includes(action);
                  return (
                    <ToggleChip
                      key={action}
                      active={on}
                      onClick={() => onChange({ actions: on ? cp.actions.filter((a) => a !== action) : [...cp.actions, action] })}
                    >
                      {ACTION_LABEL[action]}
                    </ToggleChip>
                  );
                })}
              </div>
            </div>
            <FormField label="Dwell" hint="Seconds">
              <Input
                type="number"
                min={0}
                step={0.5}
                aria-label={`Checkpoint ${n} dwell`}
                disabled={!cp.actions.includes('dwell')}
                value={(cp.dwellMs ?? 0) / 1000}
                onChange={(e) => onChange({ dwellMs: Math.round(Number(e.target.value) * 1000) })}
              />
            </FormField>
          </div>
          <FormField label="Expectations" hint="One per line — what the robot should find here.">
            <Textarea
              rows={2}
              aria-label={`Checkpoint ${n} expectations`}
              placeholder="Fire extinguisher on the wall left of the door"
              value={(cp.expectations ?? []).join('\n')}
              onChange={(e) => onChange({ expectations: e.target.value.split('\n') })}
            />
          </FormField>
        </div>
      </Panel>
    </li>
  );
});
