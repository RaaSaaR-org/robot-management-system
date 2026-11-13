/**
 * @file AwaitingAgentState.tsx
 * @description What a tab shows for an expected robot (TASK-485): it has no
 *              agent, so there is nothing to drive, chat with or command yet.
 *              One calm sentence instead of controls that cannot work.
 * @feature robots
 */

import type { ReactNode } from 'react';
import { PackageOpen, Unplug } from 'lucide-react';
import { EmptyState, Panel } from '@/shared/components/ui';
import type { RobotProvisioning } from '../../types/robots.types';

export interface AwaitingAgentStateProps {
  robotName: string;
  provisioning: RobotProvisioning;
  /** How the sentence starts: "Keyboard and VR teleop open", "Chat opens". */
  lead: string;
  /** Panel title, when the state stands in for a whole panel. */
  title?: string;
  icon?: ReactNode;
  'data-testid'?: string;
  className?: string;
}

/** "Not connected yet" / "Not arrived yet" — the title over the sentence below. */
export function awaitingAgentTitle(provisioning: RobotProvisioning): string {
  return provisioning.state === 'arriving' ? 'Not arrived yet' : 'Not connected yet';
}

/** "{lead} when {name}'s robot agent connects to this server." — or once it has arrived. */
export function awaitingAgentSentence(
  robotName: string,
  provisioning: RobotProvisioning,
  lead: string,
): string {
  return provisioning.state === 'arriving'
    ? `${lead} once ${robotName} has arrived and its robot agent has connected.`
    : `${lead} when ${robotName}'s robot agent connects to this server.`;
}

export function AwaitingAgentState({
  robotName,
  provisioning,
  lead,
  title,
  icon,
  'data-testid': testId = 'awaiting-agent',
  className,
}: AwaitingAgentStateProps) {
  return (
    <Panel className={className} data-testid={testId}>
      {title && <Panel.Header title={title} />}
      <Panel.Body>
        <EmptyState
          size="sm"
          icon={icon ?? (provisioning.state === 'arriving' ? <PackageOpen /> : <Unplug />)}
          title={awaitingAgentTitle(provisioning)}
          description={awaitingAgentSentence(robotName, provisioning, lead)}
        />
      </Panel.Body>
    </Panel>
  );
}
