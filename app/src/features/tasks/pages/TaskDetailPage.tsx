/**
 * @file TaskDetailPage.tsx
 * @description Page displaying detailed information for a single task
 * @feature tasks
 * @dependencies @/features/tasks/components, react-router-dom
 */

import { useParams, useNavigate } from 'react-router-dom';
import { TaskDetailPanel } from '../components/TaskDetailPanel';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Task detail page showing comprehensive task information.
 *
 * @example
 * ```tsx
 * // In router
 * <Route path="/tasks/:id" element={<TaskDetailPage />} />
 * ```
 */
export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-theme-primary">Invalid Task ID</h1>
          <p className="mt-2 text-theme-secondary">No task ID was provided.</p>
        </div>
      </div>
    );
  }

  return <TaskDetailPanel taskId={id} onBack={() => navigate('/tasks')} />;
}
