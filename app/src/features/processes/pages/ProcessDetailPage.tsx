/**
 * @file ProcessDetailPage.tsx
 * @description Page displaying detailed information for a single process
 * @feature processes
 * @dependencies @/features/processes/components, react-router-dom
 */

import { useParams, useNavigate } from 'react-router-dom';
import { TaskDetailPanel as ProcessDetailPanel } from '../components/TaskDetailPanel';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Process detail page showing comprehensive process information.
 *
 * @example
 * ```tsx
 * // In router
 * <Route path="/processes/:id" element={<ProcessDetailPage />} />
 * ```
 */
export function ProcessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-theme-primary">Invalid Process ID</h1>
          <p className="mt-2 text-theme-secondary">No process ID was provided.</p>
        </div>
      </div>
    );
  }

  return <ProcessDetailPanel taskId={id} onBack={() => navigate('/processes')} />;
}

// Legacy alias for backwards compatibility
export { ProcessDetailPage as TaskDetailPage };
