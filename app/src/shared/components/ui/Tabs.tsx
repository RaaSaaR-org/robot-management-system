/**
 * @file Tabs.tsx
 * @description Tabbed interface. `default` = underline tabs (page sections,
 *              state in ?tab=); `pills` = a segmented switch. Tabs without
 *              `content` render the tab bar only, for pages that render the
 *              section themselves.
 * @feature shared
 */

import { useState, useCallback, useId, memo, type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '@/shared/utils/cn';
import { focusRing } from './styles';

// ============================================================================
// TYPES
// ============================================================================

export interface Tab {
  /** Unique identifier for the tab */
  id: string;
  /** Display label for the tab */
  label: string;
  /** Optional icon to display before the label (w-4 h-4) */
  icon?: ReactNode;
  /** Tab content; omit (or null) to render the bar only */
  content?: ReactNode;
  /** Whether the tab is disabled */
  disabled?: boolean;
  /** Small count after the label */
  count?: number;
}

export interface TabsProps {
  /** Array of tab configurations */
  tabs: Tab[];
  /** Currently active tab ID (controlled) */
  activeTab?: string;
  /** Default active tab ID (uncontrolled) */
  defaultTab?: string;
  /** Callback when active tab changes */
  onTabChange?: (tabId: string) => void;
  /** Additional class names for the container */
  className?: string;
  /** Classes for the panel under the bar */
  panelClassName?: string;
  /** Variant for tab header styling */
  variant?: 'default' | 'pills';
  /** Accessible name of the tab list */
  label?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * @example
 * ```tsx
 * <Tabs
 *   tabs={[
 *     { id: 'routes', label: 'Routes', count: routes.length, content: <RoutesPanel /> },
 *     { id: 'runs', label: 'Runs', content: <RunsPanel /> },
 *   ]}
 *   activeTab={tab}
 *   onTabChange={setTab}
 * />
 * ```
 */
export const Tabs = memo(function Tabs({
  tabs,
  activeTab: controlledActiveTab,
  defaultTab,
  onTabChange,
  className,
  panelClassName,
  variant = 'default',
  label,
}: TabsProps) {
  const baseId = useId();
  const [internalActiveTab, setInternalActiveTab] = useState(defaultTab ?? tabs[0]?.id ?? '');

  const activeTab = controlledActiveTab ?? internalActiveTab;

  const handleTabClick = useCallback(
    (tabId: string) => {
      if (controlledActiveTab === undefined) {
        setInternalActiveTab(tabId);
      }
      onTabChange?.(tabId);
    },
    [controlledActiveTab, onTabChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      const enabledTabs = tabs.filter((t) => !t.disabled);
      const currentEnabledIndex = enabledTabs.findIndex((t) => t.id === tabs[currentIndex].id);

      let newIndex = currentEnabledIndex;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          newIndex = currentEnabledIndex - 1;
          if (newIndex < 0) newIndex = enabledTabs.length - 1;
          break;
        case 'ArrowRight':
          e.preventDefault();
          newIndex = currentEnabledIndex + 1;
          if (newIndex >= enabledTabs.length) newIndex = 0;
          break;
        case 'Home':
          e.preventDefault();
          newIndex = 0;
          break;
        case 'End':
          e.preventDefault();
          newIndex = enabledTabs.length - 1;
          break;
        default:
          return;
      }

      const newTab = enabledTabs[newIndex];
      if (newTab) {
        handleTabClick(newTab.id);
        document.getElementById(`${baseId}-tab-${newTab.id}`)?.focus();
      }
    },
    [tabs, handleTabClick, baseId],
  );

  const active = tabs.find((t) => t.id === activeTab);
  const hasPanel = active?.content !== undefined && active?.content !== null;
  const pills = variant === 'pills';

  return (
    <div className={cn('w-full min-w-0', className)}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        aria-label={label}
        className={cn(
          'scrollbar-hide overflow-x-auto',
          pills
            ? 'inline-flex max-w-full gap-0.5 rounded-control border border-line-subtle bg-inset p-[3px]'
            : 'flex gap-6 border-b border-line-subtle',
        )}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={isActive && hasPanel ? `${baseId}-panel-${tab.id}` : undefined}
              aria-disabled={tab.disabled}
              tabIndex={isActive ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && handleTabClick(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap font-medium',
                'transition-colors duration-150 ease-[var(--ease-instrument)]',
                focusRing,
                tab.disabled && 'cursor-not-allowed opacity-50',
                pills
                  ? cn(
                      'h-8 rounded-[7px] px-3 text-[13px]',
                      isActive
                        ? 'bg-raised text-ink-primary shadow-[0_1px_2px_rgba(0,0,0,0.18)]'
                        : 'text-ink-tertiary hover:text-ink-primary',
                    )
                  : cn(
                      'relative -mb-px h-10 border-b-2 px-0.5 text-sm',
                      isActive
                        ? 'border-primary text-ink-primary'
                        : 'border-transparent text-ink-tertiary hover:text-ink-primary',
                    ),
              )}
            >
              {tab.icon && (
                <span
                  aria-hidden="true"
                  className={cn('inline-flex shrink-0 [&_svg]:h-4 [&_svg]:w-4', isActive ? 'text-primary' : 'text-ink-muted')}
                >
                  {tab.icon}
                </span>
              )}
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'rounded-tag px-1.5 py-px text-[11px] font-medium leading-4 tabular-nums',
                    isActive ? 'bg-primary/10 text-primary' : 'bg-ink-secondary/[0.08] text-ink-tertiary',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {hasPanel && (
        <div
          id={`${baseId}-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${activeTab}`}
          tabIndex={0}
          className={cn('mt-5 focus:outline-none', panelClassName)}
        >
          {active?.content}
        </div>
      )}
    </div>
  );
});
