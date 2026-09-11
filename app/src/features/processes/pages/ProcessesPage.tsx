/**
 * @file ProcessesPage.tsx
 * @description Automations: multi-step jobs robots run, their progress, and the
 *              acts on them (TASK-143)
 * @feature processes
 */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Workflow } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Button, PageHeader } from '@/shared/components/ui';
import { TaskList as ProcessList } from '../components/TaskList';
import { CreateProcessModal } from '../components/CreateProcessModal';

export function ProcessesPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        eyebrow="Automate"
        featureName="Automations"
        icon={<Workflow className="h-5 w-5" />}
        description="Multi-step jobs your robots run on their own, and how far they got."
        capabilities={[
          'Define multi-step robot jobs',
          'Schedule recurring automations (daily inspections, charging routines)',
          'Follow each run step by step, live',
          'Pause, resume, retry or cancel a run',
        ]}
        docsSlug="architecture"
      />
    );
  }

  return <ProcessesPageInner />;
}

function ProcessesPageInner() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const robotIdFilter = searchParams.get('robotId') ?? undefined;

  const newButton = (
    <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setCreateOpen(true)}>
      New automation
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Automate"
        title="Automations"
        description="Multi-step jobs your robots run, and how far they got."
        actions={newButton}
      />

      <ProcessList
        onSelectTask={(id) => navigate(`/processes/${id}`)}
        robotId={robotIdFilter}
        onCreateTask={() => setCreateOpen(true)}
      />

      <CreateProcessModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={(id) => navigate(`/processes/${id}`)}
        preselectedRobotId={robotIdFilter}
      />
    </div>
  );
}
