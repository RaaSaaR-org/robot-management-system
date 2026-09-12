/**
 * @file AgentModePage.tsx
 * @description Agent Mode cockpit — one status rail, the condition stack, the
 *              conversation, and one panel holding everything the robot knows.
 * @feature agentmode
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import { Button, PageHeader, Select, StatusTag } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { AgentChat } from '../components/AgentChat';
import { AgentModeToggle } from '../components/AgentModeToggle';
import { AgentVoiceBar } from '../components/AgentVoiceBar';
import { BlockTimeline } from '../components/BlockTimeline';
import { ConditionAnnouncer } from '../components/ConditionAnnouncer';
import { EstopBanner } from '../components/EstopBanner';
import { KnowledgePanel, type KnowledgeTab } from '../components/KnowledgePanel';
import { PlaceChip } from '../components/PlaceChip';
import { SelfHeader } from '../components/SelfHeader';
import { TourStopChip } from '../components/TourStopChip';
import { useAgentModeSocket } from '../hooks/useAgentModeSocket';
import {
  useAgentModeStore,
  selectError,
  selectConnectionStatus,
  selectStateUnknown,
} from '../store/agentmodeStore';

/**
 * Height of the two workspace columns on ≥lg — the conversation and the
 * knowledge panel end on the same line and the page fits one viewport.
 *
 * 300px is the chrome around them: the 56px top bar, the shell's 24px top and
 * bottom padding, the PageHeader (eyebrow, title, description ≈ 100px), the
 * 44px status rail and the two 24px gaps, plus slack for a wrapped header.
 * The clamp floor (420px) wins on short screens and the columns scroll
 * internally; the ceiling keeps a 4K display readable. The condition stack is
 * deliberately NOT in the budget: it is empty whenever the robot is calm.
 *
 * Below lg there are no fixed heights: the chat takes most of a screen, the
 * knowledge panel follows it.
 */
const CHAT_HEIGHT = 'min-h-[60vh] lg:min-h-0 lg:h-[clamp(420px,calc(100vh-300px),820px)]';
const KNOWLEDGE_HEIGHT = 'h-[480px] lg:h-[clamp(420px,calc(100vh-300px),820px)]';

const KNOWLEDGE_TABS: readonly KnowledgeTab[] = ['scene', 'map', 'memory'];

/** Prefer a G1 humanoid: Agent Mode's target embodiment. */
function isG1(model: string | null | undefined, embodiment: unknown): boolean {
  const haystack = `${model ?? ''} ${typeof embodiment === 'string' ? embodiment : ''}`;
  return /g1/i.test(haystack);
}

