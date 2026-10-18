/**
 * @file PresenceBar.tsx
 * @description Who is in the session right now (TASK-414): one small avatar
 *              chip per watcher — "Anna · headset", "Ben · desktop" — for the
 *              session page's header. Nothing when nobody (else) watches.
 * @feature datacollection
 */

import { Glasses, Monitor } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { PresenceViewer } from '../types/datacollection.types';
import { viewerInitials, viewerLabel } from '../utils/presenceFormat';

export interface PresenceBarProps {
  viewers: readonly PresenceViewer[];
  className?: string;
}

export function PresenceBar({ viewers, className }: PresenceBarProps) {
  if (viewers.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid="presence-bar" aria-label="In this session">
      {viewers.map((viewer, i) => {
        const Icon = viewer.role === 'operator' ? Glasses : Monitor;
        return (
          <li
            key={`${viewer.userId}-${viewer.role}-${viewer.since}-${i}`}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border pl-0.5 pr-2.5 text-[12px]',
              viewer.role === 'operator'
                ? 'border-primary/40 bg-primary/10 text-ink-primary'
                : 'border-line bg-inset text-ink-secondary',
            )}
            data-testid="presence-viewer"
            data-role={viewer.role}
            title={`${viewerLabel(viewer)} since ${new Date(viewer.since).toLocaleTimeString()}`}
          >
            <span
              aria-hidden
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold',
                viewer.role === 'operator' ? 'bg-primary text-on-primary' : 'bg-panel text-ink-secondary',
              )}
            >
              {viewerInitials(viewer.displayName)}
            </span>
            <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden />
            <span>{viewerLabel(viewer)}</span>
          </li>
        );
      })}
    </ul>
  );
}
