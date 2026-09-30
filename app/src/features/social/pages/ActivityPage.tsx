/**
 * @file ActivityPage.tsx
 * @description `/activity` — what people and agents said about datasets,
 *   views, models, episodes and runs, newest first (TASK-241).
 * @feature social
 */

import { PageHeader, Panel } from '@/shared/components/ui';
import { ActivityFeed } from '../components/ActivityFeed';

export function ActivityPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Activity"
        description="Comments and ratings from people and agents across datasets, models, episodes and runs."
      />
      <Panel>
        <ActivityFeed />
      </Panel>
    </div>
  );
}
