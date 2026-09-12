/**
 * @file InfoTab.tsx
 * @description Details tab of the robot detail page: identity, capabilities,
 *              metadata and the A2A agent, each as a Panel.
 * @feature robots
 */

import { MessageSquare } from 'lucide-react';
import { Badge, KeyValueList, LinkButton, Panel, StatusTag } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils/format';
import type { InfoTabProps } from './types';

const METADATA_LABELS: Record<string, string> = {
  robotType: 'Robot type',
  robotClass: 'Class',
  class: 'Class',
  payload: 'Payload',
  maxPayloadKg: 'Payload (kg)',
  powerSource: 'Power source',
  description: 'Description',
};

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function metadataValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).replace(/_/g, ' ');
  }
  return null; // nested objects are not details a person reads
}

export function InfoTab({ robot }: InfoTabProps) {
  const metadata = Object.entries(robot.metadata ?? {})
    .map(([key, value]) => ({ key, label: METADATA_LABELS[key] ?? humanizeKey(key), value: metadataValue(value) }))
    .filter((item): item is { key: string; label: string; value: string } => item.value !== null);
  const hasAgent = Boolean(robot.a2aEnabled || robot.a2aAgentUrl || robot.capabilities.includes('a2a'));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Panel>
        <Panel.Header title="Identity" />
        <Panel.Body>
          <KeyValueList
            items={[
              { label: 'Robot ID', value: robot.id, mono: true },
              { label: 'Model', value: robot.model },
              { label: 'Serial number', value: robot.serialNumber, mono: true },
              { label: 'Firmware', value: robot.firmware },
              { label: 'IP address', value: robot.ipAddress, mono: true },
              { label: 'Zone', value: robot.location?.zone || 'Place unknown' },
              {
                label: 'Registered',
                value: formatDateTime(robot.createdAt, { year: 'numeric', month: 'short', day: 'numeric' }),
              },
              { label: 'Last updated', value: formatDateTime(robot.updatedAt) },
            ]}
          />
        </Panel.Body>
      </Panel>

      <div className="flex flex-col gap-6">
        <Panel>
          <Panel.Header title="Capabilities" />
          <Panel.Body>
            {robot.capabilities.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {robot.capabilities.map((cap) => (
                  <Badge key={cap} variant="neutral">{cap}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-tertiary">No capabilities reported.</p>
            )}
          </Panel.Body>
        </Panel>

        {hasAgent && (
          <Panel>
            <Panel.Header
              title="A2A agent"
              description={`${robot.name} can talk to other A2A-compatible agents.`}
              actions={
                <StatusTag tone={robot.a2aEnabled ? 'live' : 'neutral'}>
                  {robot.a2aEnabled ? 'Enabled' : 'Available'}
                </StatusTag>
              }
            />
            <Panel.Body className="flex flex-col gap-4">
              <KeyValueList columns={1} items={[{ label: 'Agent URL', value: robot.a2aAgentUrl, mono: true }]} />
              <div className="flex flex-wrap gap-2">
                <LinkButton
                  to={`/a2a?robotId=${robot.id}`}
                  variant="secondary"
                  size="sm"
                  leftIcon={<MessageSquare className="h-4 w-4" strokeWidth={1.75} />}
                >
                  Start A2A conversation
                </LinkButton>
                <LinkButton to="/a2a" variant="ghost" size="sm">
                  View all agents
                </LinkButton>
              </div>
            </Panel.Body>
          </Panel>
        )}
      </div>

      {metadata.length > 0 && (
        <Panel className="xl:col-span-2">
          <Panel.Header title="Metadata" />
          <Panel.Body>
            <KeyValueList columns={3} items={metadata} />
          </Panel.Body>
        </Panel>
      )}
    </div>
  );
}
