/**
 * @file SegmentedControl.tsx
 * @description Shared pill controls: SegmentedControl (single-select group) and
 *              ToggleChip (independent on/off pill). Replaces the per-feature
 *              hand-rolled filter/toggle buttons so active states and radii are
 *              identical everywhere (cobalt accent, brand radius).
 * @feature shared
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// SHARED PILL STYLES
// ============================================================================

const pillBase =
  'px-2.5 py-1.5 rounded-brand text-xs font-medium transition-colors duration-150 whitespace-nowrap';

const pillActive =
  'text-cobalt-500 dark:text-cobalt-300 bg-cobalt-500/10 border border-cobalt-500/30';

const pillInactive =
  'text-theme-tertiary hover:text-theme-secondary hover:bg-theme-elevated border border-theme';

// ============================================================================
// SEGMENTED CONTROL (single-select)
// ============================================================================

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional tooltip */
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group */
  label?: string;
  className?: string;
}

/**
 * Single-select pill group.
 *
 * @example
 * ```tsx
 * <SegmentedControl
 *   options={[{ value: 'map', label: 'Map' }, { value: 'list', label: 'List' }]}
 *   value={view}
 *   onChange={setView}
 * />
 * ```
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex items-center gap-1', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(pillBase, value === option.value ? pillActive : pillInactive)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// TOGGLE CHIP (independent on/off)
// ============================================================================

export interface ToggleChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Optional tooltip */
  title?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Independent on/off pill (e.g. "Robot model", "Clip room").
 *
 * @example
 * ```tsx
 * <ToggleChip active={showModel} onClick={() => setShowModel(v => !v)}>Robot model</ToggleChip>
 * ```
 */
export function ToggleChip({ active, onClick, children, title, disabled, className }: ToggleChipProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        pillBase,
        active ? pillActive : pillInactive,
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      {children}
    </button>
  );
}
