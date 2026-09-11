/**
 * @file RobotCard.tsx
 * @description Robot summary card for the fleet list grid: name link, model, status,
 *   battery, place, task and last seen, with row actions.
 * @feature robots
 */

import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Panel, RowActions, type RowActionItem } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { formatTimeAgo } from '@/shared/utils/format';
import { RobotStatusTag } from './common/RobotStatusTag';
import { Readout, type ReadoutTone } from './common/Readout';
import type { Robot } from '../types/robots.types';

export interface RobotCardProps {
  /** Robot data */
  robot: Robot;
  /** Click handler (opens the robot) */
  onClick?: () => void;
  /** Row actions shown in the kebab menu */
  actions?: RowActionItem[];
  /** Whether this card is selected */
  selected?: boolean;
  /** Compact mode: header and status only */
  compact?: boolean;
  /** Additional class names */
  className?: string;
}

/** Zone and floor, or "Place unknown". */
export function robotPlace(robot: Robot): string {
  const loc = robot.location;
  const parts: string[] = [];
  if (loc?.zone) parts.push(loc.zone);
  if (loc?.floor) parts.push(`Floor ${loc.floor}`);
  return parts.length ? parts.join(' · ') : 'Place unknown';
}

/** Battery value, unit and tone. Offline robots show the last report, untoned. */
export function robotBattery(robot: Robot): {
  value: string | null;
  unit?: string;
  tone?: ReadoutTone;
  hint?: string;
} {
  if (robot.batteryLevel === null || robot.metadata?.powerSource === 'ac_powered') {
    return { value: 'AC', hint: 'Mains powered' };
  }
  const level = Math.round(robot.batteryLevel);
  if (robot.status === 'offline') return { value: String(level), unit: '%', hint: 'Last reported' };
  const tone: ReadoutTone | undefined = level < 10 ? 'stopped' : level < 20 ? 'estimated' : undefined;
  return { value: String(level), unit: '%', tone };
}

/** Last seen as relative time, or "—". */
export function robotLastSeen(robot: Robot): string {
  if (!robot.lastSeen) return '—';
  const ago = formatTimeAgo(robot.lastSeen);
  return ago === 'Just now' ? 'just now' : ago;
}

/** A robot in the fleet list grid. */
export function RobotCard({ robot, onClick, actions, selected = false, compact = false, className }: RobotCardProps) {
  const battery = robotBattery(robot);
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <Panel
      interactive={Boolean(onClick)}
      onClick={onClick}
      padding="sm"
      data-testid="robot-card"
      aria-current={selected || undefined}
      className={cn('flex flex-col gap-4', selected && 'border-primary', className)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/robots/${robot.id}`}
            onClick={stop}
            className="block truncate text-sm font-semibold text-ink-primary hover:text-primary"
          >
            {robot.name}
          </Link>
          <div className="truncate text-[13px] text-ink-tertiary">{robot.model}</div>
        </div>
        {actions && actions.length > 0 && (
          <RowActions items={actions} label={`Actions for ${robot.name}`} />
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        <RobotStatusTag status={robot.status} />
        {!compact && (
          <Readout
            label="Battery"
            value={battery.value}
            unit={battery.unit}
            tone={battery.tone}
            className="items-end text-right"
          />
        )}
      </div>

      {!compact && (
        <div className="flex flex-col gap-1 border-t border-line-subtle pt-3 text-[13px] text-ink-tertiary">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">{robotPlace(robot)}</span>
            <span className="shrink-0">
              {robot.status === 'offline' ? `Seen ${robotLastSeen(robot)}` : robotLastSeen(robot)}
            </span>
          </div>
          {robot.currentTaskName && (
            <span className="truncate text-ink-secondary">Task: {robot.currentTaskName}</span>
          )}
        </div>
      )}
    </Panel>
  );
}
