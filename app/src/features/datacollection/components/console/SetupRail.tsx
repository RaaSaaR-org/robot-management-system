/**
 * @file SetupRail.tsx
 * @description The "Get ready" panel of a created session (TASK-427): the
 *              steps in bring-up order as an accordion track — exactly one body
 *              open, the current step by default, any step openable out of
 *              order — with "N of M done" and its segments on top, and the
 *              start bar at the foot. The open step that is not done holds the
 *              page's one primary; Start session takes it over once every step
 *              is done, and only an offline robot disables it, with the reason
 *              as visible text. Once everything is done the track folds to one
 *              line.
 * @feature datacollection
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Play } from 'lucide-react';
import { Button, Panel } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { Kbd } from './SessionCommandBar';
import { SetupStep, type SetupStepProps } from './SetupStep';
import type { SetupModel, SetupStep as SetupStepModel, SetupStepId } from '../../utils/setupSteps';

/** What a step's body holds, given whether it carries the page's primary. */
export type SetupStepContent = Pick<SetupStepProps, 'lead' | 'children' | 'actions' | 'note' | 'details'>;

export interface SetupRailProps {
  model: SetupModel;
  /** The body of one step; `lit` when it is the open step and not done. */
  renderStep: (step: SetupStepModel, lit: boolean) => SetupStepContent;
  onStart: () => void;
  starting: boolean;
  /** Start is blocked (robot offline): the reason, shown as text. */
  blockedReason: string | null;
  /** Each take stops on its own after this many seconds, when set. */
  autoStopS: number | null;
  className?: string;
}

export function SetupRail({ model, renderStep, onStart, starting, blockedReason, autoStopS, className }: SetupRailProps) {
  // null: follow the current step. 'none': the user closed it.
  const [pick, setPick] = useState<SetupStepId | 'none' | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  const { steps, current, doneCount, allDone } = model;

  // A new current step opens on its own.
  useEffect(() => { setPick(null); }, [current]);

  const expandedId = pick === 'none' ? null : pick ?? current;
  const toggle = (id: SetupStepId) => {
    if (id === expandedId) setPick(id === current ? 'none' : null);
    else setPick(id);
  };
  const open = steps.length - doneCount;
  const folded = allDone && !unfolded;

  let startText: ReactNode;
  if (blockedReason) startText = blockedReason;
  else if (allDone) startText = 'Everything is ready. Nothing records until a take starts.';
  else {
    startText = `${open} step${open === 1 ? '' : 's'} open. You can start anyway: nothing records until a take starts${
      autoStopS ? `, and each take stops on its own after ${autoStopS} s` : ''
    }.`;
  }

  return (
    <Panel as="section" padding="none" className={cn('flex flex-col', className)} data-testid="setup-rail" aria-labelledby="setup-rail-title">
      <div className="flex items-center gap-3 px-[22px] pb-2.5 pt-[18px]">
        <h2
          id="setup-rail-title"
          className="m-0 font-display text-[17px] font-semibold leading-tight [font-variation-settings:'wdth'_106] [word-spacing:.05em]"
        >
          Get ready
        </h2>
        <div className="ml-auto flex items-center gap-2.5 text-[12.5px] text-ink-tertiary" data-testid="setup-progress">
          <span className="tabular-nums">{doneCount} of {steps.length} done</span>
          <span className="flex gap-[3px]" aria-hidden>
            {steps.map((s) => (
              <i
                key={s.id}
                className={cn(
                  'block h-1 w-[18px] rounded-sm',
                  s.state === 'done' ? 'bg-signal-measured' : s.id === current ? 'bg-primary' : 'bg-line',
                )}
              />
            ))}
          </span>
        </div>
      </div>

      {folded ? (
        <button
          type="button"
          className="mx-3 mb-2 flex items-center gap-3.5 rounded-control px-3 py-2.5 text-left hover:bg-inset"
          onClick={() => setUnfolded(true)}
          aria-expanded={false}
          data-testid="setup-folded"
        >
          <span className="grid h-7 w-7 flex-none place-items-center rounded-full border border-signal-measured/45 bg-signal-measured/10 text-signal-measured">
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1 text-[14px] text-ink-primary">{model.foldedSummary}</span>
          <span className="flex items-center gap-1 text-[12.5px] text-ink-tertiary">
            Show steps
            <ChevronDown className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </span>
        </button>
      ) : null}

      <ol className={cn('relative m-0 flex-1 list-none px-3 pb-2 pt-1', folded && 'hidden')} aria-label="Setup steps">
        {steps.map((s, i) => {
          const expanded = s.id === expandedId;
          const lit = expanded && s.state !== 'done';
          return (
            <SetupStep
              key={s.id}
              step={s}
              expanded={expanded}
              onToggle={() => toggle(s.id)}
              last={i === steps.length - 1}
              {...renderStep(s, lit)}
            />
          );
        })}
      </ol>

      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line-subtle px-[22px] pb-[18px] pt-3.5 max-sm:flex-col max-sm:items-stretch"
        data-testid="setup-start"
        data-ready={allDone ? 'true' : 'false'}
      >
        <Button
          size="lg"
          variant={allDone && !blockedReason ? 'primary' : 'secondary'}
          isLoading={starting}
          disabled={blockedReason !== null}
          leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />}
          onClick={onStart}
          className="max-sm:w-full"
        >
          Start session
          <Kbd className={allDone && !blockedReason ? 'border-on-primary/30 text-on-primary/70' : undefined}>Space</Kbd>
        </Button>
        <p
          className={cn('m-0 min-w-0 text-[13px] leading-[1.45] sm:flex-1 sm:basis-[16rem]', blockedReason ? 'text-signal-stopped' : 'text-ink-tertiary')}
          data-testid="setup-start-text"
          role={blockedReason ? 'status' : undefined}
        >
          {startText}
        </p>
      </div>
    </Panel>
  );
}
