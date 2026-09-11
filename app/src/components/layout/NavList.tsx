/**
 * @file NavList.tsx
 * @description Renders the navigation groups for the sidebar (expanded or as a
 *              64px icon rail) and the mobile drawer. Static eyebrow labels,
 *              no accordions; in the rail the eyebrows become hairlines and
 *              every entry carries a tooltip.
 * @feature layout
 */

import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Tooltip } from '@/shared/components/ui/Tooltip';
import { focusRing } from '@/shared/components/ui/styles';
import { isNavItemActive, type NavGroup, type NavItem } from './navigation';

// ============================================================================
// TYPES
// ============================================================================

export type NavListVariant = 'expanded' | 'rail' | 'drawer';

/**
 * The app focus ring for the brand Logo's link, applied from a wrapper: Logo
 * is shared with the landing page, whose own rendering must not change.
 */
export const logoFocusRing =
  '[&_a]:block [&_a]:rounded-tag [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-primary';

export interface NavListProps {
  groups: NavGroup[];
  variant: NavListVariant;
  /** Called after an entry is clicked (the drawer closes itself with it) */
  onNavigate?: () => void;
}

// ============================================================================
// ITEM
// ============================================================================

interface NavEntryProps {
  item: NavItem;
  active: boolean;
  variant: NavListVariant;
  onNavigate?: () => void;
}

function NavEntry({ item, active, variant, onNavigate }: NavEntryProps) {
  const Icon = item.icon;
  const rail = variant === 'rail';

  const link = (
    <Link
      to={item.path}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center rounded-control text-sm font-medium',
        'transition-colors duration-150 ease-[var(--ease-instrument)]',
        focusRing,
        rail ? 'h-9 w-10 justify-center' : 'h-8 gap-3 px-3',
        variant === 'drawer' && 'h-11',
        active
          ? [
              'bg-primary/10 text-primary',
              // The 2px bar sits on the straight part of the left edge.
              "before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-0.5 before:rounded-r-full before:bg-primary before:content-['']",
            ]
          : 'text-ink-secondary hover:bg-raised hover:text-ink-primary',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className={cn('truncate', rail && 'sr-only')}>{item.label}</span>
    </Link>
  );

  if (!rail) return link;

  return (
    <Tooltip content={item.label} side="right" className="flex">
      {link}
    </Tooltip>
  );
}

// ============================================================================
// LIST
// ============================================================================

/**
 * @example
 * ```tsx
 * <NavList groups={useVisibleNavGroups()} variant={collapsed ? 'rail' : 'expanded'} />
 * ```
 */
export function NavList({ groups, variant, onNavigate }: NavListProps) {
  const { pathname } = useLocation();
  const rail = variant === 'rail';

  return (
    <div className={cn('flex flex-col', rail ? 'items-center gap-1' : 'gap-5')}>
      {groups.map((group, index) => {
        const headingId = `nav-group-${variant}-${group.id}`;
        return (
          <section
            key={group.id}
            aria-labelledby={rail ? undefined : headingId}
            aria-label={rail ? group.label : undefined}
            className={cn('flex flex-col', rail ? 'items-center gap-1' : 'gap-0.5')}
          >
            {rail ? (
              index > 0 && <div role="separator" className="my-2 h-px w-8 bg-line" />
            ) : (
              <h2
                id={headingId}
                className="mb-1 px-3 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted"
              >
                {group.label}
              </h2>
            )}
            <ul className={cn('flex flex-col', rail ? 'items-center gap-1' : 'gap-0.5')}>
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavEntry
                    item={item}
                    variant={variant}
                    active={isNavItemActive(item, pathname)}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
