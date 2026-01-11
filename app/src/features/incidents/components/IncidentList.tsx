/**
 * @file IncidentList.tsx
 * @description Scrollable list displaying all incidents
 * @feature incidents
 * @dependencies @/shared/utils/cn, @/features/incidents/hooks
 */

import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';
import { useIncidents } from '../hooks/useIncidents';
import { IncidentCard } from './IncidentCard';
import type { Incident } from '../types/incidents.types';

// ============================================================================
// TYPES
// ============================================================================

export interface IncidentListProps {
  /** Maximum height of the list */
  maxHeight?: string;
  /** Filter to show only open incidents */
  showOnlyOpen?: boolean;
  /** Click handler for incident card */
  onIncidentClick?: (incident: Incident) => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-theme-tertiary mb-3"
      >
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
      <p className="text-sm text-theme-secondary">No incidents</p>
      <p className="text-xs text-theme-tertiary mt-1">All systems operating normally</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <Spinner size="md" />
      <p className="text-sm text-theme-secondary mt-3">Loading incidents...</p>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-red-500 mb-3"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="text-sm text-theme-secondary">{error}</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Scrollable list displaying all incidents.
 *
 * @example
 * ```tsx
 * function IncidentsPanel() {
 *   const navigate = useNavigate();
 *
 *   return (
 *     <div>
 *       <h2>Incidents</h2>
 *       <IncidentList
 *         maxHeight="400px"
 *         showOnlyOpen
 *         onIncidentClick={(i) => navigate(`/incidents/${i.id}`)}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export function IncidentList({
  maxHeight = '600px',
  showOnlyOpen = false,
  onIncidentClick,
  className,
}: IncidentListProps) {
  const { incidents, openIncidents, isLoading, error, pagination, nextPage, prevPage, fetchIncidents } =
    useIncidents();

  const displayIncidents = showOnlyOpen ? openIncidents : incidents;

  if (isLoading && incidents.length === 0) {
    return (
      <div className={className}>
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <ErrorState error={error} onRetry={() => fetchIncidents(1)} />
      </div>
    );
  }

  if (displayIncidents.length === 0) {
    return (
      <div className={className}>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className={className}>
      {/* List */}
      <div
        className="space-y-3 overflow-y-auto"
        style={{ maxHeight }}
      >
        {displayIncidents.map((incident) => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            onClick={onIncidentClick}
          />
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-theme-base">
          <span className="text-sm text-theme-secondary">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={prevPage}
              disabled={pagination.page <= 1 || isLoading}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={nextPage}
              disabled={pagination.page >= pagination.totalPages || isLoading}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Loading overlay for pagination */}
      {isLoading && incidents.length > 0 && (
        <div className="flex items-center justify-center py-2 mt-2">
          <Spinner size="sm" />
          <span className="text-xs text-theme-tertiary ml-2">Loading...</span>
        </div>
      )}
    </div>
  );
}
