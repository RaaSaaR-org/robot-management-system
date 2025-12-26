/**
 * @file ProcessesPage.tsx
 * @description Page displaying the list of all processes (workflow definitions)
 * @feature tasks
 * @dependencies @/features/tasks/components
 */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TaskList as ProcessList } from '../components/TaskList';
import { CreateTaskModal as CreateProcessModal } from '../components/CreateTaskModal';

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
