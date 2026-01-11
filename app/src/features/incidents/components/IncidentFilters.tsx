/**
 * @file IncidentFilters.tsx
 * @description Filter controls for incident list
 * @feature incidents
 * @dependencies @/shared/utils/cn, @/features/incidents/types
 */

import { useState, useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import type { IncidentFilters as IncidentFiltersType, IncidentType, IncidentSeverity, IncidentStatus } from '../types/incidents.types';
import {
  INCIDENT_TYPE_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
} from '../types/incidents.types';

// ============================================================================
// TYPES
// ============================================================================

export interface IncidentFiltersProps {
  /** Current filters */
  filters: IncidentFiltersType;
  /** Handler when filters change */
  onFiltersChange: (filters: IncidentFiltersType) => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TYPES: IncidentType[] = ['safety', 'security', 'data_breach', 'ai_malfunction', 'vulnerability'];
const SEVERITIES: IncidentSeverity[] = ['critical', 'high', 'medium', 'low'];
const STATUSES: IncidentStatus[] = ['detected', 'investigating', 'contained', 'resolved', 'closed'];

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface FilterChipProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function FilterChip({ label, isActive, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
        isActive
          ? 'bg-cobalt text-white'
          : 'bg-theme-base text-theme-secondary hover:bg-theme-elevated hover:text-theme-primary'
      )}
    >
      {label}
    </button>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Filter controls for incident list.
 *
 * @example
 * ```tsx
 * function IncidentsPage() {
 *   const { filters, setFilters } = useIncidents();
 *
 *   return (
 *     <div>
 *       <IncidentFilters filters={filters} onFiltersChange={setFilters} />
 *       <IncidentList />
 *     </div>
 *   );
 * }
 * ```
 */
export function IncidentFilters({
  filters,
  onFiltersChange,
  className,
}: IncidentFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleType = useCallback((type: IncidentType) => {
    const currentTypes = filters.type || [];
    const newTypes = currentTypes.includes(type)
      ? currentTypes.filter((t) => t !== type)
      : [...currentTypes, type];
    onFiltersChange({ ...filters, type: newTypes.length > 0 ? newTypes : undefined });
  }, [filters, onFiltersChange]);

  const toggleSeverity = useCallback((severity: IncidentSeverity) => {
    const currentSeverities = filters.severity || [];
    const newSeverities = currentSeverities.includes(severity)
      ? currentSeverities.filter((s) => s !== severity)
      : [...currentSeverities, severity];
    onFiltersChange({ ...filters, severity: newSeverities.length > 0 ? newSeverities : undefined });
  }, [filters, onFiltersChange]);

  const toggleStatus = useCallback((status: IncidentStatus) => {
    const currentStatuses = filters.status || [];
    const newStatuses = currentStatuses.includes(status)
      ? currentStatuses.filter((s) => s !== status)
      : [...currentStatuses, status];
    onFiltersChange({ ...filters, status: newStatuses.length > 0 ? newStatuses : undefined });
  }, [filters, onFiltersChange]);

  const clearFilters = useCallback(() => {
    onFiltersChange({});
  }, [onFiltersChange]);

  const hasFilters = (filters.type?.length ?? 0) > 0 ||
    (filters.severity?.length ?? 0) > 0 ||
    (filters.status?.length ?? 0) > 0;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Toggle and Clear */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-1"
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          Filters
          {hasFilters && (
            <span className="ml-1 px-1.5 py-0.5 text-xs bg-cobalt text-white rounded-full">
              {(filters.type?.length ?? 0) + (filters.severity?.length ?? 0) + (filters.status?.length ?? 0)}
            </span>
          )}
        </Button>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear all
          </Button>
        )}
      </div>

      {/* Expanded Filters */}
      {isExpanded && (
        <div className="p-4 bg-theme-elevated rounded-lg space-y-4">
          {/* Type Filter */}
          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-2">
              Type
            </label>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((type) => (
                <FilterChip
                  key={type}
                  label={INCIDENT_TYPE_LABELS[type]}
                  isActive={filters.type?.includes(type) ?? false}
                  onClick={() => toggleType(type)}
                />
              ))}
            </div>
          </div>

          {/* Severity Filter */}
          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-2">
              Severity
            </label>
            <div className="flex flex-wrap gap-2">
              {SEVERITIES.map((severity) => (
                <FilterChip
                  key={severity}
                  label={INCIDENT_SEVERITY_LABELS[severity]}
                  isActive={filters.severity?.includes(severity) ?? false}
                  onClick={() => toggleSeverity(severity)}
                />
              ))}
            </div>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-xs font-medium text-theme-secondary mb-2">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((status) => (
                <FilterChip
                  key={status}
                  label={INCIDENT_STATUS_LABELS[status]}
                  isActive={filters.status?.includes(status) ?? false}
                  onClick={() => toggleStatus(status)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
