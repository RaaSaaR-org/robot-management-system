/**
 * @file TaskDetailSkeleton.tsx
 * @description Skeleton loading state for TaskDetailPanel
 * @feature processes
 */

import { Card } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

interface TaskDetailSkeletonProps {
  className?: string;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse bg-theme-elevated rounded',
        className
      )}
    />
  );
}

function StatCardSkeleton() {
  return (
    <div className="p-4 rounded-brand border border-theme bg-theme-card">
      <div className="flex items-center gap-3">
        <SkeletonBox className="h-9 w-9 rounded-lg" />
        <div className="flex-1">
          <SkeletonBox className="h-4 w-20 mb-2" />
          <SkeletonBox className="h-6 w-24" />
        </div>
      </div>
    </div>
  );
}

function StepSkeleton() {
  return (
    <div className="flex items-start gap-3 py-3">
      <SkeletonBox className="h-6 w-6 rounded-full flex-shrink-0" />
      <div className="flex-1">
        <SkeletonBox className="h-5 w-32 mb-2" />
        <SkeletonBox className="h-4 w-48" />
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Skeleton loading state that matches TaskDetailPanel structure.
 */
export function TaskDetailSkeleton({ className }: TaskDetailSkeletonProps) {
  return (
    <div className={cn('space-y-6', className)} aria-busy="true" aria-label="Loading process details">
      {/* Header Skeleton */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <SkeletonBox className="h-9 w-20 rounded-brand" />
          <div className="flex items-center gap-3">
            <SkeletonBox className="h-12 w-12 rounded-xl" />
            <div>
              <SkeletonBox className="h-6 w-48 mb-2" />
              <SkeletonBox className="h-4 w-32" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBox className="h-6 w-16 rounded-full" />
          <SkeletonBox className="h-6 w-20 rounded-full" />
        </div>
      </div>

      {/* Quick Stats Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Progress Card Skeleton */}
      <Card>
        <Card.Header>
          <SkeletonBox className="h-6 w-32" />
        </Card.Header>
        <Card.Body className="space-y-4">
          <div>
            <div className="flex justify-between mb-1">
              <SkeletonBox className="h-4 w-24" />
              <SkeletonBox className="h-4 w-8" />
            </div>
            <SkeletonBox className="h-2 w-full rounded-full" />
          </div>
          <SkeletonBox className="h-4 w-36" />
        </Card.Body>
      </Card>

      {/* Steps Card Skeleton */}
      <Card>
        <Card.Header>
          <SkeletonBox className="h-6 w-16" />
        </Card.Header>
        <Card.Body>
          <div className="space-y-2 divide-y divide-theme">
            <StepSkeleton />
            <StepSkeleton />
            <StepSkeleton />
          </div>
        </Card.Body>
      </Card>

      {/* Actions Card Skeleton */}
      <Card>
        <Card.Header>
          <SkeletonBox className="h-6 w-20" />
        </Card.Header>
        <Card.Body>
          <div className="flex flex-wrap gap-3">
            <SkeletonBox className="h-10 w-32 rounded-brand" />
            <SkeletonBox className="h-10 w-32 rounded-brand" />
            <SkeletonBox className="h-10 w-24 rounded-brand" />
          </div>
        </Card.Body>
      </Card>

      {/* Task Info Card Skeleton */}
      <Card>
        <Card.Header>
          <SkeletonBox className="h-6 w-36" />
        </Card.Header>
        <Card.Body>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i}>
                <SkeletonBox className="h-4 w-20 mb-1" />
                <SkeletonBox className="h-5 w-40" />
              </div>
            ))}
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
