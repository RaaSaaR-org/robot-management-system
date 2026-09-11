/**
 * @file useTopBarMenu.ts
 * @description Shared behaviour and look of the top bar's own menus (user
 *              menu, organization switcher), which carry a header block the
 *              kit's DropdownMenu has no slot for: open/close, click outside,
 *              Esc with focus back on the trigger, arrow keys between items.
 * @feature layout
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/** Menu panel: raised ground, strong border, the one raised shadow. */
export const topBarMenuPanel =
  'absolute right-0 top-full z-50 mt-2 overflow-hidden rounded-control border border-line-strong bg-raised shadow-[var(--shadow-raised)]';

/** One menu row, same look as the kit's DropdownMenu items. */
export const topBarMenuItem =
  'flex w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] text-ink-secondary outline-none ' +
  'transition-colors duration-100 hover:bg-ink-primary/[0.06] hover:text-ink-primary ' +
  'focus:bg-ink-primary/[0.06] focus:text-ink-primary [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0';

export function useTopBarMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Opening moves focus to the first item, like every menu.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const list = items();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
    else if (event.key === 'Tab') setOpen(false);
  };

  return {
    open,
    toggle: () => setOpen((v) => !v),
    close,
    rootRef,
    triggerRef,
    menuRef,
    onMenuKeyDown,
  };
}
