/**
 * @file NeedsAttentionPanel.tsx
 * @description Dashboard panel listing what needs the operator now: open
 *   critical/error alerts and robots that are faulted, stopped or nearly flat.
 * @feature dashboard
 * @dependencies @/shared/components/ui, @/features/alerts, @/features/fleet, @/features/incidents
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BatteryLow, Bot, CheckCircle2, ChevronRight } from 'lucide-react';
import { EmptyState, LinkButton, Panel, StatusTag, statusTone } from '@/shared/components/ui';
import { useAlerts } from '@/features/alerts';
import type { RobotMapMarker } from '@/features/fleet';
import { humanizeMachineText } from '@/features/incidents/utils/humanize';
import { formatTimeAgo } from '@/shared/utils/format';

const MAX_ROWS = 5;

interface AttentionItem {
  key: string;
  title: string;
  meta: string;
  tag: React.ReactNode;
  icon?: React.ReactNode;
  to: string;
}

function isLowBattery(r: RobotMapMarker): boolean {
  return r.metadata?.powerSource !== 'ac_powered' && r.batteryLevel !== null && r.batteryLevel < 20;
}

export interface NeedsAttentionPanelProps {
  /** Robots of the fleet (from useFleetStatus) */
  robots: RobotMapMarker[];
  className?: string;
}

/**
 * Up to five items, alerts first (most severe, newest), then robots. Each
 * row links to where the operator deals with it.
 */
export function NeedsAttentionPanel({ robots, className }: NeedsAttentionPanelProps) {
  const navigate = useNavigate();
  const { unacknowledgedAlerts } = useAlerts();

  const items = useMemo<AttentionItem[]>(() => {
    const alertItems = unacknowledgedAlerts
      .filter((a) => a.severity === 'critical' || a.severity === 'error')
      .sort((a, b) =>
        a.severity === b.severity
          ? new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          : a.severity === 'critical' ? -1 : 1,
      )
      .map<AttentionItem>((a) => ({
        key: `alert-${a.id}`,
        title: humanizeMachineText(a.title).summary || a.title,
        meta: formatTimeAgo(a.timestamp),
        tag: <StatusTag status={a.severity} size="sm" />,
        to: '/alerts',
      }));

    const robotItems = robots
      .filter((r) => statusTone(r.status) === 'danger' || isLowBattery(r))
      .map<AttentionItem>((r) => {
        const faulted = statusTone(r.status) === 'danger';
        return {
          key: `robot-${r.robotId}`,
          title: r.name,
          meta: faulted ? 'Needs a look before it can work again' : `Battery at ${r.batteryLevel}%`,
          tag: faulted ? <StatusTag status={r.status} size="sm" /> : <StatusTag tone="gated" size="sm">Low battery</StatusTag>,
          icon: faulted ? <Bot className="h-4 w-4" strokeWidth={1.75} /> : <BatteryLow className="h-4 w-4" strokeWidth={1.75} />,
          to: `/robots/${r.robotId}`,
        };
      });

    return [...alertItems, ...robotItems];
  }, [unacknowledgedAlerts, robots]);

  const shown = items.slice(0, MAX_ROWS);
  const more = items.length - shown.length;

  return (
    <Panel className={className}>
      <Panel.Header
        title="Needs attention"
        description={items.length > 0 ? `${items.length} open ${items.length === 1 ? 'item' : 'items'}` : undefined}
        actions={
          <LinkButton to="/alerts" variant="ghost" size="sm">
            View all
          </LinkButton>
        }
      />
      {shown.length === 0 ? (
        <Panel.Body>
          <EmptyState
            size="sm"
            icon={<CheckCircle2 />}
            title="Nothing needs you"
            description="No open alerts and every robot is healthy."
          />
        </Panel.Body>
      ) : (
        <ul className="flex flex-col">
          {shown.map((item) => (
            <li key={item.key} className="border-t border-line-subtle first:border-t-0">
              <button
                type="button"
                onClick={() => navigate(item.to)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-ink-primary/[0.035] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {item.tag}
                    {item.icon && <span className="text-ink-tertiary">{item.icon}</span>}
                  </div>
                  <div className="mt-1 truncate text-sm text-ink-primary">{item.title}</div>
                  <div className="text-[13px] text-ink-tertiary">{item.meta}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </li>
          ))}
          {more > 0 && (
            <li className="border-t border-line-subtle px-5 py-2.5 text-[13px] text-ink-tertiary">
              and {more} more
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}
