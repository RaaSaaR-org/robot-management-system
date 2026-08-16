/**
 * @file KnowledgePanel.tsx
 * @description The right rail: one card holding everything the robot knows —
 *              what it can see right now (Scene), the map it has built of the
 *              room and who else is in it (Map, TASK-206/207), and what it
 *              still knows after a restart (Memory) — behind one segmented
 *              control.
 * @feature agentmode
 */

import { memo, useEffect, useState } from 'react';
import { cn } from '@/shared/utils';
import { SegmentedControl } from '@/shared/components/ui';
import {
  useAgentModeStore,
  selectMemory,
  selectSceneEntities,
  selectSelf,
} from '../store/agentmodeStore';
import { ScenePanel } from './ScenePanel';
import { MemoryPanel, memoryEntryCount, memoryNeedsAttention } from './MemoryPanel';
import { RobotMapPanel } from './RobotMapPanel';

export interface KnowledgePanelProps {
  /**
   * Height (and anything else) for the card. The page matches it to the
   * conversation's height so the two columns end on the same line; nothing here
   * hardcodes a height, because the number that decides it is the page header's.
   */
  className?: string;
  /** The robot whose map the Map tab reads; null = none bound. */
  robotId?: string | null;
  /** Which tab opens first (`?tab=map` from the fleet page's "open robot's map"). */
  initialTab?: KnowledgeTab;
}

export type KnowledgeTab = 'scene' | 'map' | 'memory';

/**
 * Why the dot has to exist.
 *
 * Stacking the scene and the memory into one tabbed card is the whole point of
 * this rail — two cards' worth of chrome for two short lists was the bulk of
 * the page's clutter. But a tab HIDES things, and two of the things behind the
 * Memory tab are compliance answers an operator must not have to go looking
 * for: a retention rule nobody chose (`fallback`) and a legal hold. The dot is
 * what lets them reach through a closed tab. It is conditional by construction
 * — see `memoryNeedsAttention` — so a calm robot still leaves this page with no
 * colour on it, which is the page-level rule amber depends on to mean anything.
 */
function AttentionDot() {
  return (
    <>
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
      />
      {/* The dot is not a shape a screen reader can read, so the reason is
          spelled out instead of being lost with the colour. */}
      <span className="sr-only"> — needs attention</span>
    </>
  );
}

/** What the amber dot is pointing at, said in words on hover. */
const ATTENTION_HINT =
  'The durable memory needs a look: the retention rule came from a hardcoded fallback, a legal hold is in force, or the byte budget is nearly spent.';

/**
 * What the robot knows, as one card.
 *
 * Scene is the default tab: "what is around me right now" is what an operator
 * about to send a walk block is reading. Memory is the slower answer and stays
 * one click away — with the amber dot above as the exception that pulls it back
 * into view when it stops being background information.
 *
 * Both bodies stay mounted-on-demand rather than clamped, unlike the safety
 * notices on this page: a tab is a navigation choice the operator makes and can
 * undo, not a disclosure hiding the reason a robot will not move.
 */
export const KnowledgePanel = memo(function KnowledgePanel({
  className,
  robotId = null,
  initialTab = 'scene',
}: KnowledgePanelProps) {
  const [tab, setTab] = useState<KnowledgeTab>(initialTab);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const entities = useAgentModeStore(selectSceneEntities);
  const digest = useAgentModeStore(selectMemory);
  const self = useAgentModeStore(selectSelf);
  const robotMap = useAgentModeStore((s) => s.robotMap);

  const entries = memoryEntryCount(digest, self);
  const needsAttention = memoryNeedsAttention(digest);

  const count =
    tab === 'scene'
      ? `${entities.length} ${entities.length === 1 ? 'entity' : 'entities'}`
      : tab === 'map'
        ? robotMap
          ? `${robotMap.peers.length} ${robotMap.peers.length === 1 ? 'peer' : 'peers'}`
          : '—'
        : entries === null
          ? '—'
          : `${entries} ${entries === 1 ? 'entry' : 'entries'}`;

  return (
    <div className={cn('glass-card flex flex-col overflow-hidden min-w-0', className)}>
      <div className="shrink-0 flex items-center gap-2 px-2 py-2 border-b border-glass-subtle">
        <SegmentedControl<KnowledgeTab>
          label="What the robot knows"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'scene', label: 'Scene', title: 'What the robot can see right now' },
            {
              value: 'map',
              label: 'Map',
              title: 'The map the robot has built itself, and the other robots it can see',
            },
            {
              value: 'memory',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Memory
                  {needsAttention && <AttentionDot />}
                </span>
              ),
              title: needsAttention
                ? ATTENTION_HINT
                : 'What the robot still knows after a restart',
            },
          ]}
        />
        <span className="ml-auto pr-1 card-meta tabular-nums shrink-0">{count}</span>
      </div>

      {/* min-h-0 so the body scrolls inside the card instead of pushing it open;
          the panels themselves own their padding and their scroll container.

          `role="region"` + a name that follows the tab: the pills above are a
          `role="group"` of `aria-pressed` buttons (SegmentedControl, shared), so
          activating one silently swaps the body with nothing announcing that
          anything changed or where the new content went. A named region at
          least gives the switch a destination a screen reader can find and
          announce. The full fix — `role="tab"`/`tabpanel` and `aria-controls` —
          belongs in SegmentedControl, which every feature shares. */}
      <div
        role="region"
        aria-label={tab === 'scene' ? 'Scene' : tab === 'map' ? 'Map' : 'Memory'}
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {/* The map panel polls only while mounted, so an unselected tab costs
            the robot nothing. */}
        {tab === 'scene' ? (
          <ScenePanel />
        ) : tab === 'map' ? (
          <RobotMapPanel robotId={robotId} />
        ) : (
          <MemoryPanel headerless />
        )}
      </div>
    </div>
  );
});
