/**
 * @file RobotDetailPage.tsx
 * @description Page displaying detailed information for a single robot
 * @feature robots
 * @dependencies @/features/robots/components, react-router-dom
 */

import { useParams, useNavigate } from 'react-router-dom';
import { RobotDetailPanel } from '../components/RobotDetailPanel';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Robot detail page showing comprehensive robot information.
 *
 * @example
 * ```tsx
 * // In router
 * <Route path="/robots/:id" element={<RobotDetailPage />} />
 * ```
 */
export function RobotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-theme-primary">Invalid Robot ID</h1>
          <p className="mt-2 text-theme-secondary">No robot ID was provided.</p>
        </div>
      </div>
    );
  }

  return <RobotDetailPanel robotId={id} onBack={() => navigate('/robots')} />;
}
