/**
 * @file TestingTools.tsx
 * @description The session page's "Testing tools" popover (TASK-426): every
 *              developer tool behind one button in the command bar's left
 *              group — Simulate VR input, the desktop VR window, Keyboard
 *              fallback, Joint states and "Show the headset view here". It is
 *              non-modal, anchored to the button and aligned to its end, so it
 *              opens leftward under the left group, away from the E-STOP.
 *              It stays MOUNTED and only toggles `hidden`: the VRSessionPanel
 *              inside owns the VR modal, the simulated input and the goodbye,
 *              and must never unmount because the popover closed. Escape and
 *              an outside click close it, and focus returns to the button.
 *              While open it is a dialog, so the page's single-key hotkeys
 *              (Space, E, N, Backspace) pause; Escape twice still stops.
 *              On a phone the E-STOP is a fixed bottom dock: the popover ends
 *              at least 17 px above it (the dock's dead band) and the dock is
 *              stacked above it, so the popover never covers the E-STOP.
 * @feature datacollection
 */

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

/** Gap between the bar and the popover. */
const OFFSET = 8;

/** On a phone, the popover's bottom stays this far above the E-STOP dock (its dead band). */
const DOCK_CLEARANCE = 17;

/** Never shorter than this, even on a very short screen (the dock is stacked above it anyway). */
const MIN_HEIGHT = 120;

/**
 * Whether the popover is open. A row's in-place content (the keyboard
 * fallback with its global key listener, the joint grid, the Quest card's
 * polling) renders only while it is: closing the tools must not leave a
 * hidden keyboard console driving joints. The rows themselves — and the
 * VRSessionPanel with its modal — stay mounted.
 */
const ToolsOpenContext = createContext(true);

/** Marks the elements that toggle the popover, so a click on them is not an "outside" click. */
export const TOOLS_ANCHOR_ATTR = 'data-tools-anchor';

export interface TestingToolsProps {
  open: boolean;
  /** Close it; `refocus` returns focus to the anchor (Escape, or an outside click that left focus inside). */
  onClose: (refocus: boolean) => void;
  /** The element whose end edge the popover aligns to: the bar's toggle, or the ⋯ button on a phone. */
  anchor: HTMLElement | null;
  /** The E-STOP zone. When it is the fixed phone dock, the popover stops above it. */
  dock?: HTMLElement | null;
  children: ReactNode;
  className?: string;
}

export function TestingTools({ open, onClose, anchor, dock = null, children, className }: TestingToolsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight?: number } | null>(null);

  // Positioned against the offset parent (the bar's sticky shim), so it moves
  // with the bar when the page scrolls.
  const position = useCallback(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent || !anchor) return;
    const p = parent.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const width = el.offsetWidth;
    const left = Math.min(Math.max(0, a.right - p.left - width), Math.max(0, p.width - width));
    // 8 px under the anchor — in a 60 px bar that is 5 px above its bottom
    // edge, as in the mockup — and no higher in a taller (tight) bar, whose
    // centred ⋯ sits further up.
    const top = Math.max(a.bottom - p.top + OFFSET, parent.offsetHeight - 5);
    let maxHeight: number | undefined;
    if (dock && getComputedStyle(dock).position === 'fixed') {
      maxHeight = Math.max(MIN_HEIGHT, Math.floor(dock.getBoundingClientRect().top - DOCK_CLEARANCE - (p.top + top)));
    }
    setPos((prev) =>
      prev && prev.top === top && prev.left === left && prev.maxHeight === maxHeight ? prev : { top, left, maxHeight },
    );
  }, [anchor, dock]);

  useLayoutEffect(() => {
    if (open) position();
  }, [open, position]);

  // A row that opens in place (the keyboard fallback, the joint states) widens
  // the popover; it stays aligned to the button's end, so it grows leftward.
  useEffect(() => {
    const el = ref.current;
    if (!open || !el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => position());
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || ref.current?.contains(target) || target.closest?.(`[${TOOLS_ANCHOR_ATTR}]`)) return;
      // A dialog opened from inside (the VR window, a confirm) is not "outside".
      if (target.closest?.('[role="dialog"], [role="alertdialog"]')) return;
      const focusInside = !!ref.current?.contains(document.activeElement);
      onClose(focusInside);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose(true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', position);
    // Until the bar sticks, scrolling moves the popover toward (or away from) the phone dock.
    window.addEventListener('scroll', position, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position);
    };
  }, [open, onClose, position]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Testing tools"
      aria-modal="false"
      data-testid="session-tools"
      hidden={!open}
      // Closed, it is not a dialog: the page's hotkeys check for open dialogs.
      aria-hidden={!open || undefined}
      inert={!open}
      style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : undefined}
      className={cn(
        'absolute z-40 w-[360px] max-w-[calc(100vw-32px)] has-[[data-tools-expanded]]:w-[560px] overflow-y-auto rounded-control border border-line bg-raised p-1.5 shadow-[var(--shadow-raised)]',
        'max-h-[calc(100dvh-220px)]',
        className,
      )}
    >
      <h3 className="px-3 pb-0.5 pt-2.5 font-display text-[15px] font-semibold leading-snug [font-variation-settings:'wdth'_106]">
        Testing tools
      </h3>
      <p className="px-3 pb-2 text-[12.5px] text-ink-tertiary">For testing without a headset. A real session needs none of this.</p>
      <ToolsOpenContext.Provider value={open}>{children}</ToolsOpenContext.Provider>
    </div>
  );
}

export interface TestingToolsRowProps {
  title: ReactNode;
  /** One line of help under the title. */
  help?: ReactNode;
  /** The row's control (a Switch or a small button), on the right. */
  control?: ReactNode;
  /** What the row opens in place (the keyboard fallback, the joint states). */
  children?: ReactNode;
  /** The content needs room: the popover widens to 560 px while it shows. */
  wide?: boolean;
  'data-testid'?: string;
}

/** One tool: a 1 px top border, a title, one line of help, and its control. */
export function TestingToolsRow({ title, help, control, children, wide = false, 'data-testid': testId }: TestingToolsRowProps) {
  const open = useContext(ToolsOpenContext);
  return (
    <section className="border-t border-line" data-testid={testId}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-ink-primary">{title}</div>
          {help && <div className="text-xs leading-[1.45] text-ink-tertiary">{help}</div>}
        </div>
        {control}
      </div>
      {children && open && (
        <div className="px-3 pb-3" data-tools-expanded={wide ? '' : undefined}>
          {children}
        </div>
      )}
    </section>
  );
}
