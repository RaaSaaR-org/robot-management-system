/**
 * @file SafetyStatusDashboard.tsx
 * @description Real-time safety status for the fleet: a stat row, one row per
 *              robot (E-stop state, mode, speed, connection) and the recent
 *              safety events. `compact` renders a single status strip.
 * @feature safety
 */

import { ShieldCheck } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import {
  EmptyState,
  KeyValueList,
  Panel,
  SkeletonRows,
  StatRow,
  StatTile,
  StatusTag,
  type Tone,
} from '@/shared/components/ui';
import { formatDateTime, formatTimeAgo } from '@/shared/utils/format';
import { useSafetyOverview } from '../hooks/useSafety';
import { FleetEmergencyStopButton } from './FleetEmergencyStopButton';
import {
  OPERATING_MODE_LABELS,
  type EStopEvent,
  type EStopStatus,
  type RobotSafetyStatus,
} from '../types/safety.types';

const ESTOP_TONE: Record<EStopStatus, Tone> = { armed: 'live', triggered: 'stopped', resetting: 'gated' };
const ESTOP_LABEL: Record<EStopStatus, string> = { armed: 'Armed', triggered: 'Stopped', resetting: 'Resetting' };
const SCOPE_TONE: Record<EStopEvent['scope'], Tone> = { fleet: 'stopped', zone: 'gated', robot: 'gated' };

function RobotSafetyRow({ robot }: { robot: RobotSafetyStatus }) {
  const nearLimit = robot.currentSpeed > robot.activeSpeedLimit * 0.9;
  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-ink-primary">{robot.robotName}</span>
        <StatusTag tone={ESTOP_TONE[robot.status]} dot>
          {ESTOP_LABEL[robot.status]}
        </StatusTag>
        {!robot.systemHealthy && <StatusTag tone="gated">Degraded</StatusTag>}
        {robot.warnings.map((w) => (
          <StatusTag key={w} tone="warning" size="sm">
            {w}
          </StatusTag>
        ))}
      </div>
      <KeyValueList
        columns={3}
        items={[
          { label: 'Mode', value: OPERATING_MODE_LABELS[robot.operatingMode] },
          {
            label: 'Speed',
            value: (
              <span className={cn('tabular-nums', nearLimit && 'text-signal-unknown')}>
                {robot.currentSpeed.toFixed(0)} / {robot.activeSpeedLimit} mm/s
              </span>
            ),
          },
          {
            label: 'Connection',
            value: <StatusTag status={robot.serverConnected ? 'connected' : 'offline'} size="sm" />,
          },
        ]}
      />
      {robot.reason && robot.status === 'triggered' && (
        <p className="text-[13px] text-signal-stopped">Reason: {robot.reason}</p>
      )}
    </li>
  );
}

function SafetyEventRow({ event }: { event: EStopEvent }) {
  const n = event.affectedRobots.length;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <StatusTag tone={SCOPE_TONE[event.scope]} className="mt-0.5 capitalize">
          {event.scope}
        </StatusTag>
        <div className="min-w-0">
          <p className="text-sm text-ink-primary">{event.reason}</p>
          <p className="text-[13px] text-ink-tertiary">
            {n} robot{n === 1 ? '' : 's'} affected
          </p>
        </div>
      </div>
      <time className="text-[13px] tabular-nums text-ink-tertiary" dateTime={event.triggeredAt} title={formatDateTime(event.triggeredAt)}>
        {formatTimeAgo(event.triggeredAt)}
      </time>
    </li>
  );
}

export interface SafetyStatusDashboardProps {
  /** Additional class names */
  className?: string;
  /** Show compact version */
  compact?: boolean;
}

/**
 * Real-time safety status for the fleet: E-stop state, operating modes,
 * speed limits and warnings.
 */
export function SafetyStatusDashboard({ className, compact = false }: SafetyStatusDashboardProps) {
  const { fleetStatus, hasTriggeredEStop, triggeredCount, systemHealthy, totalRobots, onlineRobots, recentEvents } =
    useSafetyOverview();

  if (!fleetStatus) {
    return (
      <Panel padding="sm" className={className} aria-busy="true" aria-label="Loading safety status">
        <SkeletonRows rows={compact ? 1 : 3} columns={3} dense />
      </Panel>
    );
  }

  if (compact) {
    return (
      <Panel padding="sm" className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
        <div className="flex flex-wrap items-center gap-3">
          {hasTriggeredEStop ? (
            <StatusTag tone="stopped" dot>{`E-stop active · ${triggeredCount}`}</StatusTag>
          ) : (
            <StatusTag tone={systemHealthy ? 'live' : 'gated'} dot>
              {systemHealthy ? 'Safety normal' : 'Needs a look'}
            </StatusTag>
          )}
          <span className="text-[13px] tabular-nums text-ink-tertiary">
            {onlineRobots} of {totalRobots} robots connected
          </span>
        </div>
        <FleetEmergencyStopButton size="sm" />
      </Panel>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <StatRow columns={4}>
        <StatTile label="System" value={systemHealthy ? 'Normal' : 'Alert'} tone={systemHealthy ? 'live' : 'stopped'} />
        <StatTile label="E-stops active" value={triggeredCount} tone={triggeredCount > 0 ? 'stopped' : 'live'} />
        <StatTile label="Robots connected" value={onlineRobots} unit={`/ ${totalRobots}`} tone={onlineRobots === totalRobots ? 'live' : 'gated'} />
        <StatTile label="Last update" value={new Date(fleetStatus.timestamp).toLocaleTimeString()} hint="Refreshes every 5 s" />
      </StatRow>

      <Panel>
        <Panel.Header title="Robot safety" description="E-stop state, mode and speed limit per robot." actions={<FleetEmergencyStopButton size="md" />} />
        {fleetStatus.robots.length === 0 ? (
          <Panel.Body>
            <EmptyState size="sm" icon={<ShieldCheck />} title="No robots registered" description="Robots appear here once their agent connects." />
          </Panel.Body>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {fleetStatus.robots.map((robot) => (
              <RobotSafetyRow key={robot.robotId} robot={robot} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <Panel.Header title="Recent safety events" />
        {recentEvents.length === 0 ? (
          <Panel.Body>
            <EmptyState size="sm" icon={<ShieldCheck />} title="No safety events" description="Every E-stop, fleet, zone or robot, is logged here." />
          </Panel.Body>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {recentEvents.map((event) => (
              <SafetyEventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
