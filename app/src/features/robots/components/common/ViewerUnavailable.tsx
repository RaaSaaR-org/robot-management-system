/**
 * @file ViewerUnavailable.tsx
 * @description Calm message for a 3D or camera surface that cannot render (no WebGL,
 *   no feed). Fills its container; never an error box.
 * @feature robots
 */

import type { ReactNode } from 'react';
import { Box } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

export interface ViewerUnavailableProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Centered "this view is unavailable" panel on the inset surface. */
export function ViewerUnavailable({
  title = '3D view unavailable',
  description = 'This browser could not start WebGL. The robot keeps working; telemetry is still shown below.',
  icon,
  children,
  className,
}: ViewerUnavailableProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-2 rounded-control bg-inset px-6 py-8 text-center',
        className,
      )}
    >
      <span className="text-ink-tertiary" aria-hidden>
        {icon ?? <Box className="h-6 w-6" strokeWidth={1.75} />}
      </span>
      <p className="text-sm font-medium text-ink-primary">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-ink-tertiary">{description}</p>}
      {children}
    </div>
  );
}
