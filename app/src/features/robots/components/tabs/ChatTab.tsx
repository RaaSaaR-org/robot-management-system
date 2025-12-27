/**
 * @file ChatTab.tsx
 * @description Chat tab with robot conversation panel
 * @feature robots
 */

import { RobotChatPanel } from '../RobotChatPanel';
import type { ChatTabProps } from './types';

// ============================================================================
// COMPONENT
// ============================================================================

export function ChatTab({ robot }: ChatTabProps) {
  return (
    <div className="h-[500px]">
      <RobotChatPanel
        robotId={robot.id}
        robotName={robot.name}
        agentUrl={robot.a2aAgentUrl}
      />
    </div>
  );
}
