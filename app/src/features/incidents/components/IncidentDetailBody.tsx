/**
 * @file IncidentDetailBody.tsx
 * @description The panels of an incident's detail page: what happened, clip,
 *              root cause, risk, notifications; timeline, details, evidence
 * @feature incidents
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { KeyValueList, LinkButton, Panel } from '@/shared/components/ui';
import { UI_DATE_LOCALE, formatDateTime } from '@/shared/utils/format';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { NotificationTimeline } from './NotificationTimeline';
import { IncidentClipPlayer } from './IncidentClipPlayer';
import type { Incident, IncidentNotification } from '../types/incidents.types';
import { INCIDENT_TYPE_LABELS } from '../types/incidents.types';

export interface IncidentDetailBodyProps {
  incident: Incident;
  /** Humanized description */
  summary: string;
  /** Original machine string, or null */
  raw: string | null;
  onMarkSent: (n: IncidentNotification) => void;
  onGenerate: (n: IncidentNotification) => void;
}

function when(iso: string | null): string | null {
  return iso ? formatDateTime(iso) : null;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Two-column body of the incident detail page. */
export function IncidentDetailBody({ incident: i, summary, raw, onMarkSent, onGenerate }: IncidentDetailBodyProps) {
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((state) => state.fetchRobots);
  const robotName = robots.find((r) => r.id === i.robotId)?.name;

  // A hard load of this page has an empty robots store; load it for the name.
  useEffect(() => {
    if (i.robotId && robots.length === 0) void fetchRobots();
  }, [i.robotId, robots.length, fetchRobots]);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
        <Panel>
          <Panel.Header title="What happened" />
          <Panel.Body className="flex flex-col gap-3">
            <p className="max-w-[70ch] whitespace-pre-wrap text-sm text-ink-secondary">{summary || '—'}</p>
            {raw && (
              <details className="group">
                <summary className="cursor-pointer text-[13px] text-ink-tertiary hover:text-ink-primary">Raw event</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-control bg-inset p-3 font-mono text-xs text-ink-secondary">
                  {raw}
                </pre>
              </details>
            )}
          </Panel.Body>
        </Panel>

        {i.clipKey && (
          <Panel>
            <Panel.Header title="Rollout clip" description="Frames the robot captured around the failure." />
            <Panel.Body>
              <IncidentClipPlayer incidentId={i.id} />
            </Panel.Body>
          </Panel>
        )}

        {(i.rootCause || i.resolution) && (
          <Panel>
            <Panel.Header title="Root cause and resolution" />
            <Panel.Body>
              <KeyValueList
                columns={1}
                items={[
                  { label: 'Root cause', value: i.rootCause },
                  { label: 'Resolution', value: i.resolution },
                ]}
              />
            </Panel.Body>
          </Panel>
        )}

        {i.riskScore !== null && (
          <Panel>
            <Panel.Header title="Risk assessment" />
            <Panel.Body>
              <KeyValueList
                items={[
                  { label: 'Risk score', value: `${i.riskScore} / 100` },
                  {
                    label: 'Affected data subjects',
                    value: i.affectedDataSubjects?.toLocaleString(UI_DATE_LOCALE) ?? null,
                  },
                  { label: 'Data categories', value: i.dataCategories.join(', ') || null },
                ]}
              />
            </Panel.Body>
          </Panel>
        )}

        <Panel>
          <Panel.Header title="Notifications" description="What each regulation asks you to report, and by when." />
          <Panel.Body>
            <NotificationTimeline notifications={i.notifications ?? []} onMarkSent={onMarkSent} onGenerateContent={onGenerate} />
          </Panel.Body>
        </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Panel>
          <Panel.Header title="Timeline" />
          <Panel.Body>
            <KeyValueList
              columns={1}
              items={[
                { label: 'Detected', value: when(i.detectedAt) },
                { label: 'Contained', value: when(i.containedAt) },
                { label: 'Resolved', value: when(i.resolvedAt) },
                { label: 'Closed', value: when(i.closedAt) },
              ]}
            />
          </Panel.Body>
        </Panel>

        <Panel>
          <Panel.Header title="Details" />
          <Panel.Body>
            <KeyValueList
              columns={1}
              items={[
                { label: 'Number', value: <span className="tabular-nums">{i.incidentNumber}</span> },
                { label: 'Type', value: INCIDENT_TYPE_LABELS[i.type] },
                {
                  label: 'Robot',
                  value: i.robotId ? (
                    <Link to={`/robots/${i.robotId}`} className="text-primary hover:underline">
                      {robotName ?? i.robotId}
                    </Link>
                  ) : null,
                },
                { label: 'Created by', value: i.createdBy },
                { label: 'Last updated', value: when(i.updatedAt) },
              ]}
            />
          </Panel.Body>
        </Panel>

        <Panel>
          <Panel.Header
            title="Linked evidence"
            actions={
              i.complianceLogIds.length > 0 ? (
                <LinkButton to="/compliance" variant="ghost" size="sm">
                  Open audit log
                </LinkButton>
              ) : undefined
            }
          />
          <Panel.Body>
            <KeyValueList
              columns={1}
              items={[
                { label: 'Compliance logs', value: plural(i.complianceLogIds.length, 'log') },
                { label: 'Alerts', value: plural(i.alertIds.length, 'alert') },
              ]}
            />
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
