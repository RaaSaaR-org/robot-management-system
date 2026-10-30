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
 * @feature datacollection
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

/** The popover's width; it shrinks to the viewport (less a 16 px gutter each side) on a phone. */
const WIDTH = 360;
/** Gap between the bar and the popover. */
const OFFSET = 8;

/** Marks the elements that toggle the popover, so a click on them is not an "outside" click. */
export const TOOLS_ANCHOR_ATTR = 'data-tools-anchor';

export interface TestingToolsProps {
  open: boolean;
  /** Close it; `refocus` returns focus to the anchor (Escape, or an outside click that left focus inside). */
  onClose: (refocus: boolean) => void;
  /** The element whose end edge the popover aligns to: the bar's toggle, or the ⋯ button on a phone. */
  anchor: HTMLElement | null;
  children: ReactNode;
  className?: string;
}

export function TestingTools({ open, onClose, anchor, children, className }: TestingToolsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Positioned against the offset parent (the bar's sticky shim), so it moves
  // with the bar when the page scrolls.
  const position = useCallback(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent || !anchor) return;
    const p = parent.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 32);
    const left = Math.min(Math.max(0, a.right - p.left - width), Math.max(0, p.width - width));
    setPos({ top: a.bottom - p.top + OFFSET, left });
  }, [anchor]);

  useLayoutEffect(() => {
    if (open) position();
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
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', position);
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
      style={pos ? { top: pos.top, left: pos.left } : undefined}
      className={cn(
        'absolute z-40 w-[360px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-control border border-line bg-raised p-1.5 shadow-[var(--shadow-raised)]',
        'max-h-[calc(100dvh-180px)]',
        className,
      )}
    >
      <h3 className="px-3 pb-0.5 pt-2.5 font-display text-[15px] font-semibold leading-snug [font-variation-settings:'wdth'_106]">
        Testing tools
      </h3>
      <p className="px-3 pb-2 text-[12.5px] text-ink-tertiary">For testing without a headset. A real session needs none of this.</p>
      {children}
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
  'data-testid'?: string;
}

/** One tool: a 1 px top border, a title, one line of help, and its control. */
export function TestingToolsRow({ title, help, control, children, 'data-testid': testId }: TestingToolsRowProps) {
  return (
    <section className="border-t border-line" data-testid={testId}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-ink-primary">{title}</div>
          {help && <div className="text-xs leading-[1.45] text-ink-tertiary">{help}</div>}
        </div>
        {control}
      </div>
      {children && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}
