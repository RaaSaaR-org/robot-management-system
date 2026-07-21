/**
 * @file OrganizationsEmptyState.tsx
 * @description Hero empty state shown when only the DEFAULT tenant exists.
 * Offers a one-click "Load sample (Acme Robotics)" CTA so demos have a
 * second org visible in seconds.
 * @feature organizations
 */

import { Button } from '@/shared/components/ui/Button';
import { EmptyState } from '@/shared/components/ui/EmptyState';

interface EmptyStateProps {
  onCreate: () => void;
  onLoadSample: () => void;
  sampleLoading?: boolean;
}

const SparkleIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

export function OrganizationsEmptyState({
  onCreate,
  onLoadSample,
  sampleLoading,
}: EmptyStateProps) {
  return (
    <div className="rounded-brand border border-dashed border-theme bg-theme-card">
      <EmptyState
        icon={
          <div className="mx-auto w-14 h-14 rounded-brand bg-cobalt/10 text-cobalt flex items-center justify-center">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
        }
        title="No customer organizations yet"
        description="Row-level multi-tenancy is active. Create your first customer organization to see isolated robots, datasets, and training jobs in action."
        action={
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Button variant="primary" size="md" onClick={onCreate}>
              Create organization
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={onLoadSample}
              isLoading={sampleLoading}
              loadingText="Loading sample..."
              leftIcon={<SparkleIcon />}
            >
              Load sample (Acme Robotics)
            </Button>
          </div>
        }
      />
    </div>
  );
}
