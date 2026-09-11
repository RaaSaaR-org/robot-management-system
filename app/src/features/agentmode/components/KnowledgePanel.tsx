/**
 * @file KnowledgePanel.tsx
 * @description The right column: one panel holding everything the robot knows —
 *              what it can see right now (Scene), the map it has built of the
 *              room and who else is in it (Map, TASK-206/207), and what it
 *              still knows after a restart (Memory) — behind the kit's tabs.
 * @feature agentmode
 */

import { memo, useState } from 'react';
import { Panel, StatusTag, Tabs } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import {
  useAgentModeStore,
  selectMemory,
  selectSceneEntities,
  selectSelf,
} from '../store/agentmodeStore';
import { ScenePanel } from './ScenePanel';
import { MemoryPanel, memoryEntryCount, memoryNeedsAttention } from './MemoryPanel';
import { RobotMapPanel } from './RobotMapPanel';

export type KnowledgeTab = 'scene' | 'map' | 'memory';

export interface KnowledgePanelProps {
  /** Height (and anything else) for the panel; the page matches the chat's. */
  className?: string;
  /** The robot whose map the Map tab reads; null = none bound. */
  robotId?: string | null;
  /** Controlled tab — the page binds it to `?tab=`. */
  tab?: KnowledgeTab;
  onTabChange?: (tab: KnowledgeTab) => void;
  /** Uncontrolled starting tab, when `tab` is not passed. */
  initialTab?: KnowledgeTab;
}

/** What the attention tag points at, said in words on hover. */
const ATTENTION_HINT =
  'The durable memory needs a look: the retention rule came from a hardcoded fallback, a legal hold is in force, or the byte budget is nearly spent.';

const TAB_LABEL: Record<KnowledgeTab, string> = { scene: 'Scene', map: 'Map', memory: 'Memory' };

/**
 * What the robot knows, as one panel.
 *
 * Scene is the default tab: "what is around me right now" is what an operator
 * about to send a walk block is reading. A tab HIDES things, and two of the
 * things behind Memory are compliance answers (a fallback retention rule, a
 * legal hold) — so when `memoryNeedsAttention` is true a warning tag in the
 * header reaches through the closed tab. A calm robot shows none.
 */
export const KnowledgePanel = memo(function KnowledgePanel({
  className,
  robotId = null,
  tab: controlledTab,
  onTabChange,
  initialTab = 'scene',
}: KnowledgePanelProps) {
  const [ownTab, setOwnTab] = useState<KnowledgeTab>(initialTab);
  const tab = controlledTab ?? ownTab;
  const setTab = (next: string) => {
    const value = next as KnowledgeTab;
    if (controlledTab === undefined) setOwnTab(value);
    onTabChange?.(value);
  };

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
          : null
        : entries === null
          ? null
          : `${entries} ${entries === 1 ? 'entry' : 'entries'}`;

  return (
    <Panel as="section" className={cn('flex min-w-0 flex-col overflow-hidden', className)}>
      <Panel.Header
        title="Knowledge"
        borderless
        actions={
          needsAttention ? (
            <span title={ATTENTION_HINT} data-testid="agent-memory-attention">
              <StatusTag tone="warning">Memory needs attention</StatusTag>
            </span>
          ) : count ? (
            <span className="text-xs tabular-nums text-ink-muted">{count}</span>
          ) : undefined
        }
      />
      <div className="shrink-0 px-5">
        <Tabs
          label="What the robot knows"
          tabs={(['scene', 'map', 'memory'] as const).map((id) => ({ id, label: TAB_LABEL[id] }))}
          activeTab={tab}
          onTabChange={setTab}
        />
      </div>

      {/* A named region whose name follows the tab, so a switch has a
          destination a screen reader can find. The panels own their padding
          and their scroll container; min-h-0 lets them scroll inside. */}
      <div
        role="region"
        aria-label={TAB_LABEL[tab]}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
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
    </Panel>
  );
});
