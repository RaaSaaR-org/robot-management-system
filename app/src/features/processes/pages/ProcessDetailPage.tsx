/**
 * @file ProcessDetailPage.tsx
 * @description One automation: status, progress, steps and the acts on it
 * @feature processes
 */

import { useParams } from 'react-router-dom';
import { ErrorState, PageHeader, Panel } from '@/shared/components/ui';
import { TaskDetailPanel as ProcessDetailPanel } from '../components/TaskDetailPanel';

export function ProcessDetailPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Operate" back={{ to: '/processes', label: 'Automations' }} title="Automation not found" />
        <Panel>
          <ErrorState title="No automation selected" message="The link has no automation ID." />
        </Panel>
      </div>
    );
  }

  return <ProcessDetailPanel taskId={id} />;
}
