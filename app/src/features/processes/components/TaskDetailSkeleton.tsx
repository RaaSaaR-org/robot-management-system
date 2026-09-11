/**
 * @file TaskDetailSkeleton.tsx
 * @description Loading state of the automation detail page, on the kit's skeletons
 * @feature processes
 */

import { Panel, Skeleton, SkeletonRows, SkeletonText } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';

interface TaskDetailSkeletonProps {
  className?: string;
}

/** Shaped like the loaded page: a stat row, the steps panel and the details panel. */
export function TaskDetailSkeleton({ className }: TaskDetailSkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-6', className)} aria-busy="true" aria-label="Loading automation">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Panel key={i} padding="sm" className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-16" />
          </Panel>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <SkeletonRows rows={4} columns={2} />
        </Panel>
        <Panel>
          <SkeletonText lines={5} />
        </Panel>
      </div>
    </div>
  );
}
