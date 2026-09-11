/**
 * @file ZoneLegend.tsx
 * @description Colour key for the L2 zone types (keep-out / work-cell / charging /
 *   speed / room) so the meaning of each polygon colour is discoverable in the
 *   editor. The swatches are the zone type colours (data), not UI colours.
 * @feature digitaltwin
 */

import { memo } from 'react';
import { TWIN_ZONE_COLORS } from '../store/twinZoneStore';
import type { TwinZoneType } from '../types/twin.types';

export const ZONE_TYPE_LABELS: Record<TwinZoneType, string> = {
  keepout: 'Keep-out',
  workcell: 'Work cell',
  charging: 'Charging',
  speed: 'Speed limit',
  room: 'Room / place',
};

export const ZoneLegend = memo(function ZoneLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Zone colours">
      {(Object.keys(ZONE_TYPE_LABELS) as TwinZoneType[]).map((type) => (
        <span key={type} className="flex items-center gap-1.5 text-xs text-ink-tertiary">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TWIN_ZONE_COLORS[type] }} aria-hidden="true" />
          {ZONE_TYPE_LABELS[type]}
        </span>
      ))}
    </div>
  );
});
