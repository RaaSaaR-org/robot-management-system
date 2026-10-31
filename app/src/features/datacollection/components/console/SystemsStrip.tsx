/**
 * @file SystemsStrip.tsx
 * @description The Record console's systems strip (TASK-428), under the live
 *              view: the Set up checklist folded into cells, built from the
 *              same `setupSteps.ts` model, so a step and its cell never
 *              disagree. VR sessions show Robot side, Control, Arm control,
 *              Mode, Headset, Arms and Hands; others Robot side, Control and
 *              Input. Each cell is a button with its label, a dot and a short
 *              value; amber when it needs attention, red when it failed. A
 *              click opens a popover above the strip with that step's body —
 *              the same controls as in Set up — so every function stays one
 *              click away and no control repeats on screen. Every body stays
 *              mounted (hidden) like Testing tools, so the page's lease bar and
 *              Quest controls keep their ids and state while closed. Seven columns from
 *              1440 px, 4 + 3 below; below 640 px one summary row ("All 7
 *              systems ok", or the worst cell) that expands the grid.
 *              TASK-442: a session with a camera list adds a Cameras cell —
 *              four in one row, or eight as 4 + 4, one row from 1440 px.
 * @feature datacollection
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { SystemsCell, SystemsCellId, SystemsCellStatus } from '../../utils/setupSteps';

/** A cell as the strip draws it: the model's cell, plus what the page adds to its value. */
export interface StripCell extends SystemsCell {
  /** A test id on the value (`control-lease-holder`, `operator-why`). */
  valueTestId?: string;
  /** Data attributes on the value (the why line's severity and code). */
  valueData?: Record<string, string>;
  /** The full value, when the cell truncates it. */
  title?: string;
}

export interface SystemsStripProps {
  cells: StripCell[];
  /** The popover body for a cell: the same controls as its Set up step. */
  renderBody: (cell: StripCell) => ReactNode;
  /** The open cell, when the page controls it (the dock's blocker opens the cell that fixes it). */
  openId?: SystemsCellId | null;
  onOpenChange?: (id: SystemsCellId | null) => void;
  className?: string;
}

const DOT: Record<SystemsCellStatus, string> = {
  ok: 'bg-signal-measured',
  warn: 'bg-signal-unknown',
  fail: 'bg-signal-stopped',
  idle: 'border-[1.5px] border-ink-muted bg-transparent',
};

const CELL_TONE: Record<SystemsCellStatus, string> = {
  ok: '',
  warn: 'bg-signal-unknown/[0.07] text-signal-unknown',
  fail: 'bg-signal-stopped/[0.08] text-signal-stopped',
  idle: '',
};

const RANK: Record<SystemsCellStatus, number> = { fail: 3, warn: 2, idle: 1, ok: 0 };

/** The worst cell, for the phone's summary row; null when every cell is ok. */
export function worstCell(cells: SystemsCell[]): SystemsCell | null {
  let worst: SystemsCell | null = null;
  for (const c of cells) {
    if (c.status === 'ok') continue;
    if (!worst || RANK[c.status] > RANK[worst.status]) worst = c;
  }
  return worst;
}

function Dot({ status, className }: { status: SystemsCellStatus; className?: string }) {
  return <i aria-hidden className={cn('inline-block h-[7px] w-[7px] flex-none rounded-full', DOT[status], className)} />;
}

