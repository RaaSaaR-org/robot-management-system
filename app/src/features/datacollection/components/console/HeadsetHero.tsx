/**
 * @file HeadsetHero.tsx
 * @description The headset's lead on the session page (TASK-426): on a Quest
 *              (or under the dev `?xremu` emulator) every live phase starts
 *              with "This is the headset" and Launch VR as its one primary,
 *              instead of Launch VR sitting ~2400 px down the page. The
 *              desktop's blocks follow behind one "Robot setup" disclosure,
 *              kept MOUNTED while closed: the readiness panel in there keeps
 *              the store fresh that the headset's robot panel reads.
 * @feature datacollection
 */

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Glasses } from 'lucide-react';
import { Button, Panel } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';

export interface HeadsetHeroProps {
  /** The VRSessionPanel in its `hero` variant: Launch VR and the VR modal. */
  launcher: ReactNode;
  /** Set when Testing tools forced the headset view on a desktop: offers the way back. */
  onShowDesktopView?: () => void;
  className?: string;
}

export function HeadsetHero({ launcher, onShowDesktopView, className }: HeadsetHeroProps) {
  return (
    <Panel className={cn('flex flex-col gap-4 border-primary/25', className)} data-testid="headset-hero">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-primary bg-primary/10 text-primary"
        >
          <Glasses className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[22px] font-semibold leading-tight [font-variation-settings:'wdth'_108]">
            This is the headset
          </h2>
          <p className="mt-1 max-w-[62ch] text-sm text-ink-secondary">
            Press Launch VR, then Take control and Enter VR. The robot side is set up from the desktop.
          </p>
        </div>
        {onShowDesktopView && (
          <Button variant="ghost" size="sm" onClick={onShowDesktopView} data-testid="headset-hero-desktop">
            Show the desktop view
          </Button>
        )}
      </div>
      {launcher}
    </Panel>
  );
}

export interface RobotSetupDisclosureProps {
  children: ReactNode;
}

/**
 * The desktop's blocks on the headset: one disclosure, closed by default. The
 * content stays mounted (hidden), unlike the kit's Disclosure, so nothing in
 * it stops polling while it is closed.
 */
export function RobotSetupDisclosure({ children }: RobotSetupDisclosureProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div className="flex flex-col gap-6" data-testid="robot-setup">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 self-start rounded-control px-1 py-1 text-sm font-medium text-ink-secondary hover:text-ink-primary"
      >
        <ChevronDown
          aria-hidden
          strokeWidth={1.75}
          className={cn('h-4 w-4 transition-transform duration-150 ease-[var(--ease-instrument)]', !open && '-rotate-90')}
        />
        Robot setup
      </button>
      <div id={contentId} hidden={!open} className="flex flex-col gap-6">
        {children}
      </div>
    </div>
  );
}
