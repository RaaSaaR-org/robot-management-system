/**
 * @file IncidentFilters.tsx
 * @description Incident filters as kit Selects for a Toolbar's `filters` slot
 *              (severity and type; server-side through the store's filters)
 * @feature incidents
 */

import { Select } from '@/shared/components/ui';
import type {
  IncidentFilters as IncidentFiltersType,
  IncidentSeverity,
  IncidentType,
} from '../types/incidents.types';
import { INCIDENT_SEVERITY_LABELS, INCIDENT_TYPE_LABELS } from '../types/incidents.types';

export interface IncidentFiltersProps {
  /** Current filters */
  filters: IncidentFiltersType;
  /** Callback when filters change */
  onFiltersChange: (filters: IncidentFiltersType) => void;
}

const SEVERITY_OPTIONS = (Object.keys(INCIDENT_SEVERITY_LABELS) as IncidentSeverity[]).map((s) => ({
  value: s,
  label: INCIDENT_SEVERITY_LABELS[s],
}));
const TYPE_OPTIONS = (Object.keys(INCIDENT_TYPE_LABELS) as IncidentType[]).map((t) => ({
  value: t,
  label: INCIDENT_TYPE_LABELS[t],
}));

/**
 * Severity and type selects; render inside `<Toolbar filters={…} />`.
 *
 * @example
 * <Toolbar filters={<IncidentFilters filters={filters} onFiltersChange={setFilters} />} />
 */
export function IncidentFilters({ filters, onFiltersChange }: IncidentFiltersProps) {
  return (
    <>
      <Select
        aria-label="Severity"
        fullWidth={false}
        className="w-40"
        placeholder="All severities"
        options={SEVERITY_OPTIONS}
        value={filters.severity?.[0] ?? ''}
        onChange={(e) =>
          onFiltersChange({
            ...filters,
            severity: e.target.value ? [e.target.value as IncidentSeverity] : undefined,
          })
        }
      />
      <Select
        aria-label="Type"
        fullWidth={false}
        className="w-40"
        placeholder="All types"
        options={TYPE_OPTIONS}
        value={filters.type?.[0] ?? ''}
        onChange={(e) =>
          onFiltersChange({
            ...filters,
            type: e.target.value ? [e.target.value as IncidentType] : undefined,
          })
        }
      />
    </>
  );
}
