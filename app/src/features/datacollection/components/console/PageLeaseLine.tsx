/**
 * @file PageLeaseLine.tsx
 * @description The control the session page holds, shown in a Set up step
 *              (TASK-427): one line that says so and a Release button. The
 *              server never takes a held lease away, so this is how the
 *              assistant gives it back by hand; the page also gives it back on
 *              its own once arm control is on and the robot balances.
 *              TASK-437: `PageLeaseLostLine` says when that control ended on
 *              its own (the robot expired it, the socket closed), since a VR
 *              session shows no control bar that would.
 * @feature datacollection
 */

import { Hand, TriangleAlert } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';

export interface PageLeaseLineProps {
  /** What the line says ("You have control of G1 EDU."). */
  text: string;
  onRelease: () => void;
  /** Release is the step's one lit action (steps 4 and 5, while the operator waits for it). */
  lit?: boolean;
  className?: string;
}

export function PageLeaseLine({ text, onRelease, lit = false, className }: PageLeaseLineProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)} data-testid="setup-lease-held">
      <span className="inline-flex min-w-0 items-start gap-2 text-[13px] leading-[1.45] text-ink-secondary">
        <Hand className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-measured" strokeWidth={1.75} aria-hidden />
        {text}
      </span>
      <Button size={lit ? 'md' : 'sm'} variant={lit ? 'primary' : 'ghost'} onClick={onRelease} data-testid="setup-lease-release">
        Release control
      </Button>
    </div>
  );
}

export interface PageLeaseLostLineProps {
  /** The lease hook's notice ("Your control lease expired on the robot."). */
  message: string;
  className?: string;
}

/** The page's control ended without anyone releasing it (TASK-437). Amber: attention, not a fault. */
export function PageLeaseLostLine({ message, className }: PageLeaseLostLineProps) {
  return (
    <p className={cn('m-0 inline-flex min-w-0 items-start gap-2 text-[13px] leading-[1.45] text-ink-secondary', className)} role="status" data-testid="setup-lease-lost">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-unknown" strokeWidth={1.75} aria-hidden />
      <span>{message} Take control again to go on.</span>
    </p>
  );
}
