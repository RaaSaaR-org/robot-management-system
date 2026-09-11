/**
 * @file DropdownMenu.tsx
 * @description DropdownMenu (a trigger + a menu of actions) and RowActions (the
 *              kebab "More actions" menu on every list row and detail header).
 *              role="menu"/"menuitem", arrow keys, Home/End, Esc and click
 *              outside close, portalled to <body> and positioned from the
 *              trigger so tables and panels never clip it.
 * @feature shared
 */

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { EllipsisVertical } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button, type ButtonSize } from './Button';

// ============================================================================
// TYPES
// ============================================================================

export interface DropdownMenuItem {
  label: ReactNode;
  /** lucide icon (sized for you) */
  icon?: ReactNode;
  onSelect: () => void;
  /** `danger` for destructive verbs (Delete goes last, after a separator) */
  tone?: 'danger' | 'default';
  disabled?: boolean;
  /** Draw a separator above this item */
  separatorBefore?: boolean;
  /** Stable key when labels are not strings */
  key?: string;
}

export type RowActionItem = DropdownMenuItem;

type TriggerProps = {
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  'aria-haspopup'?: 'menu';
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
};

export interface DropdownMenuProps {
  /** The element that opens the menu — usually a Button */
  trigger: ReactElement;
  items: DropdownMenuItem[];
  /** Align the menu's start or end edge with the trigger (default end) */
  align?: 'start' | 'end';
  /** Accessible name of the menu */
  label?: string;
  /** Extra classes for the menu panel */
  className?: string;
}

// ============================================================================
// DROPDOWN MENU
// ============================================================================

const GAP = 4;
const EDGE = 8;

/**
 * @example
 * ```tsx
 * <DropdownMenu
 *   trigger={<Button variant="secondary" rightIcon={<ChevronDown className="w-4 h-4" />}>Export</Button>}
 *   items={[
 *     { label: 'CSV', icon: <FileText />, onSelect: exportCsv },
 *     { label: 'LeRobot dataset', icon: <Package />, onSelect: exportLeRobot },
 *   ]}
 * />
 * ```
 */
export function DropdownMenu({ trigger, items, align = 'end', label, className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const triggerEl = () => (anchorRef.current?.firstElementChild as HTMLElement | null) ?? null;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (refocus) triggerEl()?.focus();
  }, []);

  const itemEls = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);

  const position = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = a.bottom + GAP;
    if (top + m.height > vh - EDGE && a.top - m.height - GAP > EDGE) top = a.top - m.height - GAP;
    let left = align === 'end' ? a.right - m.width : a.left;
    left = Math.min(Math.max(EDGE, left), vw - m.width - EDGE);
    setPos({ top, left });
  }, [align]);

  // Position once the menu has rendered (hidden)…
  const focusedRef = useRef(false);
  useLayoutEffect(() => {
    if (!open) {
      focusedRef.current = false;
      return;
    }
    position();
  }, [open, position]);

  // …then focus the first item. Not in the same pass: the menu is still
  // visibility:hidden until the position commits, and browsers refuse to focus
  // a hidden element — focus silently stayed on the trigger.
  useLayoutEffect(() => {
    if (!open || !pos || focusedRef.current) return;
    focusedRef.current = true;
    itemEls()[0]?.focus({ preventScroll: true });
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, close, position]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const els = itemEls();
    const index = els.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => els[(i + els.length) % els.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index <= 0 ? els.length - 1 : index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(els.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        event.preventDefault();
        close(true);
        break;
      default:
        break;
    }
  };

  const select = (item: DropdownMenuItem) => {
    if (item.disabled) return;
    // Refocus the trigger first so a dialog opened by onSelect returns focus there.
    close(true);
    item.onSelect();
  };

  const triggerProps = trigger.props as TriggerProps;
  const clonedTrigger = cloneElement(trigger as ReactElement<TriggerProps>, {
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      triggerProps.onClick?.(event);
      if (event.defaultPrevented) return;
      if (open) close(false);
      else setOpen(true);
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      triggerProps.onKeyDown?.(event);
      if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setOpen(true);
      } else if (open && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    },
  });

  return (
    <span ref={anchorRef} className="inline-flex">
      {clonedTrigger}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            aria-orientation="vertical"
            onKeyDown={onMenuKeyDown}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
            className={cn(
              'fixed z-[60] min-w-[11rem] max-w-[18rem] rounded-control border border-line-strong bg-raised p-1',
              'shadow-[0_12px_32px_rgba(0,0,0,0.4)]',
              className,
            )}
          >
            {items.map((item, index) => (
              <div key={item.key ?? (typeof item.label === 'string' ? item.label : index)} role="none">
                {item.separatorBefore && index > 0 && <div role="separator" className="-mx-1 my-1 h-px bg-line-subtle" />}
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={item.disabled}
                  onClick={() => select(item)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] outline-none',
                    'transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50',
                    '[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
                    item.tone === 'danger'
                      ? 'text-signal-stopped hover:bg-signal-stopped/10 focus:bg-signal-stopped/10'
                      : 'text-ink-secondary hover:bg-ink-primary/[0.06] hover:text-ink-primary focus:bg-ink-primary/[0.06] focus:text-ink-primary',
                  )}
                >
                  {item.icon && (
                    <span aria-hidden="true" className="inline-flex">
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}

// ============================================================================
// ROW ACTIONS
// ============================================================================

export interface RowActionsProps {
  items: RowActionItem[];
  /** Accessible name of the kebab button and menu (default "More actions") */
  label?: string;
  align?: 'start' | 'end';
  size?: ButtonSize;
  className?: string;
}

/**
 * The kebab menu: Edit, other verbs, then a separator and Delete (danger) last.
 * Clicks inside never reach a clickable row underneath.
 *
 * @example
 * ```tsx
 * <RowActions
 *   label={`Actions for ${route.name}`}
 *   items={[
 *     { label: 'Edit', icon: <Pencil />, onSelect: () => openEdit(route) },
 *     { label: 'Duplicate', icon: <Copy />, onSelect: () => duplicate(route) },
 *     { label: 'Delete', icon: <Trash2 />, tone: 'danger', separatorBefore: true, onSelect: () => askDelete(route) },
 *   ]}
 * />
 * ```
 */
export function RowActions({ items, label = 'More actions', align = 'end', size = 'sm', className }: RowActionsProps) {
  return (
    <span
      className={cn('inline-flex', className)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
    >
      <DropdownMenu
        align={align}
        label={label}
        items={items}
        trigger={
          <Button variant="ghost" size={size} iconOnly aria-label={label}>
            <EllipsisVertical className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        }
      />
    </span>
  );
}
