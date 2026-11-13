/**
 * @file AgentModePage.tsx
 * @description Agent Mode cockpit — one status rail, the condition stack, the
 *              conversation, and one panel holding everything the robot knows.
 * @feature agentmode
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RotateCw, WifiOff } from 'lucide-react';
import { Button, PageHeader, Panel, Select, StatusTag } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { RobotOfflineBanner } from '@/features/robots/components/RobotOfflineBanner';
import {
  ROBOT_PROVISIONING_LABELS,
  robotProvisioning,
  type Robot,
} from '@/features/robots/types/robots.types';
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

/** Its agent is connected right now. */
function isOnline(robot: Pick<Robot, 'status'>): boolean {
  return robot.status !== 'offline';
}

/**
 * The robot the page opens on (TASK-485): the one the URL asked for, else a
 * robot that is online — a G1 first. Never a robot that is not connected: the
 * page used to bind the first G1 on the list, which on a fleet with an
 * expected G1 ahead of the running one meant a dead console by default.
 */
export function pickAgentRobot(robots: readonly Robot[], requestedId: string | null): Robot | null {
  const requested = requestedId ? robots.find((r) => r.id === requestedId) : undefined;
  if (requested) return requested;
  const online = robots.filter(isOnline);
  return online.find((r) => isG1(r.model, r.metadata?.embodiment)) ?? online[0] ?? null;
}

/** "Name · model", plus why it cannot be talked to when it is not connected. */
function robotOptionLabel(robot: Robot): string {
  const provisioning = robotProvisioning(robot);
  const state = provisioning
    ? ROBOT_PROVISIONING_LABELS[provisioning.state]
    : isOnline(robot)
      ? null
      : 'Offline';
  return [robot.name, robot.model, state].filter(Boolean).join(' · ');
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

  // What the picker shows. `robotId` below is what the page talks to.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const hasFetchedRobots = useRobotsStore((state) => state.hasFetched);
  const selected = selectedId ? (robots.find((r) => r.id === selectedId) ?? null) : null;
  // An expected robot (TASK-477) has no agent: there is no Agent Mode state to
  // read, no voice pipeline, no memory and no event to wait for. The page then
  // binds nothing — every child is idle on a null robot — and says why, where
  // it used to fire five requests that could only answer 404.
  const provisioning = selected ? robotProvisioning(selected) : null;
  const robotId = selected && !provisioning ? selected.id : null;
  const { error: socketError, retry: retrySocket } = useAgentModeSocket(robotId);

  useEffect(() => {
    void robotsActions.fetchRobots();
  }, [robotsActions]);

  // Auto-bind while nothing is picked: the robot the URL asked for, else an
  // online one. With none online the picker stays empty, and the first robot
  // to connect is bound when the fleet list says so.
  useEffect(() => {
    // A pick that left the fleet (unregistered meanwhile) no longer counts.
    if (selectedId && robots.some((r) => r.id === selectedId)) return;
    const preferred = pickAgentRobot(robots, requestedRobot);
    if (preferred && preferred.id !== selectedId) setSelectedId(preferred.id);
  }, [robots, selectedId, requestedRobot]);

  // Settled on "no robot": an expected robot is picked, or the fleet is known
  // and holds nothing the auto-bind above would take. NOT the first render of a
  // return visit, where the pick is one commit away — the store is module-level
  // and keeps the conversation across leaving the page and coming back, and
  // unbinding there would throw it away.
  const nothingToBind = selected
    ? provisioning !== null
    : hasFetchedRobots && pickAgentRobot(robots, requestedRobot) === null;

  useEffect(() => {
    if (!robotId) {
      // The last robot's plan must not stay on screen under "No robot connected".
      if (nothingToBind) agentActions.selectRobot(null);
      return;
    }
    agentActions.selectRobot(robotId);
    void agentActions.fetchState(robotId);
    // Best-effort and independent: an unavailable digest must not turn the
    // page's initial load into an error.
    void agentActions.fetchMemory(robotId);
  }, [robotId, nothingToBind, agentActions]);

  const robotOptions = robots.map((robot) => ({ value: robot.id, label: robotOptionLabel(robot) }));
  const noneOnline = hasFetchedRobots && !selected && !robots.some(isOnline);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Automate"
        title="Agent Mode"
        description="Talk to one robot, watch its plan run block by block, stop it at any time."
        meta={
          <ConnectionMeta
            status={connectionStatus}
            robot={robotId ? selected : null}
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
              value={selected?.id ?? ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
              placeholder={
                selected ? undefined : robots.length === 0 ? 'No robots' : noneOnline ? 'No robot online' : 'Choose a robot'
              }
              options={robotOptions}
            />
            <AgentModeToggle robotId={robotId} />
          </>
        }
      />

      {/* Conditional, like everything coloured or boxed on this page: only while
          there is no connected robot to talk to. */}
      {provisioning && selected ? (
        <div data-testid="agent-robot-not-connected" className="-mt-2">
          <RobotOfflineBanner robotName={selected.name} provisioning={provisioning} />
        </div>
      ) : (
        noneOnline && (
          <Panel
            variant="inset"
            padding="sm"
            role="status"
            data-testid="agent-no-robot-online"
            className="-mt-2 flex items-start gap-3 text-sm text-ink-secondary"
          >
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
            <p className="min-w-0">
              {robots.length === 0
                ? 'No robot is on the fleet yet. Agent Mode needs a robot with a connected agent.'
                : 'No robot is online. Agent Mode talks to a robot through its agent, so there is nothing to bind until one connects.'}
            </p>
          </Panel>
        )
      )}

      {/* Emergency stop stays live when the state is unknown — deliberately. Refusing to
          even try to stop a robot is never the safe default; the store reports
          a stop that does not land as failed/unconfirmed. Only "no robot bound"
          disables it, because then there is nothing to ask. */}
      <BlockTimeline
        onStop={() => robotId && void agentActions.estop(robotId, 'Operator pressed Emergency stop')}
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
  robot,
  gaveUp,
  onRetry,
}: {
  status: string;
  /** The robot the page is bound to; null while it talks to none. */
  robot: Pick<Robot, 'status'> | null;
  gaveUp: boolean;
  onRetry: () => void;
}) {
  // "Live" is a claim about the robot, in the reader's eyes. With no robot
  // bound, or a bound robot whose agent is not connected, an open socket to
  // the server is not it (TASK-485).
  if (!robot || !isOnline(robot)) {
    const label = robot ? 'Robot offline' : 'No robot connected';
    return (
      <span
        data-testid="agent-connection-status"
        data-connection="no-robot"
        title={
          robot
            ? 'The robot’s agent is not connected. Everything on this page is the last thing this console heard.'
            : 'This console is not bound to a robot.'
        }
      >
        <StatusTag tone="neutral" dot>
          {label}
        </StatusTag>
      </span>
    );
  }
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
