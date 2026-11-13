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
import { useEffect, useState } from 'react';
import { robotProvisioning, type RobotTypeLink } from '../../types/robots.types';
import { robotsApi } from '../../api/robotsApi';
import { SiteSelect } from './SiteSelect';
import { SiteAlignment } from './SiteAlignment';

const METADATA_LABELS: Record<string, string> = {
  // The embodiment key that picks the 3D model — not the robot type (the
  // dataset configuration), which Identity shows with its widths (TASK-485).
  robotType: 'Embodiment',
  robotClass: 'Class',
  class: 'Class',
  payload: 'Payload',
  maxPayloadKg: 'Payload (kg)',
  powerSource: 'Power source',
  description: 'Description',
  seededBy: 'Added by',
  degreesOfFreedom: 'Degrees of freedom',
  isSimulated: 'Simulated',
  hardwareConnected: 'Hardware connected',
  footprintRadiusM: 'Footprint radius (m)',
};

/** The embodiment keys an agent reports, as a person names them. */
const EMBODIMENT_NAMES: Record<string, string> = {
  g1: 'Unitree G1',
  g1_edu: 'Unitree G1 EDU',
  h1: 'Unitree H1',
  so101: 'SO-101',
  generic: 'Generic',
};

/** Shown by the status tag and the banner above, not as raw key/value pairs. */
const HIDDEN_METADATA = new Set(['provisioning', 'provisioningNote', 'robotTypeName', 'robotTypeId']);

/**
 * The robot type this robot is one of, as the server links it (TASK-485):
 * "Microduck · state 15 / action 15". While the answer is out, or when the
 * server cannot tell, the name the robot's own metadata states, else the
 * embodiment its agent reports ("Unitree G1"), else "—".
 *
 * The embodiment is a fallback, not a link (TASK-499): the demo's simulated G1
 * is a plain 29-joint G1 and no robot type describes one — the G1 types are
 * the Dex3-hand configurations — so the server rightly answers none, and the
 * row said "—" about a robot that knows exactly what it is.
 */
function RobotTypeValue({
  robotId,
  stated,
  embodiment,
}: {
  robotId: string;
  stated: string | null;
  embodiment: string | null;
}) {
  const [link, setLink] = useState<RobotTypeLink | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLink(null);
    robotsApi
      .getRobotType(robotId)
      .then((next) => {
        if (!cancelled) setLink(next);
      })
      .catch(() => {
        // An older server, or the demo build: the stated name is all there is.
      });
    return () => {
      cancelled = true;
    };
  }, [robotId]);

  const type = link?.robotType ?? null;
  if (!type) {
    if (stated || !embodiment) return <span data-testid="robot-type-link">{stated ?? '—'}</span>;
    return (
      <span
        data-testid="robot-type-link"
        data-linked-by="embodiment"
        title="The embodiment this robot reports. No robot type with dataset widths is linked to it."
      >
        {embodiment}
      </span>
    );
  }
  return (
    <span data-testid="robot-type-link" data-linked-by={link?.linkedBy ?? undefined}>
      {type.name}
      <span className="text-ink-tertiary">
        {' '}· state {type.proprioceptionDim} / action {type.actionDim}
      </span>
    </span>
  );
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function metadataValue(key: string, value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'robotType' && typeof value === 'string' && EMBODIMENT_NAMES[value.toLowerCase()]) {
    return EMBODIMENT_NAMES[value.toLowerCase()];
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).replace(/_/g, ' ');
  }
  return null; // nested objects are not details a person reads
}

export function InfoTab({ robot }: InfoTabProps) {
  const metadata = Object.entries(robot.metadata ?? {})
    .filter(([key]) => !HIDDEN_METADATA.has(key))
    .map(([key, value]) => ({ key, label: METADATA_LABELS[key] ?? humanizeKey(key), value: metadataValue(key, value) }))
    .filter((item): item is { key: string; label: string; value: string } => item.value !== null);
  const hasAgent = Boolean(robot.a2aEnabled || robot.a2aAgentUrl || robot.capabilities.includes('a2a'));
  const provisioning = robotProvisioning(robot);
  const statedType = robot.metadata?.robotTypeName;
  const embodimentKey = robot.metadata?.robotType;
  const embodiment = typeof embodimentKey === 'string' ? EMBODIMENT_NAMES[embodimentKey.toLowerCase()] ?? null : null;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Panel>
        <Panel.Header title="Identity" />
        <Panel.Body>
          <KeyValueList
            items={[
              { label: 'Robot ID', value: robot.id, mono: true },
              { label: 'Model', value: robot.model },
              {
                label: 'Robot type',
                value: (
                  <RobotTypeValue
                    robotId={robot.id}
                    stated={typeof statedType === 'string' && statedType.trim() ? statedType : null}
                    embodiment={embodiment}
                  />
                ),
              },
              { label: 'Serial number', value: robot.serialNumber, mono: true },
              { label: 'Firmware', value: robot.firmware },
              { label: 'IP address', value: robot.ipAddress, mono: true },
              { label: 'Site', value: <SiteSelect robotId={robot.id} twinId={robot.twinId} /> },
              ...(robot.twinId
                ? [
                    {
                      label: 'Alignment',
                      value: <SiteAlignment robotId={robot.id} twinId={robot.twinId} location={robot.location} />,
                    },
                  ]
                : []),
              // A robot that never connected has reported no place to be unknown about.
              { label: 'Place', value: robot.location?.place ?? (provisioning ? null : 'Place unknown') },
              {
                // An expected robot was put on the fleet; no agent has registered it.
                label: provisioning ? 'Added' : 'Registered',
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
