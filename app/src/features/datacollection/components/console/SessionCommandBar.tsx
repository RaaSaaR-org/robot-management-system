/**
 * @file SessionCommandBar.tsx
 * @description The session page's one sticky command bar (TASK-426), its
 *              `<header>` in every phase. Left: back, the identity (task as
 *              the h1, status tag, robot link dot, robot, input, fps), then
 *              every normal action packed right after it — presence, mute
 *              (Record), Testing tools (Set up, Record), End session (Record).
 *              Right: the E-STOP alone in its own zone, behind a flexible
 *              clear gap that never drops below 24 px, so no other control is
 *              closer than 12 + 24 + 12 + 1 + 16 = 65 px to it; the title
 *              truncates first. A 2 px tally on the top edge tells the room the
 *              state. Below 640 px the E-STOP zone itself (same element, same
 *              button) becomes a fixed bottom dock that holds nothing else, and
 *              the normal actions move into a ⋯ menu.
 *
 *              The bar sticks 28 px under the TopBar (top 84 px): a canvas
 *              band above it covers content scrolling under, and the TopBar's
 *              account menu stays ~50 px from the E-STOP.
 * @feature datacollection
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Ellipsis, FlaskConical, Square, Volume2, VolumeX } from 'lucide-react';
import { Button, DropdownMenu, StatusTag, buttonClasses, type DropdownMenuItem } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { SessionStatusBadge } from '../SessionStatusBadge';
import { PresenceBar } from '../PresenceBar';
import { TestingTools } from './TestingTools';
import type { PresenceViewer, TeleoperationStatus } from '../../types/datacollection.types';
import type { CommandBarTally, SessionPhase } from '../../utils/sessionPhase';

/** Where the bar's top edge sits once it is stuck: the 56 px TopBar plus 28 px. */
export const COMMAND_BAR_STUCK_TOP = 84;

/** The robot link, as the dot before the robot's name. */
export type RobotLink = 'live' | 'stale' | 'offline';

export interface SessionCommandBarProps {
  phase: SessionPhase;
  tally: CommandBarTally;
  /** Set up only: every step is done, so the amber tally turns mint. */
  ready?: boolean;
  /** The task text — the page's one h1. */
  title: string;
  status: TeleoperationStatus;
  robotName: string;
  isSim?: boolean;
  link: RobotLink;
  inputLabel: string;
  fps: number;
  viewers: readonly PresenceViewer[];
  /** The sound-cue mute (Record only). */
  muted?: boolean;
  onToggleMute?: () => void;
  /** Simulated VR input is on: a "Simulated input" tag beside Testing tools. */
  simulatedInput?: boolean;
  /** End session (Record only), still behind the page's confirm. */
  onEnd?: () => void;
  endPending?: boolean;
  /** The Testing tools rows. Kept mounted in a hidden popover; no popover without them. */
  tools?: ReactNode;
  /** The E-STOP — the zone's one and only control. */
  estop: ReactNode;
  backTo?: string;
}

const TALLY: Record<CommandBarTally, string> = {
  setup: 'before:bg-signal-unknown',
  rec: 'before:bg-signal-stopped before:animate-breathe',
  between: 'before:bg-line-strong',
  fault: 'before:bg-signal-stopped',
  done: 'before:bg-signal-measured',
  failed: 'before:bg-signal-stopped',
};

const LINK: Record<RobotLink, { title: string; className: string }> = {
  live: { title: 'Robot linked: telemetry live', className: 'bg-signal-measured' },
  stale: { title: 'Robot online, no robot state yet', className: 'bg-signal-unknown' },
  offline: { title: 'Robot offline', className: 'border-[1.5px] border-ink-muted bg-transparent' },
};

/** `<kbd>` inside a button: a key hint, hidden from the accessible name. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        'rounded-[5px] border border-line-strong px-[5px] py-[3px] font-sans text-[11px] font-medium leading-none tracking-[.02em] text-ink-tertiary',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

const Divider = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn('h-[11px] w-px shrink-0 bg-line-strong', className)} />
);

/** The bar's outer frame and its sticky shim: also the loading skeleton's. */
function useStuck() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const stuck = window.scrollY > 0 && el.getBoundingClientRect().top <= COMMAND_BAR_STUCK_TOP + 0.5;
      el.dataset.stuck = stuck ? 'true' : 'false';
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return ref;
}

