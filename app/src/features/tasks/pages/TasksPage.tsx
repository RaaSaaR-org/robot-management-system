/**
 * @file TasksPage.tsx
 * @description Page displaying the list of all tasks
 * @feature tasks
 * @dependencies @/features/tasks/components
 */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TaskList } from '../components/TaskList';
import { CreateTaskModal } from '../components/CreateTaskModal';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Main tasks listing page.
 *
 * @example
 * ```tsx
 * // In router
 * <Route path="/tasks" element={<TasksPage />} />
 * ```
 */
export function TasksPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Get robot filter from URL if present
  const robotIdFilter = searchParams.get('robotId') ?? undefined;

  const handleSelectTask = (taskId: string) => {
    navigate(`/tasks/${taskId}`);
  };

  const handleCreateSuccess = (taskId: string) => {
    navigate(`/tasks/${taskId}`);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-theme-primary">Tasks</h1>
        <p className="text-theme-secondary mt-1">View and manage robot tasks</p>
      </header>

      <TaskList
        onSelectTask={handleSelectTask}
        robotId={robotIdFilter}
        showFilters
        showCreateButton
        onCreateTask={() => setShowCreateModal(true)}
      />

      <CreateTaskModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
        preselectedRobotId={robotIdFilter}
      />
    </div>
  );
}
