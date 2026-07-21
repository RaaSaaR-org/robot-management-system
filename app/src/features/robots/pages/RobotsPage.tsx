/**
 * @file RobotsPage.tsx
 * @description Page displaying the list of all robots
 * @feature robots
 * @dependencies @/features/robots/components
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/shared/components/ui/Button';
import { RobotList } from '../components/RobotList';
import { AddRobotDialog } from '../components/AddRobotDialog';

// ============================================================================
// ICONS
// ============================================================================

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Main robots listing page.
 *
 * @example
 * ```tsx
 * // In router
 * <Route path="/robots" element={<RobotsPage />} />
 * ```
 */
export function RobotsPage() {
  const navigate = useNavigate();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const handleSelectRobot = (robotId: string) => {
    navigate(`/robots/${robotId}`);
  };

  const handleRobotAdded = () => {
    // Robot is automatically added to the store
    // Optionally navigate to the new robot
  };

  return (
    <div className="space-y-6">
      {/* No page heading here — this view is embedded as the "List" tab of
          FleetPage, which already renders the page-level header. */}
      <div className="flex items-center justify-end">
        <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
          <PlusIcon className="w-5 h-5" />
          Add Robot
        </Button>
      </div>

      <RobotList
        onSelectRobot={handleSelectRobot}
        showFilters
        onAddRobot={() => setIsAddDialogOpen(true)}
      />

      <AddRobotDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onSuccess={handleRobotAdded}
      />
    </div>
  );
}
