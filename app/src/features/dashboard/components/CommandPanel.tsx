/**
 * @file CommandPanel.tsx
 * @description Dashboard panel "Command a robot": pick a robot, then tell it
 *   what to do in plain language through the command feature's CommandBar.
 * @feature dashboard
 * @dependencies @/shared/components/ui, @/features/command, @/features/fleet
 */

import { useEffect, useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { EmptyState, LinkButton, Panel, Select, statusTone } from '@/shared/components/ui';
import { CommandBar } from '@/features/command/components/CommandBar';
import type { RobotMapMarker } from '@/features/fleet';

export interface CommandPanelProps {
  /** Robots of the fleet (from useFleetStatus) */
  robots: RobotMapMarker[];
  className?: string;
}

/** First robot that is up (online/busy), else the first robot. */
function defaultRobotId(robots: RobotMapMarker[]): string {
  return (robots.find((r) => statusTone(r.status) === 'success') ?? robots[0])?.robotId ?? '';
}

/** Robot picker + CommandBar. Shows a calm empty state with no robots. */
export function CommandPanel({ robots, className }: CommandPanelProps) {
  const [robotId, setRobotId] = useState(() => defaultRobotId(robots));

  // Keep the choice valid as robots arrive or disappear.
  useEffect(() => {
    if (!robots.some((r) => r.robotId === robotId)) setRobotId(defaultRobotId(robots));
  }, [robots, robotId]);

  const robot = robots.find((r) => r.robotId === robotId);
  const options = useMemo(() => robots.map((r) => ({ value: r.robotId, label: r.name })), [robots]);

  return (
    <Panel className={className}>
      <Panel.Header
        title="Command a robot"
        description={robot ? `Tell ${robot.name} what to do in plain language.` : 'Tell a robot what to do in plain language.'}
        actions={
          robots.length > 0 && (
            <Select
              aria-label="Robot"
              fullWidth={false}
              className="w-44"
              size="sm"
              options={options}
              value={robotId}
              onChange={(e) => setRobotId(e.target.value)}
            />
          )
        }
      />
      <Panel.Body>
        {robot ? (
          <CommandBar key={robot.robotId} robotId={robot.robotId} robotName={robot.name} />
        ) : (
          <EmptyState
            size="sm"
            icon={<Bot />}
            title="No robots connected"
            description="Add a robot, or start its agent, to send it commands."
            action={<LinkButton to="/fleet?tab=list">Add robot</LinkButton>}
          />
        )}
      </Panel.Body>
    </Panel>
  );
}
