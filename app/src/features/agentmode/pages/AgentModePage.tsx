/**
 * @file AgentModePage.tsx
 * @description Agent Mode cockpit — one status rail, the conversation, and one
 *              card holding everything the robot knows.
 * @feature agentmode
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
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
import { useAgentModeSocket } from '../hooks/useAgentModeSocket';
import {
  useAgentModeStore,
  selectError,
  selectConnectionStatus,
  selectStateUnknown,
} from '../store/agentmodeStore';

/**
 * Height of the two workspace columns — the conversation and the knowledge card
 * end on the same line, and the page fits one viewport without scrolling.
 *
 * The 268px is the chrome above and below them, and it is written out so the
 * next person to touch the header can correct it instead of guessing:
 *
 *   56  fixed TopBar (`AppLayout`'s `<main>` carries the matching `pt-14`)
 * + 24  `main`'s `p-6` top padding
 * + 40  the PageHeader row (h1 + the robot select / Agent Mode switch)
 * + 16  this page's `space-y-4` gap above the rail
 * + 44  the status rail (`BlockTimeline`, `h-11`)
 * + 16  this page's `space-y-4` gap below the rail
 * + 24  `main`'s `p-6` bottom padding
 * ----
 *  220  measured chrome
 * + 48  slack: the header's action row wraps to two lines below ~900px, and the
 *       page should not end flush against the bottom of the viewport.
 * ----
 *  268
 *
 * The clamp floor (420px) wins on short screens and the columns scroll
 * internally; the ceiling (820px) keeps a 4K display from rendering a
 * conversation nobody can read the top and bottom of at once. The condition
 * stack is deliberately NOT in the budget — it is 0px whenever the robot is
 * calm, and on the rare page where it is not, losing a little of the
 * conversation to a safety notice is the correct trade.
 */
const PANEL_HEIGHT = 'h-[clamp(420px,calc(100vh-268px),820px)]';

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
  // The robot exists but could not be asked what it is doing. `EstopBanner`
  // carries the explanation that qualifies the page; the composer line inside
  // `AgentChat` qualifies the act of typing a command against it. Nothing
  // around either of them may read as a confident "off / clear".
  const stateUnknown = useAgentModeStore(selectStateUnknown);

  // `/agent?robot=<id>&tab=map` — the fleet page's "open robot's map" lands
  // here (TASK-207). The param seeds the selection; the select still rules.
  const [searchParams] = useSearchParams();
  const requestedRobot = searchParams.get('robot');
  const requestedTab = searchParams.get('tab');
  const initialTab: KnowledgeTab =
    requestedTab === 'map' || requestedTab === 'memory' ? requestedTab : 'scene';

  const [robotId, setRobotId] = useState<string | null>(null);

  useAgentModeSocket(robotId);

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

  const connected = connectionStatus === 'connected';
  // 'connecting' and 'disconnecting' are moments, not conditions. They get the
  // muted dot rather than the amber word: this page reserves colour for things
  // that are true right now, and a socket mid-handshake on page load would
  // otherwise flash a warning at every operator, every time.
  const settling = connectionStatus === 'connecting' || connectionStatus === 'disconnecting';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agent Mode"
        meta={
          connected || settling ? (
            // A 6px dot, no word. The claim "this console is receiving events"
            // does not need a label taking up header room to be legible, but it
            // does need to survive the colour being invisible to the reader —
            // hence the sr-only text and the tooltip.
            <span
              data-testid="agent-connection-status"
              data-connection={connectionStatus}
              title={
                connected
                  ? 'Live — this console is receiving the robot’s events.'
                  : 'Connecting to the robot’s event stream.'
              }
              className="inline-flex items-center"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'inline-block w-1.5 h-1.5 rounded-full',
                  connected ? 'bg-turquoise-500' : 'bg-theme-tertiary animate-pulse'
                )}
              />
              <span className="sr-only">{connected ? 'Live' : 'Connecting'}</span>
            </span>
          ) : (
            // Not receiving events is true right now, and everything below is
            // therefore the last thing this console heard. It gets the word.
            <span
              data-testid="agent-connection-status"
              data-connection={connectionStatus}
              title="No event stream. Everything on this page is the last thing this console heard."
              className="text-xs font-medium text-amber-600 dark:text-amber-400"
            >
              Offline
            </span>
          )
        }
        actions={
          <>
            <label className="sr-only" htmlFor="agent-robot-select">
              Robot
            </label>
            <select
              id="agent-robot-select"
              data-testid="agent-robot-select"
              value={robotId ?? ''}
              onChange={(e) => setRobotId(e.target.value || null)}
              // A native select sizes itself to its LONGEST option, and a flex
              // item defaults to `min-width: auto` — together that is a control
              // which refuses to shrink and pushes the whole document wider
              // than the viewport on a phone. `min-w-0` lets it shrink,
              // `max-w-full` caps it once the action row wraps, and `truncate`
              // ellipsises the selected label instead of clipping it dead.
              className="glass-subtle min-w-0 max-w-full truncate px-3 py-2 text-sm text-theme-primary rounded-brand border border-glass-subtle focus:outline-none focus:ring-2 focus:ring-cobalt-500/40"
            >
              {robots.length === 0 && <option value="">No robots</option>}
              {robots.map((robot) => (
                <option key={robot.id} value={robot.id}>
                  {robot.name} · {robot.model}
                </option>
              ))}
            </select>
            <AgentModeToggle robotId={robotId} />
          </>
        }
      />

      {/* STOPP stays live when the state is unknown — deliberately. Refusing to
          even try to stop a robot is never the safe default, the read that
          failed is not the path the stop takes, and the store reports a stop
          that does not land as `failed`/`unconfirmed` rather than as done. Only
          "no robot bound" disables it, because then there is nothing to ask. */}
      <BlockTimeline
        onStop={() => robotId && void agentActions.estop(robotId, 'Operator pressed STOPP')}
        disabled={!robotId}
        leading={
          <>
            {/* The identity chip owns the details drawer — its name is the
                trigger — so the rail passes it the robot and nothing else. */}
            <SelfHeader robotId={robotId} className="min-w-0" />
            <PlaceChip />
          </>
        }
      />

      {/* Mounted for the lifetime of the page and empty while the robot is
          calm. Two `sr-only` (position: absolute) elements, so they cost the
          layout nothing and the `space-y-4` rhythm above and below is
          unchanged — see the component for why the condition stack's own live
          regions cannot do this job. */}
      <ConditionAnnouncer />

      {/* The condition stack. Renders nothing at all when nothing is wrong, so
          a calm page has no bar here and no colour on it. `scroll-mt-14` is not
          decoration: the rail above is `sticky top-14`, and without the margin
          an anchor or a focus jump would park the first notice underneath it. */}
      <EstopBanner
        onReset={() => robotId && void agentActions.resetEstop(robotId)}
        error={error}
        onDismissError={agentActions.clearError}
        className="scroll-mt-14"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4">
        {/* Voice is an input method, so the mic rides in the composer next to
            the thing it types into — not as a status row of its own. */}
        <AgentChat
          robotId={robotId}
          stateUnknown={stateUnknown}
          composerLeading={<AgentVoiceBar robotId={robotId} variant="inline" />}
          className={PANEL_HEIGHT}
        />
        {/* What the robot knows: what it can see right now, and what it still
            knows after a restart — one card, two tabs. */}
        <KnowledgePanel robotId={robotId} initialTab={initialTab} className={cn(PANEL_HEIGHT, 'min-w-0')} />
      </div>
    </div>
  );
}
