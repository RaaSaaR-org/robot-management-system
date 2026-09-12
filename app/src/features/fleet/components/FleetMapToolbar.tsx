/**
 * @file FleetMapToolbar.tsx
 * @description The fleet map's toolbar row: floor switch, robot count and the
 *   status legend. Replaces the map's old inner title bar.
 * @feature fleet
 * @dependencies @/shared/components/ui, @/features/fleet/utils
 */

import { SegmentedControl } from '@/shared/components/ui';
import { TONE_VAR } from '../utils/mapColors';

const LEGEND = [
  { tone: 'success', label: 'Online' },
  { tone: 'info', label: 'Busy' },
  { tone: 'warning', label: 'Charging' },
  { tone: 'danger', label: 'Fault' },
  { tone: 'neutral', label: 'Offline' },
] as const;

export interface FleetMapToolbarProps {
  floors: string[];
  selectedFloor: string;
  onFloorChange: (floor: string) => void;
  robotCount: number;
}

/** Floor SegmentedControl (when there is more than one floor) + legend. */
export function FleetMapToolbar({ floors, selectedFloor, onFloorChange, robotCount }: FleetMapToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-2.5">
      <div className="flex items-center gap-3">
        {floors.length > 1 ? (
          <SegmentedControl
            label="Floor"
            size="sm"
            options={floors.map((f) => ({ value: f, label: `Floor ${f}` }))}
            value={selectedFloor}
            onChange={onFloorChange}
          />
        ) : (
          <span className="text-[13px] font-medium text-ink-secondary">Floor {selectedFloor}</span>
        )}
        <span className="text-[13px] tabular-nums text-ink-tertiary">
          {robotCount} {robotCount === 1 ? 'robot' : 'robots'}
        </span>
      </div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-tertiary" aria-label="Legend">
        {LEGEND.map(({ tone, label }) => (
          <li key={tone} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TONE_VAR[tone] }} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