export function AgentModePage() {
  const robotsActions = useMemo(() => {
    const store = useRobotsStore.getState();
    return { fetchRobots: store.fetchRobots };
  }, []);

  const agentActions = useMemo(() => {
    const store = useAgentModeStore.getState();
    return {
      selectRobot: store.selectRobot,
      fetchState: store.fetchState,
      fetchMemory: store.fetchMemory,
      estop: store.estop,
      resetEstop: store.resetEstop,
      clearError: store.clearError,
    };
  }, []);

  const robots = useRobotsStore(selectRobots);
  const error = useAgentModeStore(selectError);
  const connectionStatus = useAgentModeStore(selectConnectionStatus);
  const stateUnknown = useAgentModeStore(selectStateUnknown);

  // `/agent?robot=<id>&tab=map` — the fleet page's "open robot's map" lands
  // here (TASK-207). `robot` seeds the selection; `tab` IS the knowledge tab
  // (default scene carries no param), so reload, back and deep links agree.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRobot = searchParams.get('robot');
  const rawTab = searchParams.get('tab');
  const tab: KnowledgeTab = KNOWLEDGE_TABS.includes(rawTab as KnowledgeTab)
    ? (rawTab as KnowledgeTab)
    : 'scene';
  const setTab = (next: KnowledgeTab) =>
    setSearchParams(
      (params) => {
        if (next === 'scene') params.delete('tab');
        else params.set('tab', next);
        return params;
      },
      { replace: true }
    );

  const [robotId, setRobotId] = useState<string | null>(null);
  const { error: socketError, retry: retrySocket } = useAgentModeSocket(robotId);

  useEffect(() => {
    void robotsActions.fetchRobots();
  }, [robotsActions]);

  // Auto-bind: the robot the URL asked for, else a G1, else the first one.
  useEffect(() => {
    if (robotId || robots.length === 0) return;
    const preferred =
      (requestedRobot ? robots.find((r) => r.id === requestedRobot) : undefined) ??
      robots.find((r) => isG1(r.model, r.metadata?.embodiment)) ??
      robots[0];
    setRobotId(preferred.id);
  }, [robots, robotId, requestedRobot]);

  useEffect(() => {
    if (!robotId) return;
    agentActions.selectRobot(robotId);
    void agentActions.fetchState(robotId);
    // Best-effort and independent: an unavailable digest must not turn the
    // page's initial load into an error.
    void agentActions.fetchMemory(robotId);
  }, [robotId, agentActions]);

  const robotOptions = robots.map((robot) => ({
    value: robot.id,
    label: `${robot.name} · ${robot.model}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Automate"
        title="Agent Mode"
        description="Talk to one robot, watch its plan run block by block, stop it at any time."
        meta={
          <ConnectionMeta
            status={connectionStatus}
            gaveUp={Boolean(socketError)}
            onRetry={retrySocket}
          />
        }
        actions={
          <>
            <Select
              aria-label="Robot"
              data-testid="agent-robot-select"
              id="agent-robot-select"
              fullWidth={false}
              className="w-64 max-w-full"
              value={robotId ?? ''}
              onChange={(e) => setRobotId(e.target.value || null)}
              options={
                robotOptions.length > 0 ? robotOptions : [{ value: '', label: 'No robots' }]
              }
            />
            <AgentModeToggle robotId={robotId} />
          </>
        }
      />

      {/* STOPP stays live when the state is unknown — deliberately. Refusing to
          even try to stop a robot is never the safe default; the store reports
          a stop that does not land as failed/unconfirmed. Only "no robot bound"
          disables it, because then there is nothing to ask. */}
      <BlockTimeline
        onStop={() => robotId && void agentActions.estop(robotId, 'Operator pressed STOPP')}
        disabled={!robotId}
        leading={
          <>
            <SelfHeader robotId={robotId} className="min-w-0" />
            <PlaceChip />
            <TourStopChip />
          </>
        }
      />

      {/* Two sr-only live regions: cost the layout nothing. */}
      <ConditionAnnouncer />

      {/* The condition stack. Renders nothing when nothing is wrong. */}
      <EstopBanner
        onReset={() => robotId && void agentActions.resetEstop(robotId)}
        error={error}
        onDismissError={agentActions.clearError}
        className="-mt-2 scroll-mt-28"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <AgentChat
          robotId={robotId}
          stateUnknown={stateUnknown}
          composerLeading={<AgentVoiceBar robotId={robotId} variant="inline" />}
          className={CHAT_HEIGHT}
        />
        <KnowledgePanel
          robotId={robotId}
          tab={tab}
          onTabChange={setTab}
          className={cn(KNOWLEDGE_HEIGHT, 'min-w-0')}
        />
      </div>
    </div>
  );
}

/**
 * The event-stream state as a StatusTag: Live (pulsing), Connecting, Offline —
 * plus Reconnect once the socket's backoff has given up for good.
 */
function ConnectionMeta({
  status,
  gaveUp,
  onRetry,
}: {
  status: string;
  gaveUp: boolean;
  onRetry: () => void;
}) {
  const connected = status === 'connected';
  const settling = status === 'connecting' || status === 'disconnecting';
  return (
    <span className="inline-flex items-center gap-2">
      <span
        data-testid="agent-connection-status"
        data-connection={status}
        title={
          connected
            ? 'This console is receiving the robot’s events.'
            : settling
              ? 'Connecting to the robot’s event stream.'
              : 'No event stream. Everything on this page is the last thing this console heard.'
        }
      >
        <StatusTag tone={connected ? 'live' : 'neutral'} dot pulse={connected || settling}>
          {connected ? 'Live' : settling ? 'Connecting' : 'Offline'}
        </StatusTag>
      </span>
      {!connected && !settling && gaveUp && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="agent-connection-retry"
          leftIcon={<RotateCw className="h-4 w-4" strokeWidth={1.75} />}
          onClick={onRetry}
        >
          Reconnect
        </Button>
      )}
    </span>
  );
}
