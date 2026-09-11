/**
 * @file RobotDetailPage.tsx
 * @description Route entry for /robots/:id — renders the robot detail page
 * @feature robots
 */

import { useParams } from 'react-router-dom';
import { ErrorState, PageHeader, Panel } from '@/shared/components/ui';
import { RobotDetailPanel } from '../components/RobotDetailPanel';

/**
 * Robot detail page.
 *
 * @example
 * ```tsx
 * <Route path="/robots/:id" element={<RobotDetailPage />} />
 * ```
 */
export function RobotDetailPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Operate" back={{ to: '/fleet?tab=list', label: 'Fleet' }} title="Robot not found" />
        <Panel>
          <ErrorState title="Couldn't load this robot" message="The link has no robot ID." />
        </Panel>
      </div>
    );
  }

  return <RobotDetailPanel robotId={id} />;
}
