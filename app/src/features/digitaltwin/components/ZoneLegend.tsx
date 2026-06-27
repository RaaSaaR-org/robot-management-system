/**
 * @file ZoneLegend.tsx
 * @description Color key for the L2 zone types (keep-out / work-cell / charging /
 *   speed) so the meaning of each polygon color is discoverable in the editor.
 * @feature digitaltwin
 */

import { memo } from 'react';
import { TWIN_ZONE_COLORS } from '../store/twinZoneStore';
import type { TwinZoneType } from '../types/twin.types';

const ZONE_LABELS: Record<TwinZoneType, string> = {
  keepout: 'Keep-out',
  workcell: 'Work-cell',
  charging: 'Charging',
  speed: 'Speed limit',
};

export const ZoneLegend = memo(function ZoneLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      {(Object.keys(ZONE_LABELS) as TwinZoneType[]).map((type) => (
        <span key={type} className="flex items-center gap-1.5 text-[11px] text-theme-tertiary">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: TWIN_ZONE_COLORS[type] }} />
          {ZONE_LABELS[type]}
        </span>
      ))}
    </div>
  );
});
