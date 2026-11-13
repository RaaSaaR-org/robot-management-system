/**
 * @file ChatTab.tsx
 * @description Chat tab: the robot's A2A conversation in one full-height Panel,
 *              with the connection state in the panel header.
 * @feature robots
 */

import { useCallback, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { Panel } from '@/shared/components/ui';
import { robotProvisioning } from '../../types/robots.types';
import { AwaitingAgentState } from '../common';
import { RobotChatPanel } from '../RobotChatPanel';
import type { ChatTabProps } from './types';

/** Scroll offsets of every scrollable ancestor, so a focus jump can be undone. */
function scrollOffsets(el: HTMLElement): Array<[Element, number]> {
  const out: Array<[Element, number]> = [];
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight) out.push([node, node.scrollTop]);
  }
  const root = document.scrollingElement;
  if (root) out.push([root, root.scrollTop]);
  return out;
}

export function ChatTab({ robot }: ChatTabProps) {
  const saved = useRef<Array<[Element, number]> | null>(null);

  // The conversation focuses its input on open, which would scroll the page past
  // the header and tabs. Undo that jump on the first focus only.
  const setRef = useCallback((el: HTMLDivElement | null) => {
    if (el && !saved.current) saved.current = scrollOffsets(el);
  }, []);
  const restoreOnce = useCallback(() => {
    const offsets = saved.current;
    if (!offsets?.length) return;
    saved.current = [];
    for (const [node, top] of offsets) node.scrollTop = top;
  }, []);

  // No agent, nobody to talk to — and no conversation to create (TASK-485).
  const provisioning = robotProvisioning(robot);
  if (provisioning) {
    return (
      <AwaitingAgentState
        robotName={robot.name}
        provisioning={provisioning}
        title={`Chat with ${robot.name}`}
        lead="Chat opens"
        icon={<MessageSquare />}
        data-testid="chat-awaiting-agent"
      />
    );
  }

  return (
    <div ref={setRef} onFocusCapture={restoreOnce}>
      <Panel padding="none" className="flex h-[560px] flex-col" aria-label={`Chat with ${robot.name}`}>
        <RobotChatPanel
          robotId={robot.id}
          robotName={robot.name}
          agentUrl={robot.a2aAgentUrl}
          className="min-h-0 flex-1"
        />
      </Panel>
    </div>
  );
}
