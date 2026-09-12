/**
 * @file FleetMapPopover.tsx
 * @description The robot popover on the fleet map: name, status, battery and
 *   task, with "Open robot" and "Robot's map" actions. Panel-styled HTML laid
 *   over the SVG map.
 * @feature fleet
 * @dependencies @/shared/components/ui, @/features/fleet/utils
 */

import { ArrowRight, Map as MapIcon, X } from 'lucide-react';
import { Button, StatusTag } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { RobotMapMarker } from '../types/fleet.types';
import { activateOnKey } from '../utils/svgButton';

export interface FleetMapPopoverProps {
  robot: RobotMapMarker;
  /** Anchor as a fraction (0–1) of the map's width and height */
  anchor: { x: number; y: number };
  onClose: () => void;
  onViewDetails: () => void;
  /** "Open robot's map" — the robot-built occupancy map on `/agent` (TASK-207). */
  onViewMap?: () => void;
}

/** Battery text: "80%", "AC power" or "unknown". */
function batteryText(robot: RobotMapMarker): string {
  if (robot.metadata?.powerSource === 'ac_powered') return 'AC power';
  return robot.batteryLevel === null ? 'unknown' : `${robot.batteryLevel}%`;
}

/**
 * Robot popover. Flips left/up near the right/bottom edge so it stays
 * inside the map. Every control activates on Enter and Space.
 */
export function FleetMapPopover({ robot, anchor, onClose, onViewDetails, onViewMap }: FleetMapPopoverProps) {
  const flipX = anchor.x > 0.6;
  const flipY = anchor.y > 0.55;

  return (
    <div
      className={cn(
        'absolute z-10 w-56 rounded-control border border-line bg-raised p-3 shadow-[var(--shadow-raised)]',
        flipX ? '-translate-x-[calc(100%+16px)]' : 'translate-x-4',
        flipY ? '-translate-y-full' : '-translate-y-3',
      )}
      style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
      role="dialog"
      aria-label={`${robot.name} details`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-primary">{robot.name}</div>
          <div className="mt-1">
            <StatusTag status={robot.status} dot size="sm" />
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={onClose}
          onKeyDown={activateOnKey<HTMLButtonElement>(onClose)}
          role="button"
          tabIndex={0}
          aria-label="Close robot popup"
          data-testid="fleet-close-popup"
          className="-mr-1 -mt-1"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </Button>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-ink-tertiary">Battery</dt>
        <dd className="text-right tabular-nums text-ink-secondary">{batteryText(robot)}</dd>
        <dt className="text-ink-tertiary">Task</dt>
        <dd className="truncate text-right text-ink-secondary">{robot.currentTask || 'None'}</dd>
      </dl>

      <div className="mt-3 flex flex-col gap-1 border-t border-line-subtle pt-2">
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          className="justify-between"
          rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.75} />}
          onClick={onViewDetails}
          onKeyDown={activateOnKey<HTMLButtonElement>(onViewDetails)}
          role="button"
          tabIndex={0}
          aria-label={`View ${robot.name} details`}
          data-testid="fleet-view-details"
        >
          Open robot
        </Button>
        {onViewMap && (
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            className="justify-between"
            rightIcon={<MapIcon className="h-4 w-4" strokeWidth={1.75} />}
            onClick={onViewMap}
            onKeyDown={activateOnKey<HTMLButtonElement>(onViewMap)}
            role="button"
            tabIndex={0}
            aria-label={`Open ${robot.name}'s map`}
            data-testid="fleet-open-robot-map"
          >
            Robot&apos;s map
          </Button>
        )}
      </div>
    </div>
  );
}
