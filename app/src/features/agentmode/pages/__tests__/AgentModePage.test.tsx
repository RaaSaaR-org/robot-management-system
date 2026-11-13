/**
 * @file AgentModePage.test.tsx
 * @description TASK-485: Agent Mode opens on a robot that is online, never
 *   tags a robot without a connected agent "Live", asks the agent endpoints
 *   nothing for a robot that has no agent, and says so when no robot is online.
 * @feature agentmode
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Robot } from '@/features/robots/types/robots.types';

const agent = vi.hoisted(() => {
  const state = {
    selectRobot: vi.fn(),
    fetchState: vi.fn().mockResolvedValue(undefined),
    fetchMemory: vi.fn().mockResolvedValue(undefined),
    estop: vi.fn(),
    resetEstop: vi.fn(),
    clearError: vi.fn(),
    error: null as string | null,
    connectionStatus: 'connected',
    stateUnknown: false,
  };
  return { state, socketRobotIds: [] as Array<string | null> };
});

vi.mock('../../store/agentmodeStore', () => {
  type State = typeof agent.state;
  const useAgentModeStore = Object.assign((selector: (s: State) => unknown) => selector(agent.state), {
    getState: () => agent.state,
  });
  return {
    useAgentModeStore,
    selectError: (s: State) => s.error,
    selectConnectionStatus: (s: State) => s.connectionStatus,
    selectStateUnknown: (s: State) => s.stateUnknown,
  };
});
vi.mock('../../hooks/useAgentModeSocket', () => ({
  useAgentModeSocket: (robotId: string | null) => {
    agent.socketRobotIds.push(robotId);
    return { isConnected: true, error: null, retry: vi.fn() };
  },
}));

const { bound } = vi.hoisted(() => ({
  bound: (testId: string) =>
    function Stub({ robotId, composerLeading }: { robotId?: string | null; composerLeading?: React.ReactNode }) {
      // The chat hosts the voice bar in its composer; render it so its binding is visible too.
      return (
        <div data-testid={testId} data-robot={robotId ?? ''}>
          {composerLeading}
        </div>
      );
    },
}));
vi.mock('../../components/AgentChat', () => ({ AgentChat: bound('chat') }));
vi.mock('../../components/AgentModeToggle', () => ({ AgentModeToggle: bound('toggle') }));
vi.mock('../../components/AgentVoiceBar', () => ({ AgentVoiceBar: bound('voice') }));
vi.mock('../../components/KnowledgePanel', () => ({ KnowledgePanel: bound('knowledge') }));
vi.mock('../../components/SelfHeader', () => ({ SelfHeader: bound('self') }));
vi.mock('../../components/PlaceChip', () => ({ PlaceChip: () => null }));
vi.mock('../../components/TourStopChip', () => ({ TourStopChip: () => null }));
vi.mock('../../components/ConditionAnnouncer', () => ({ ConditionAnnouncer: () => null }));
vi.mock('../../components/EstopBanner', () => ({ EstopBanner: () => null }));
vi.mock('../../components/BlockTimeline', () => ({
  BlockTimeline: ({ disabled, leading }: { disabled?: boolean; leading?: React.ReactNode }) => (
    <div>
      {leading}
      <button type="button" data-testid="agent-stop-button" disabled={disabled}>
        Emergency stop
      </button>
    </div>
  ),
}));

import { AgentModePage, pickAgentRobot } from '../AgentModePage';
import { useRobotsStore } from '@/features/robots/store/robotsStore';

function makeRobot(overrides: Partial<Robot>): Robot {
  return {
    id: 'r',
    name: 'Robot',
    model: 'Model',
    status: 'online',
    batteryLevel: 80,
    location: { x: 0, y: 0 },
    lastSeen: '2026-11-13T00:00:00.000Z',
    capabilities: [],
    metadata: {},
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
    ...overrides,
  };
}

// The fleet of the demo instance, in the order the server lists it: the
// expected G1 comes first and is a G1 — exactly what the old default picked.
const expectedG1 = makeRobot({
  id: 'demo-g1-dex3',
  name: 'Unitree G1 with Dex3 hands',
  model: 'Unitree G1 EDU (Dex3-1)',
  status: 'offline',
  batteryLevel: null,
  metadata: { provisioning: 'awaiting_agent' },
});
const arrivingDuck = makeRobot({
  id: 'demo-microduck',
  name: 'MicroDuck',
  model: 'Pollen Robotics Microduck',
  status: 'offline',
  batteryLevel: null,
  metadata: { provisioning: 'arriving' },
});
const sim = makeRobot({ id: 'sim-robot-001', name: 'Sim robot', model: 'Simulated H1' });
const liveG1 = makeRobot({ id: 'g1-live', name: 'G1 live', model: 'Unitree G1 EDU' });
const offlineG1 = makeRobot({ id: 'g1-off', name: 'G1 off', model: 'Unitree G1', status: 'offline' });

function open(robots: Robot[], url = '/agent') {
  useRobotsStore.setState({ robots, hasFetched: true, fetchRobots: vi.fn().mockResolvedValue(undefined) });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AgentModePage />
    </MemoryRouter>,
  );
}

const select = () => screen.getByTestId('agent-robot-select') as HTMLSelectElement;
const boundRobot = () => screen.getByTestId('chat').getAttribute('data-robot');

beforeEach(() => {
  vi.clearAllMocks();
  agent.socketRobotIds = [];
  agent.state.connectionStatus = 'connected';
});

describe('pickAgentRobot', () => {
  it('takes an online robot, a G1 first, and never one that is not connected', () => {
    expect(pickAgentRobot([expectedG1, sim], null)?.id).toBe('sim-robot-001');
    expect(pickAgentRobot([expectedG1, sim, liveG1], null)?.id).toBe('g1-live');
    expect(pickAgentRobot([offlineG1, sim], null)?.id).toBe('sim-robot-001');
    expect(pickAgentRobot([expectedG1, offlineG1, arrivingDuck], null)).toBeNull();
    expect(pickAgentRobot([], null)).toBeNull();
  });

  it('honours the robot the URL asked for, whatever its state', () => {
    expect(pickAgentRobot([expectedG1, sim], 'demo-g1-dex3')?.id).toBe('demo-g1-dex3');
    expect(pickAgentRobot([expectedG1, sim], 'gone')?.id).toBe('sim-robot-001');
  });
});

describe('AgentModePage', () => {
  it('opens on the online robot, not on the expected G1 listed before it', () => {
    open([expectedG1, arrivingDuck, sim]);
    expect(select().value).toBe('sim-robot-001');
    expect(boundRobot()).toBe('sim-robot-001');
    expect(agent.state.fetchState).toHaveBeenCalledWith('sim-robot-001');
    expect(agent.state.fetchState).not.toHaveBeenCalledWith('demo-g1-dex3');
    expect(screen.getByTestId('agent-connection-status')).toHaveTextContent('Live');
  });

  it('says in the picker which robots are not connected', () => {
    open([expectedG1, arrivingDuck, sim, offlineG1]);
    const labels = Array.from(select().options).map((o) => o.textContent);
    expect(labels).toEqual([
      'Unitree G1 with Dex3 hands · Unitree G1 EDU (Dex3-1) · Not connected',
      'MicroDuck · Pollen Robotics Microduck · Arriving',
      'Sim robot · Simulated H1',
      'G1 off · Unitree G1 · Offline',
    ]);
  });

  it('binds nothing and calls no agent endpoint when an expected robot is picked', () => {
    open([expectedG1, sim]);
    vi.clearAllMocks();
    fireEvent.change(select(), { target: { value: 'demo-g1-dex3' } });

    expect(select().value).toBe('demo-g1-dex3');
    // Every child is idle on "no robot": no state, voice, memory or toggle request can leave.
    for (const id of ['chat', 'toggle', 'voice', 'knowledge', 'self']) {
      expect(screen.getByTestId(id)).toHaveAttribute('data-robot', '');
    }
    expect(agent.state.fetchState).not.toHaveBeenCalled();
    expect(agent.state.fetchMemory).not.toHaveBeenCalled();
    expect(agent.socketRobotIds[agent.socketRobotIds.length - 1]).toBeNull();
    // The previous robot's plan is dropped rather than shown under another name.
    expect(agent.state.selectRobot).toHaveBeenLastCalledWith(null);

    const status = screen.getByTestId('agent-connection-status');
    expect(status).toHaveTextContent('No robot connected');
    expect(status).not.toHaveTextContent('Live');
    expect(screen.getByTestId('agent-robot-not-connected')).toHaveTextContent(
      'Unitree G1 with Dex3 hands has not connected yet.',
    );
    expect(screen.getByTestId('agent-stop-button')).toBeDisabled();
  });

  it('never tags a robot whose agent is offline "Live", even with the event stream up', () => {
    open([offlineG1], '/agent?robot=g1-off');
    expect(boundRobot()).toBe('g1-off');
    const status = screen.getByTestId('agent-connection-status');
    expect(status).toHaveTextContent('Robot offline');
    expect(status).not.toHaveTextContent('Live');
    // A robot with an agent can still be sent a stop.
    expect(screen.getByTestId('agent-stop-button')).toBeEnabled();
  });

  it('says that no robot is online instead of binding one that is not', () => {
    open([expectedG1, arrivingDuck]);
    expect(select().value).toBe('');
    expect(select().options[0].textContent).toBe('No robot online');
    expect(boundRobot()).toBe('');
    expect(agent.state.fetchState).not.toHaveBeenCalled();
    expect(screen.getByTestId('agent-no-robot-online')).toHaveTextContent('No robot is online.');
    expect(screen.getByTestId('agent-connection-status')).toHaveTextContent('No robot connected');
    expect(screen.getByTestId('agent-stop-button')).toBeDisabled();
  });

  it('binds the first robot that comes online', () => {
    open([expectedG1]);
    expect(boundRobot()).toBe('');
    fireEvent.change(select(), { target: { value: '' } });
    // The fleet list reports the sim agent connecting.
    useRobotsStore.setState({ robots: [expectedG1, sim] });
    return screen.findByTestId('chat').then(() => {
      expect(boundRobot()).toBe('sim-robot-001');
      expect(screen.queryByTestId('agent-no-robot-online')).toBeNull();
    });
  });

  it('never unbinds on the way to binding an online robot, so a return visit keeps its conversation', () => {
    open([expectedG1, sim]);
    expect(agent.state.selectRobot).toHaveBeenCalledWith('sim-robot-001');
    expect(agent.state.selectRobot).not.toHaveBeenCalledWith(null);
  });

  it('drops the last robot’s view once it is settled that no robot can be bound', () => {
    open([expectedG1, offlineG1]);
    expect(agent.state.selectRobot).toHaveBeenCalledWith(null);
  });

  it('shows no notice while a connected robot is bound', () => {
    open([sim]);
    expect(screen.queryByTestId('agent-no-robot-online')).toBeNull();
    expect(screen.queryByTestId('agent-robot-not-connected')).toBeNull();
  });
});