export function SystemsStrip({ cells, renderBody, openId: openProp, onOpenChange, className }: SystemsStripProps) {
  const [openOwn, setOpenOwn] = useState<SystemsCellId | null>(null);
  const openId = openProp !== undefined ? openProp : openOwn;
  const setOpenId = useCallback((id: SystemsCellId | null) => {
    setOpenOwn(id);
    onOpenChange?.(id);
  }, [onOpenChange]);
  const [expanded, setExpanded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<SystemsCellId, HTMLButtonElement>());
  const [left, setLeft] = useState(0);
  const open = cells.find((c) => c.id === openId) ?? null;

  const close = useCallback((refocus: boolean) => {
    const id = openId;
    setOpenId(null);
    if (refocus && id) cellRefs.current.get(id)?.focus();
  }, [openId, setOpenId]);

  // Above the strip, aligned to the cell and kept inside the strip's width.
  const position = useCallback(() => {
    const wrap = wrapRef.current;
    const pop = popRef.current;
    const cell = openId ? cellRefs.current.get(openId) : null;
    if (!wrap || !pop || !cell) return;
    const w = wrap.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const next = Math.round(Math.min(Math.max(0, c.left - w.left), Math.max(0, w.width - pop.offsetWidth)));
    setLeft((prev) => (prev === next ? prev : next));
  }, [openId]);

  useLayoutEffect(() => {
    if (openId) position();
  }, [openId, position]);

  useEffect(() => {
    if (!openId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || popRef.current?.contains(target)) return;
      // The cell toggles itself; a dialog opened from inside (a confirm) is not "outside".
      if (target.closest?.('[data-systems-cell], [role="dialog"], [role="alertdialog"]')) return;
      close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="alertdialog"]')) close(true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', position);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', position);
    };
  }, [openId, close, position]);

  // A cell that disappears (a session type changes) closes its popover.
  useEffect(() => {
    if (openId && !open) setOpenId(null);
  }, [openId, open, setOpenId]);

  const worst = worstCell(cells);
  // 3 or 4 cells: one row. 7: 4 + 3, 8: 4 + 4, either one row from 1440 px.
  const many = cells.length > 4;
  const seven = cells.length <= 7;
  const wide = seven ? 7 : 8;

  return (
    <div ref={wrapRef} className={cn('relative flex-none', className)} data-testid="session-systems" aria-label="Robot systems" role="group">
      {/* Phone: one summary row that expands the grid. */}
      <button
        type="button"
        className={cn(
          'hidden w-full items-center gap-2.5 border-t border-line-subtle px-3.5 py-[11px] text-left text-[13px] max-sm:flex',
          worst?.status === 'fail' ? 'text-signal-stopped' : worst?.status === 'warn' ? 'text-signal-unknown' : 'text-ink-secondary',
        )}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        data-testid="systems-summary"
      >
        <span className="flex gap-1" aria-hidden>
          {cells.map((c) => <Dot key={c.id} status={c.status} />)}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {worst ? `${worst.label}: ${worst.value}` : `All ${cells.length} systems ok`}
        </span>
        <ChevronDown className={cn('h-4 w-4 flex-none transition-transform duration-150', expanded && 'rotate-180')} strokeWidth={1.75} aria-hidden />
      </button>

      <div
        className={cn(
          'grid overflow-hidden rounded-b-panel border-t border-line-subtle',
          many ? cn('grid-cols-4', seven ? 'min-[1440px]:grid-cols-7' : 'min-[1440px]:grid-cols-8') : cells.length === 4 ? 'grid-cols-4' : 'grid-cols-3',
          'max-sm:grid-cols-2',
          !expanded && 'max-sm:hidden',
        )}
      >
        {cells.map((cell, i) => {
          const isOpen = cell.id === openId;
          // Hairlines: a left border except at a row start, a top border on later rows.
          const rowStart4 = i % 4 === 0;
          const rowStartWide = i % wide === 0;
          return (
            <button
              key={cell.id}
              ref={(el) => {
                if (el) cellRefs.current.set(cell.id, el);
                else cellRefs.current.delete(cell.id);
              }}
              type="button"
              data-systems-cell
              data-testid={`systems-cell-${cell.id}`}
              data-status={cell.status}
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : cell.id)}
              className={cn(
                'flex min-w-0 flex-col gap-0.5 px-3 pb-2.5 pt-[9px] text-left transition-colors duration-150 ease-[var(--ease-instrument)] hover:bg-raised/50',
                'border-line-subtle',
                many
                  ? cn(
                    !rowStart4 && 'max-[1439px]:border-l',
                    i >= 4 && 'max-[1439px]:border-t',
                    !rowStartWide && 'min-[1440px]:border-l',
                  )
                  : i > 0 && 'border-l',
                'max-sm:border-l-0 max-sm:border-t max-sm:[&:nth-child(even)]:border-l',
                CELL_TONE[cell.status],
                isOpen && 'bg-raised/70',
              )}
            >
              <span className="whitespace-nowrap text-[11.5px] text-ink-tertiary">{cell.label}</span>
              <span className="flex min-w-0 items-center gap-[7px] text-[13px] font-medium" title={cell.title ?? cell.value}>
                <Dot status={cell.status} />
                <span className="min-w-0 truncate" data-testid={cell.valueTestId} {...(cell.valueData ?? {})}>
                  {cell.value}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* One popover; every cell's body stays mounted (like Testing tools), only the open one shows. */}
      <div
        ref={popRef}
        role="dialog"
        aria-modal="false"
        aria-label={open?.label ?? 'Robot systems'}
        data-testid="systems-popover"
        data-cell={open?.id}
        hidden={!open}
        // Closed, it is not a dialog: the page's hotkeys check for open dialogs.
        aria-hidden={!open || undefined}
        inert={!open}
        style={{ left }}
        className="absolute bottom-full z-30 mb-2 flex max-h-[min(62vh,520px)] w-[420px] max-w-full flex-col overflow-hidden rounded-control border border-line bg-raised shadow-[var(--shadow-raised)]"
      >
        {open && (
          <div className="flex flex-none items-center gap-2 px-3.5 pb-1 pt-2.5">
            <h3 className="m-0 min-w-0 flex-1 truncate font-display text-[15px] font-semibold leading-snug [font-variation-settings:'wdth'_106]">
              {open.label}
              <span className={cn('ml-2 font-sans text-[13px] font-medium', open.status === 'fail' ? 'text-signal-stopped' : open.status === 'warn' ? 'text-signal-unknown' : 'text-ink-secondary')}>
                {open.value}
              </span>
            </h3>
            <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={() => close(true)}>
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        )}
        <div className="min-h-0 overflow-y-auto px-3.5 pb-3.5 pt-1 text-[13px]">
          {cells.map((cell) => (
            <div key={cell.id} hidden={cell.id !== openId} data-testid={`systems-popover-${cell.id}`} className="flex flex-col gap-3">
              {renderBody(cell)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
