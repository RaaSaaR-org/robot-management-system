/**
 * @file KeyValueList.tsx
 * @description Label/value grid for detail pages ("Model", "Firmware", "Last
 *              seen"). Machine values (IDs, hashes) can opt into mono.
 * @feature shared
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { labelCaps } from './styles';

export interface KeyValueItem {
  label: ReactNode;
  /** Empty values render as an em dash */
  value: ReactNode;
  /** Render the value in mono (IDs, hashes, commands) */
  mono?: boolean;
  /** Stable key when labels are not strings */
  key?: string;
}

export interface KeyValueListProps {
  items: KeyValueItem[];
  /** Columns at the widest breakpoint (default 2) */
  columns?: 1 | 2 | 3;
  className?: string;
}

const COLUMN_STYLES: Record<1 | 2 | 3, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
};

/**
 * @example
 * ```tsx
 * <KeyValueList
 *   items={[
 *     { label: 'Model', value: 'Unitree G1 EDU' },
 *     { label: 'Serial', value: robot.serial, mono: true },
 *     { label: 'Last seen', value: formatRelative(robot.lastSeen) },
 *   ]}
 * />
 * ```
 */
export function KeyValueList({ items, columns = 2, className }: KeyValueListProps) {
  return (
    <dl className={cn('grid gap-x-8 gap-y-4', COLUMN_STYLES[columns], className)}>
      {items.map((item, index) => {
        const empty = item.value === null || item.value === undefined || item.value === '';
        return (
          <div key={item.key ?? (typeof item.label === 'string' ? item.label : index)} className="min-w-0">
            <dt className={labelCaps}>{item.label}</dt>
            <dd className="mt-1 break-words text-sm text-ink-primary">
              {empty ? (
                <span className="text-ink-muted">—</span>
              ) : item.mono ? (
                <code className="font-mono text-[13px] text-ink-primary">{item.value}</code>
              ) : (
                item.value
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
