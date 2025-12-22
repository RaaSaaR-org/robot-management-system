/**
 * @file Tabs.tsx
 * @description Reusable tabbed interface component with glass morphism styling
 * @feature shared
 */

import { useState, useCallback, useId, memo, type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export interface Tab {
  /** Unique identifier for the tab */
  id: string;
  /** Display label for the tab */
  label: string;
  /** Optional icon to display before the label */
  icon?: ReactNode;
  /** Tab content */
  content: ReactNode;
  /** Whether the tab is disabled */
  disabled?: boolean;
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
  /** Variant for tab header styling */
  variant?: 'default' | 'pills';
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Tabbed interface component with keyboard navigation and glass styling.
 *
 * @example
 * ```tsx
 * <Tabs
 *   tabs={[
 *     { id: 'telemetry', label: 'Telemetry', icon: <ChartIcon />, content: <TelemetryPanel /> },
 *     { id: 'commands', label: 'Commands', icon: <TerminalIcon />, content: <CommandsPanel /> },
 *   ]}
 *   defaultTab="telemetry"
 * />
 * ```
 */
export const Tabs = memo(function Tabs({
  tabs,
  activeTab: controlledActiveTab,
  defaultTab,
  onTabChange,
  className,
  variant = 'default',
}: TabsProps) {
  const baseId = useId();
  const [internalActiveTab, setInternalActiveTab] = useState(
    defaultTab ?? tabs[0]?.id ?? ''
  );

  // Use controlled or uncontrolled state
  const activeTab = controlledActiveTab ?? internalActiveTab;

  const handleTabClick = useCallback(
    (tabId: string) => {
      if (controlledActiveTab === undefined) {
        setInternalActiveTab(tabId);
      }
      onTabChange?.(tabId);
    },
    [controlledActiveTab, onTabChange]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      const enabledTabs = tabs.filter((t) => !t.disabled);
      const currentEnabledIndex = enabledTabs.findIndex(
        (t) => t.id === tabs[currentIndex].id
      );

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
        // Focus the new tab button
        const newButton = document.getElementById(`${baseId}-tab-${newTab.id}`);
        newButton?.focus();
      }
    },
    [tabs, handleTabClick, baseId]
  );

  const activeTabContent = tabs.find((t) => t.id === activeTab)?.content;

  return (
    <div className={cn('w-full', className)}>
      {/* Tab Headers */}
      <div
        role="tablist"
        aria-orientation="horizontal"
        className={cn(
          'flex gap-1',
          variant === 'default' && 'border-b border-glass-subtle',
          variant === 'pills' && 'glass-subtle p-1 rounded-xl'
        )}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTab;
          const tabId = `${baseId}-tab-${tab.id}`;
          const panelId = `${baseId}-panel-${tab.id}`;

          return (
            <button
              key={tab.id}
              id={tabId}
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId}
              aria-disabled={tab.disabled}
              tabIndex={isActive ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && handleTabClick(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
                variant === 'default' && [
                  'relative -mb-px border-b-2',
                  isActive
                    ? 'border-cobalt-500 text-cobalt-400'
                    : 'border-transparent text-theme-secondary hover:text-theme-primary hover:border-glass-highlight',
                  tab.disabled && 'opacity-50 cursor-not-allowed',
                ],
                variant === 'pills' && [
                  'rounded-lg',
                  isActive
                    ? 'bg-cobalt-500/20 text-cobalt-400 shadow-sm'
                    : 'text-theme-secondary hover:text-theme-primary hover:bg-glass-subtle',
                  tab.disabled && 'opacity-50 cursor-not-allowed',
                ]
              )}
            >
              {tab.icon && (
                <span
                  className={cn(
                    'flex-shrink-0',
                    isActive ? 'text-cobalt-400' : 'text-theme-tertiary'
                  )}
                >
                  {tab.icon}
                </span>
              )}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panel */}
      <div
        id={`${baseId}-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${activeTab}`}
        tabIndex={0}
        className="mt-6 focus:outline-none"
      >
        {activeTabContent}
      </div>
    </div>
  );
});
