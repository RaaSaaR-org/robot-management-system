/**
 * @file AgentModePage.tsx
 * @description Agent Mode cockpit — chat, live block timeline and scene memory
 * @feature agentmode
 */

import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { AgentChat } from '../components/AgentChat';
import { AgentModeToggle } from '../components/AgentModeToggle';
import { AgentVoiceBar } from '../components/AgentVoiceBar';
import { BlockTimeline } from '../components/BlockTimeline';
import { EstopBanner } from '../components/EstopBanner';
import { ScenePanel } from '../components/ScenePanel';
import { useAgentModeSocket } from '../hooks/useAgentModeSocket';
import {
  useAgentModeStore,
  selectError,
  selectConnectionStatus,
} from '../store/agentmodeStore';

/** Panel height — tall enough for a real conversation, capped on big screens. */
const PANEL_HEIGHT = 'h-[clamp(360px,58vh,620px)]';

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
      estop: store.estop,
      resetEstop: store.resetEstop,
      clearError: store.clearError,
    };
  }, []);

  const robots = useRobotsStore(selectRobots);
  const error = useAgentModeStore(selectError);
  const connectionStatus = useAgentModeStore(selectConnectionStatus);

  const [robotId, setRobotId] = useState<string | null>(null);

  useAgentModeSocket(robotId);

  useEffect(() => {
    void robotsActions.fetchRobots();
  }, [robotsActions]);

  // Auto-bind to a G1 as soon as the fleet is known.
  useEffect(() => {
    if (robotId || robots.length === 0) return;
    const preferred =
      robots.find((r) => isG1(r.model, r.metadata?.embodiment)) ?? robots[0];
    setRobotId(preferred.id);
  }, [robots, robotId]);

  useEffect(() => {
    if (!robotId) return;
    agentActions.selectRobot(robotId);
    void agentActions.fetchState(robotId);
  }, [robotId, agentActions]);

  const selectedRobot = robots.find((r) => r.id === robotId) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agent Mode"
        subtitle="A local LLM turns plain language into executable blocks and runs them on the robot."
        meta={
          <span
            data-testid="agent-connection-status"
            className="glass-subtle px-2 py-0.5 rounded-full text-[10px] font-medium text-theme-tertiary inline-flex items-center gap-1.5"
          >
            <span
              className={cn(
                'inline-block w-1.5 h-1.5 rounded-full',
                connectionStatus === 'connected' ? 'bg-turquoise-500' : 'bg-theme-tertiary'
              )}
            />
            {connectionStatus === 'connected' ? 'Live' : 'Offline'}
          </span>
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
              className="glass-subtle px-3 py-2 text-sm text-theme-primary rounded-brand border border-glass-subtle focus:outline-none focus:ring-2 focus:ring-cobalt-500/40"
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

      <EstopBanner onReset={() => robotId && void agentActions.resetEstop(robotId)} />

      <AgentVoiceBar robotId={robotId} />

      {error && (
        <div
          data-testid="agent-error-banner"
          className="glass-card border-red-500/40 px-4 py-2.5 flex items-center gap-3"
        >
          <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
          <button
            type="button"
            onClick={agentActions.clearError}
            aria-label="Dismiss error"
            className="ml-auto card-meta hover:text-theme-primary transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      <BlockTimeline
        onStop={() => robotId && void agentActions.estop(robotId, 'Operator pressed STOPP')}
        disabled={!robotId}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        <AgentChat robotId={robotId} className={PANEL_HEIGHT} />
        <ScenePanel className={PANEL_HEIGHT} />
      </div>

      {selectedRobot && (
        <p className="card-meta">
          Bound to <span className="text-theme-secondary">{selectedRobot.name}</span> (
          {selectedRobot.model}) · plans are ephemeral and never persisted.
        </p>
      )}
    </div>
  );
}
