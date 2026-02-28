/**
 * @file ProcessesPage.tsx
 * @description Page displaying the list of all processes (workflow definitions)
 * @feature processes
 * @dependencies @/features/processes/components
 */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GitBranch } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { TaskList as ProcessList } from '../components/TaskList';
import { CreateProcessModal } from '../components/CreateProcessModal';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Main processes listing page.
 *
 * @example
 * ```tsx
 * // In router
 * <Route path="/processes" element={<ProcessesPage />} />
 * ```
 */
export function ProcessesPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="Process Management"
        icon={<GitBranch className="w-12 h-12" />}
        description="Orchestrate complex multi-robot workflows and automate repetitive task sequences across your fleet."
        capabilities={[
          "Define multi-step robot task pipelines",
          "Schedule recurring processes (daily inspections, charging routines)",
          "Monitor process execution with real-time logs",
          "Handle failures with automatic retry and escalation",
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
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Get robot filter from URL if present
  const robotIdFilter = searchParams.get('robotId') ?? undefined;

  const handleSelectProcess = (processId: string) => {
    navigate(`/processes/${processId}`);
  };

  const handleCreateSuccess = (processId: string) => {
    navigate(`/processes/${processId}`);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-theme-primary">Processes</h1>
        <p className="text-theme-secondary mt-1">View and manage workflow processes</p>
      </header>

      <ProcessList
        onSelectTask={handleSelectProcess}
        robotId={robotIdFilter}
        showFilters
        showCreateButton
        onCreateTask={() => setShowCreateModal(true)}
      />

      <CreateProcessModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
        preselectedRobotId={robotIdFilter}
      />
    </div>
  );
}

// Legacy alias for backwards compatibility
export { ProcessesPage as TasksPage };