// The shim: sticky 84 px down; its canvas band (before:) covers the gap above
// the bar — 24 px at rest (the shell's gap, empty anyway), the full 28 px up
// to the TopBar once stuck.
const SHIM =
  'sticky top-[84px] z-30 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-canvas data-[stuck=true]:before:h-7';

const BAR =
  'relative flex h-[60px] items-center gap-3 overflow-hidden rounded-panel border border-line-subtle bg-panel pl-2.5 ' +
  'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0.5 ' +
  'max-sm:h-auto max-sm:min-h-[60px] max-sm:py-2.5 max-sm:pr-2';

function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      aria-label="Back to Data collection"
      title="Data collection"
      className={buttonClasses({ variant: 'ghost', iconOnly: true, className: 'self-center' })}
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

const H1 =
  "min-w-0 truncate font-display text-[19px] font-semibold leading-tight tracking-[-0.01em] [word-spacing:.06em] [font-variation-settings:'wdth'_106] " +
  'max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:text-[16.5px]';

export function SessionCommandBar({
  phase, tally, ready = false, title, status, robotName, isSim = false, link, inputLabel, fps, viewers,
  muted = false, onToggleMute, simulatedInput = false, onEnd, endPending = false, tools, estop, backTo = '/data-collection',
}: SessionCommandBarProps) {
  const shimRef = useStuck();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const wrap = phase === 'wrap';
  const record = phase === 'record';
  const hasTools = !!tools && !wrap;

  const anchorRef = useRef<HTMLElement | null>(null);
  const openTools = (from: HTMLElement | null) => {
    anchorRef.current = from;
    setAnchor(from);
    setToolsOpen(true);
  };
  const closeTools = useCallback((refocus: boolean) => {
    setToolsOpen(false);
    if (!refocus) return;
    // Focus goes back to what opened it: the bar's button, or ⋯ on a phone.
    const opener = anchorRef.current;
    const button = opener instanceof HTMLButtonElement ? opener : opener?.querySelector('button');
    button?.focus();
  }, []);
  // Wrap-up has no Testing tools: a popover left open there would be orphaned.
  useEffect(() => {
    if (wrap) setToolsOpen(false);
  }, [wrap]);

  const moreItems: DropdownMenuItem[] = [];
  if (record && onEnd) {
    moreItems.push({ key: 'end', label: 'End session', icon: <Square />, onSelect: onEnd, testId: 'session-more-end' });
  }
  if (hasTools) {
    moreItems.push({ key: 'tools', label: 'Testing tools', icon: <FlaskConical />, onSelect: () => openTools(moreRef.current), testId: 'session-more-tools' });
  }
  if (record && onToggleMute) {
    moreItems.push({
      key: 'mute',
      label: muted ? 'Unmute sound cues' : 'Mute sound cues',
      icon: muted ? <VolumeX /> : <Volume2 />,
      onSelect: onToggleMute,
      testId: 'session-more-mute',
    });
  }

  const linkInfo = LINK[link];

  return (
    <div ref={shimRef} className={SHIM}>
      <header
        className={cn(BAR, ready && phase === 'setup' ? 'before:bg-signal-measured' : TALLY[tally])}
        data-testid="session-command-bar"
        data-tally={tally}
        data-phase={phase}
      >
        <BackLink to={backTo} />

        {/* Identity: shrinks (the h1 truncates) before the clear gap does. */}
        <div className="flex min-w-0 shrink flex-col gap-[3px] max-sm:flex-1">
          <div className="flex min-w-0 items-center gap-2.5 max-sm:flex-wrap max-sm:gap-y-1">
            <h1 className={H1} title={title}>{title}</h1>
            <SessionStatusBadge status={status} showPulse={status === 'recording'} />
          </div>
          <div className="flex min-w-0 items-center gap-2.5 whitespace-nowrap text-[12.5px] text-ink-tertiary">
            <span className="inline-flex min-w-0 items-center gap-[7px] text-ink-secondary">
              {!wrap && (
                <span
                  role="img"
                  aria-label={linkInfo.title}
                  title={linkInfo.title}
                  data-testid="robot-link"
                  data-link={link}
                  className={cn('inline-block h-[7px] w-[7px] shrink-0 rounded-full', linkInfo.className)}
                />
              )}
              <span className="truncate">{robotName}</span>
              {isSim && <StatusTag tone="sim" size="sm">Sim</StatusTag>}
            </span>
            <Divider className="max-sm:hidden" />
            <span className="max-sm:hidden">{inputLabel}</span>
            <Divider className="max-sm:hidden" />
            <span className="tabular-nums max-sm:hidden">{fps} fps</span>
          </div>
        </div>

        {/* Every normal action, packed right after the identity. Never next to the E-STOP. */}
        {!wrap && (
          <div
            role="group"
            aria-label="Session actions"
            data-testid="session-actions"
            className="flex h-[34px] flex-none items-center gap-2 border-l border-line-subtle pl-3 max-sm:hidden"
          >
            <PresenceBar viewers={viewers} />
            {record && onToggleMute && (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                onClick={onToggleMute}
                data-testid="hud-mute"
                aria-pressed={muted}
                aria-label={muted ? 'Unmute sound cues' : 'Mute sound cues'}
                title={muted ? 'Sound cues are off' : 'Sound cues are on'}
              >
                {muted ? <VolumeX className="h-4 w-4" strokeWidth={1.75} /> : <Volume2 className="h-4 w-4" strokeWidth={1.75} />}
              </Button>
            )}
            {hasTools && (
              <Button
                ref={toggleRef}
                variant="ghost"
                size="sm"
                data-testid="session-tools-toggle"
                aria-haspopup="dialog"
                aria-expanded={toolsOpen}
                aria-label="Testing tools"
                title="Testing tools"
                data-tools-anchor=""
                leftIcon={<FlaskConical className="h-4 w-4" strokeWidth={1.75} />}
                onClick={() => (toolsOpen ? closeTools(false) : openTools(toggleRef.current))}
              >
                <span className="max-[1439px]:hidden">Testing tools</span>
              </Button>
            )}
            {simulatedInput && <StatusTag tone="sim" data-testid="sim-input-tag">Simulated input</StatusTag>}
            {record && onEnd && (
              <Button
                variant="secondary"
                isLoading={endPending}
                leftIcon={<Square className="h-4 w-4" strokeWidth={1.75} />}
                onClick={onEnd}
                data-testid="session-end"
              >
                End session
                <Kbd className="max-[1599px]:hidden">E</Kbd>
              </Button>
            )}
          </div>
        )}

        {/* The clear gap: holds nothing, ever. */}
        <div aria-hidden className="min-w-6 flex-1 self-stretch max-sm:hidden" />

        {/* The E-STOP alone. Below 640 px this same zone is the fixed bottom dock. */}
        <div
          data-testid="estop-zone"
          aria-label="Emergency stop"
          role="group"
          className={cn(
            'flex flex-none items-center self-stretch border-l border-line bg-canvas/70 pl-4 pr-[7px]',
            'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:justify-end max-sm:border-l-0 max-sm:border-t',
            'max-sm:bg-inset max-sm:px-4 max-sm:pb-[calc(12px+env(safe-area-inset-bottom))] max-sm:pt-4',
          )}
        >
          {estop}
        </div>

        {/* Phones: the normal actions in a ⋯ menu, never in the dock. */}
        {!wrap && moreItems.length > 0 && (
          <div ref={moreRef} className="self-start sm:hidden">
            <DropdownMenu
              label="More session actions"
              items={moreItems}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label="More session actions"
                  data-testid="session-more"
                  data-tools-anchor=""
                >
                  <Ellipsis className="h-4 w-4" strokeWidth={1.75} />
                </Button>
              }
            />
          </div>
        )}
      </header>

      {tools && (
        <TestingTools open={toolsOpen && !wrap} onClose={closeTools} anchor={anchor}>
          {tools}
        </TestingTools>
      )}
    </div>
  );
}

/** The bar while the session loads or failed to load: back and a title, no actions. */
export function SessionCommandBarSkeleton({ title, backTo = '/data-collection' }: { title: string; backTo?: string }) {
  const shimRef = useStuck();
  return (
    <div ref={shimRef} className={SHIM}>
      <header className={cn(BAR, 'before:bg-line-strong')} data-testid="session-command-bar">
        <BackLink to={backTo} />
        <h1 className={H1}>{title}</h1>
      </header>
    </div>
  );
}
