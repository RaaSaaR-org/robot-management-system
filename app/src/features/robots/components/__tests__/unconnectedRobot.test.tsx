/**
 * @file unconnectedRobot.test.tsx
 * @description TASK-485: every tab and action of the robot page is truthful
 *   for a robot without an agent, and fits what the robot is — a mains-powered
 *   arm is not sent to a dock and has no hands on its readiness list.
 * @feature robots
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Robot, RobotTelemetry } from '../../types/robots.types';
import type { RobotReadiness } from '../../api/readinessApi';

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'demo-g1-dex3',
    name: 'Unitree G1 with Dex3 hands',
    model: 'Unitree G1 EDU (Dex3-1)',
    status: 'offline',
    batteryLevel: null,
    location: { x: 0, y: 0 },
    lastSeen: new Date(Date.now() - 15 * 60_000).toISOString(),
    capabilities: [],
    metadata: { robotType: 'g1_edu', provisioning: 'awaiting_agent', seededBy: 'demo-fleet' },
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
    ...overrides,
  };
}

const expectedG1 = makeRobot();
const expectedArm = makeRobot({
  id: 'demo-so101',
  name: 'SO-101',
  model: 'SO-101 Follower',
  metadata: { robotType: 'so101', powerSource: 'ac_powered', provisioning: 'awaiting_agent', robotTypeName: 'SO-101 Follower' },
});
const arrivingDuck = makeRobot({
  id: 'demo-microduck',
  name: 'MicroDuck',
  model: 'Pollen Robotics Microduck',
  metadata: { provisioning: 'arriving', robotTypeName: 'Microduck' },
});
const onlineG1 = makeRobot({ id: 'g1-live', name: 'G1 live', status: 'online', batteryLevel: 80, metadata: { robotType: 'g1_edu', powerSource: 'battery' } });
const onlineArm = makeRobot({ id: 'arm-live', name: 'Bench arm', model: 'SO-101 Follower', status: 'online', metadata: { robotType: 'so101', powerSource: 'ac_powered' } });
const offlineG1 = makeRobot({ id: 'g1-off', name: 'G1 off', batteryLevel: 40, metadata: { robotType: 'g1_edu' } });
// The demo's simulated robot (TASK-499): an agent, and nothing else next to it.
const simG1 = makeRobot({
  id: 'sim-robot-001',
  name: 'SimBot-01',
  model: 'Unitree G1 (simulated)',
  status: 'online',
  batteryLevel: 78,
  metadata: { isSimulated: true, hardwareConnected: false, robotType: 'g1', footprintRadiusM: 0.35 },
});
/** A snapshot of a robot whose agent answers and reaches no sidecar. */
const noSidecar = (supervisor: RobotReadiness['supervisor'] = null) =>
  ({
    robotId: 'r',
    bringup: null,
    supervisor,
    agent: { reachable: true, error: null, readiness: { sidecar: { reachable: false } } },
    reason: { code: 'sidecar_unreachable', severity: 'block', text: "Can't reach the robot sidecar (8767). Start the robot side.", source: 'agent' },
  }) as unknown as RobotReadiness;

const h = vi.hoisted(() => ({
  robot: null as unknown,
  telemetryOptions: [] as Array<Record<string, unknown> | undefined>,
  getRobotType: vi.fn(),
  useRobotReadiness: vi.fn((): { readiness: unknown } => ({ readiness: null })),
  canWrite: true,
  voiceHealth: null as { available: boolean } | null,
  useVoiceChannel: vi.fn((_robotId: string, _options?: { whenAvailable?: boolean }) => ({
    voice: { entries: [], activity: [], paused: false },
    health: h.voiceHealth,
    status: 'disconnected',
    refreshHealth: vi.fn(),
  })),
  usePointCloudStream: vi.fn(() => ({ frame: null, isConnected: false, lastUpdate: null })),
}));

vi.mock('../../hooks/useRobots', () => ({
  useRobot: () => ({
    robot: h.robot,
    commandHistory: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    sendToCharge: vi.fn(),
    returnHome: vi.fn(),
  }),
}));
vi.mock('../../hooks/useTelemetryStream', () => ({
  useTelemetryStream: (_id: string, options?: Record<string, unknown>) => {
    h.telemetryOptions.push(options);
    return { telemetry: null, status: 'disconnected', isConnected: false, lastUpdate: null, connect: vi.fn() };
  },
}));
vi.mock('@/features/processes/hooks/useTasks', () => ({ useTasksByRobotId: () => [] }));
vi.mock('@/features/auth/hooks/useAuth', () => ({
  usePermission: (permission: string) => (permission === 'robots:write' ? h.canWrite : true),
}));
vi.mock('../../hooks/useRobotReadiness', () => ({ useRobotReadiness: h.useRobotReadiness }));
vi.mock('../../api/robotsApi', () => ({ robotsApi: { getRobotType: h.getRobotType } }));
vi.mock('../RobotControlCenter', () => ({ RobotControlCenter: () => <div data-testid="control-center" /> }));
vi.mock('../AutonomousExecutionPanel', () => ({ AutonomousExecutionPanel: () => null }));
vi.mock('../EmergencyStopButton', () => ({ EmergencyStopButton: () => <button type="button">Emergency stop</button> }));
vi.mock('../VlaControlSection', () => ({ VlaControlSection: () => <div data-testid="vla-section" /> }));
vi.mock('../visualization/Robot3DViewer', () => ({
  Robot3DViewer: () => <div data-testid="robot-3d-viewer" />,
  Robot3DViewerFallback: () => <div />,
}));
vi.mock('../readiness/RobotReadinessPanel', () => ({ RobotReadinessPanel: () => <div data-testid="readiness-panel" /> }));
vi.mock('../tabs/vr/VRTeleopSection', () => ({ VRTeleopSection: () => <div data-testid="vr-section" /> }));
vi.mock('../../hooks/useVoiceChannel', () => ({ useVoiceChannel: h.useVoiceChannel }));
vi.mock('../../hooks/usePointCloudStream', () => ({ usePointCloudStream: h.usePointCloudStream }));
vi.mock('../PointCloudGallery', () => ({ PointCloudGallery: () => <div data-testid="scan-gallery" /> }));
vi.mock('../voice/VoiceComposer', () => ({ VoiceComposer: () => <div data-testid="voice-composer" /> }));
vi.mock('../voice/VoiceConversation', () => ({ VoiceConversation: () => null }));
vi.mock('../voice/VoicePipelinePanel', () => ({ VoicePipelinePanel: () => null }));
vi.mock('../RobotChatPanel', () => ({ RobotChatPanel: () => <div data-testid="robot-chat-panel" /> }));
vi.mock('../tabs/SiteSelect', () => ({ SiteSelect: () => null }));
vi.mock('../telemetry', () => ({
  BatteryHealthCard: () => null,
  ImuCard: () => null,
  MotorTemperatureStrip: () => null,
  TelemetryHistorySparklines: () => <div data-testid="history" />,
}));
vi.mock('@/features/command', () => ({ CommandBar: () => <div data-testid="command-bar" /> }));

import { RobotDetailPanel } from '../RobotDetailPanel';
import { RobotQuickStats } from '../RobotQuickStats';
import { TeleopTab } from '../tabs/TeleopTab';
import { ChatTab } from '../tabs/ChatTab';
import { VoiceTab } from '../tabs/VoiceTab';
import { PerceptionTab } from '../tabs/PerceptionTab';
import { OverviewTab } from '../tabs/OverviewTab';
import { CommandsTab } from '../tabs/CommandsTab';
import { TelemetryTab } from '../tabs/TelemetryTab';
import { InfoTab } from '../tabs/InfoTab';
import { readinessRows } from '../readiness/readinessRows';
import { robotTraits } from '../../utils/robotTraits';

beforeEach(() => {
  h.robot = null;
  h.telemetryOptions = [];
  h.canWrite = true;
  h.getRobotType.mockReset().mockResolvedValue({ robotType: null, linkedBy: null });
  h.useRobotReadiness.mockReset().mockImplementation(() => ({ readiness: null }));
  h.voiceHealth = null;
  h.useVoiceChannel.mockClear();
  h.usePointCloudStream.mockClear();
});

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('robotTraits', () => {
  it('reads agent, power and hands off what the robot reports, not off its name', () => {
    expect(robotTraits(expectedG1)).toEqual({ hasAgent: false, connected: false, canCharge: true, hasHands: true });
    expect(robotTraits(expectedArm)).toEqual({ hasAgent: false, connected: false, canCharge: false, hasHands: false });
    expect(robotTraits(onlineArm)).toEqual({ hasAgent: true, connected: true, canCharge: false, hasHands: false });
    expect(robotTraits(offlineG1)).toEqual({ hasAgent: true, connected: false, canCharge: true, hasHands: true });
    // A humanoid named like an arm is still a humanoid: only the reported keys count.
    const named = makeRobot({ name: 'SO-101 lookalike', status: 'online', metadata: { robotType: 'g1_edu' } });
    expect(robotTraits(named)).toMatchObject({ canCharge: true, hasHands: true });
  });

  it('lets a live telemetry frame overrule stale metadata', () => {
    const frame = { powerSource: 'ac_powered', robotType: 'so101' } as Pick<RobotTelemetry, 'powerSource' | 'robotType'>;
    expect(robotTraits(onlineG1, frame)).toMatchObject({ canCharge: false, hasHands: false });
  });

  it('claims no hands for an embodiment it does not know', () => {
    expect(robotTraits(arrivingDuck).hasHands).toBe(false);
  });
});

describe('the robot page header', () => {
  const menu = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    return (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
  };

  it('offers an expected robot nothing that needs an agent', async () => {
    h.robot = expectedG1;
    inRouter(<RobotDetailPanel robotId={expectedG1.id} />);
    expect(screen.queryByRole('button', { name: 'Emergency stop' })).toBeNull();
    expect(await menu()).toEqual(['Unregister']);
  });

  it('shows no empty menu to a viewer of an expected robot', () => {
    h.robot = expectedG1;
    h.canWrite = false;
    inRouter(<RobotDetailPanel robotId={expectedG1.id} />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('does not offer a mains-powered arm a trip to the charger', async () => {
    h.robot = onlineArm;
    inRouter(<RobotDetailPanel robotId={onlineArm.id} />);
    expect(screen.getByRole('button', { name: 'Emergency stop' })).toBeInTheDocument();
    expect(await menu()).toEqual(['Return home', 'Unregister']);
  });

  it('keeps every action for a connected battery robot', async () => {
    h.robot = onlineG1;
    inRouter(<RobotDetailPanel robotId={onlineG1.id} />);
    expect(screen.getByRole('button', { name: 'Emergency stop' })).toBeInTheDocument();
    expect(await menu()).toEqual(['Send to charge', 'Return home', 'Unregister']);
  });

  it('asks for telemetry only while the robot has a connected agent', () => {
    h.robot = expectedG1;
    const { unmount } = inRouter(<RobotDetailPanel robotId={expectedG1.id} />);
    expect(h.telemetryOptions[h.telemetryOptions.length - 1]).toMatchObject({ enabled: false });
    unmount();
    h.robot = offlineG1;
    inRouter(<RobotDetailPanel robotId={offlineG1.id} />).unmount();
    expect(h.telemetryOptions[h.telemetryOptions.length - 1]).toMatchObject({ enabled: false });
    h.robot = onlineG1;
    inRouter(<RobotDetailPanel robotId={onlineG1.id} />);
    expect(h.telemetryOptions[h.telemetryOptions.length - 1]).toMatchObject({ enabled: true });
  });
});

describe('the Teleop tab', () => {
  it('says teleop opens when the robot connects, and offers no Connect, readiness or VR', () => {
    inRouter(<TeleopTab robot={expectedArm} robotId={expectedArm.id} />);
    expect(screen.getByTestId('teleop-awaiting-agent')).toHaveTextContent('Not connected yet');
    expect(screen.getByTestId('teleop-awaiting-agent')).toHaveTextContent(
      "Keyboard and VR teleop open when the robot agent of SO-101 connects to this server.",
    );
    expect(screen.queryByRole('button', { name: /connect/i })).toBeNull();
    expect(screen.queryByTestId('readiness-panel')).toBeNull();
    expect(screen.queryByTestId('vr-section')).toBeNull();
    expect(screen.queryByText(/hand/i)).toBeNull();
    expect(h.useRobotReadiness).not.toHaveBeenCalled();
  });

  it('says a robot that has not been delivered has to arrive first', () => {
    inRouter(<TeleopTab robot={arrivingDuck} robotId={arrivingDuck.id} />);
    expect(screen.getByTestId('teleop-awaiting-agent')).toHaveTextContent('Not arrived yet');
    expect(screen.getByTestId('teleop-awaiting-agent')).toHaveTextContent(
      'Keyboard and VR teleop open once MicroDuck has arrived and its robot agent has connected.',
    );
  });
});

describe('the Teleop tab of a simulated robot (TASK-499)', () => {
  it('says there is nothing to start instead of naming a sidecar port', () => {
    h.useRobotReadiness.mockImplementation(() => ({ readiness: noSidecar() }));
    inRouter(<TeleopTab robot={simG1} robotId={simG1.id} />);
    const calm = screen.getByTestId('teleop-simulated-readiness');
    expect(calm).toHaveTextContent('Nothing to start on a simulated robot');
    expect(calm).toHaveTextContent('SimBot-01 is simulated: it has no robot hardware, so there is no robot side to start.');
    expect(screen.queryByTestId('readiness-panel')).toBeNull();
    expect(screen.queryByText(/sidecar/i)).toBeNull();
    // Teleop itself still works on the agent's simulated joints.
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.getByTestId('vr-section')).toBeInTheDocument();
  });

  it('keeps the readiness panel for a simulated robot that has a robot side to start', () => {
    // The rehearsal robot: a supervisor is configured, so Start means something.
    h.useRobotReadiness.mockImplementation(() => ({ readiness: noSidecar({ reachable: true, error: null }) }));
    inRouter(<TeleopTab robot={simG1} robotId={simG1.id} />);
    expect(screen.getByTestId('readiness-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('teleop-simulated-readiness')).toBeNull();
  });

  it('keeps the readiness panel, and its hint, for a real robot in the same state', () => {
    h.useRobotReadiness.mockImplementation(() => ({ readiness: noSidecar() }));
    inRouter(<TeleopTab robot={onlineG1} robotId={onlineG1.id} />);
    expect(screen.getByTestId('readiness-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('teleop-simulated-readiness')).toBeNull();
  });

  it('shows the panel while the first snapshot is still out', () => {
    inRouter(<TeleopTab robot={simG1} robotId={simG1.id} />);
    expect(screen.getByTestId('readiness-panel')).toBeInTheDocument();
  });
});

describe('the Chat tab', () => {
  it('mounts no chat for a robot without an agent', () => {
    inRouter(<ChatTab robot={expectedG1} robotId={expectedG1.id} />);
    expect(screen.getByTestId('chat-awaiting-agent')).toHaveTextContent('Chat opens when');
    expect(screen.queryByTestId('robot-chat-panel')).toBeNull();
  });

  it('still opens the chat of a robot with an agent', () => {
    inRouter(<ChatTab robot={onlineG1} robotId={onlineG1.id} />);
    expect(screen.getByTestId('robot-chat-panel')).toBeInTheDocument();
  });
});

describe('the Voice tab', () => {
  it('asks no voice service of a robot without an agent and offers no composer', () => {
    inRouter(<VoiceTab robot={expectedG1} robotId={expectedG1.id} />);
    expect(screen.getByTestId('voice-awaiting-agent')).toHaveTextContent(
      "Voice opens when the robot agent of Unitree G1 with Dex3 hands connects to this server.",
    );
    expect(screen.queryByTestId('voice-composer')).toBeNull();
    expect(h.useVoiceChannel).not.toHaveBeenCalled();
  });

  it('still opens voice for a robot with an agent', () => {
    inRouter(<VoiceTab robot={onlineG1} robotId={onlineG1.id} />);
    expect(screen.queryByTestId('voice-awaiting-agent')).toBeNull();
    expect(h.useVoiceChannel).toHaveBeenCalledWith(onlineG1.id, { whenAvailable: false });
  });

  it('tells a real robot whose voice service is down how to start it, as before', () => {
    h.voiceHealth = { available: false };
    inRouter(<VoiceTab robot={onlineG1} robotId={onlineG1.id} />);
    expect(screen.getByTestId('voice-offline-banner')).toHaveTextContent('python -m voice_service');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByTestId('voice-simulated')).toBeNull();
  });

  it('says plainly that a simulated robot has no voice, with no start command and no Retry (TASK-499)', () => {
    h.voiceHealth = { available: false };
    inRouter(<VoiceTab robot={simG1} robotId={simG1.id} />);
    const calm = screen.getByTestId('voice-simulated');
    expect(calm).toHaveTextContent('Voice is not available on a simulated robot');
    expect(calm).toHaveTextContent('SimBot-01 is simulated: it has no speaker and no microphone');
    expect(screen.queryByText(/voice_service/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByTestId('voice-composer')).toBeNull();
    // Health first: the status call and the event stream wait for a service.
    expect(h.useVoiceChannel).toHaveBeenCalledWith(simG1.id, { whenAvailable: true });
  });

  it('opens voice on a simulated robot that does run the voice service', () => {
    h.voiceHealth = { available: true };
    inRouter(<VoiceTab robot={simG1} robotId={simG1.id} />);
    expect(screen.getByTestId('voice-composer')).toBeInTheDocument();
    expect(screen.queryByTestId('voice-simulated')).toBeNull();
  });
});

describe('the Perception tab', () => {
  it('does not call an expected robot offline or offer a scan capture', () => {
    inRouter(<PerceptionTab robot={expectedG1} robotId={expectedG1.id} telemetry={null} />);
    expect(screen.getByTestId('perception-awaiting-agent')).toHaveTextContent('Not connected yet');
    expect(screen.queryByText(/is offline/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /capture scan/i })).toBeNull();
    expect(h.usePointCloudStream).not.toHaveBeenCalled();
  });

  it('keeps the viewer and capture for a robot that was connected before', () => {
    inRouter(<PerceptionTab robot={offlineG1} robotId={offlineG1.id} telemetry={null} />);
    expect(screen.queryByTestId('perception-awaiting-agent')).toBeNull();
    expect(screen.getByRole('button', { name: /capture scan/i })).toBeInTheDocument();
    expect(h.usePointCloudStream).toHaveBeenCalledWith(offlineG1.id, { enabled: false });
  });
});

describe('the Overview tab', () => {
  const props = (robot: Robot) => ({
    robot,
    robotId: robot.id,
    telemetry: null,
    isTelemetryConnected: false,
    isCommandLoading: false,
    canExecuteCommands: robot.status !== 'offline',
    onSendToCharge: vi.fn().mockResolvedValue(undefined),
    onReturnHome: vi.fn().mockResolvedValue(undefined),
  });

  it('replaces the skill and quick-action panels of an expected robot with one sentence', () => {
    inRouter(<OverviewTab {...props(expectedArm)} />);
    expect(screen.getByTestId('overview-awaiting-agent')).toHaveTextContent(
      "Skills and quick actions become available when the robot agent of SO-101 connects to this server.",
    );
    expect(screen.queryByTestId('vla-section')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Charge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
  });

  it('offers a connected mains-powered arm Home but no Charge', () => {
    inRouter(<OverviewTab {...props(onlineArm)} />);
    expect(screen.getByRole('button', { name: 'Home' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Charge' })).toBeNull();
  });

  it('offers a connected battery robot both', () => {
    inRouter(<OverviewTab {...props(onlineG1)} />);
    expect(screen.getByRole('button', { name: 'Charge' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Home' })).toBeEnabled();
    expect(screen.getByTestId('vla-section')).toBeInTheDocument();
  });

  it('the current-task tile of an expected robot does not call it offline', () => {
    const { rerender } = render(<RobotQuickStats robot={expectedG1} telemetry={null} isTelemetryConnected={false} />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.queryByText('Robot offline')).toBeNull();
    rerender(<RobotQuickStats robot={arrivingDuck} telemetry={null} isTelemetryConnected={false} />);
    expect(screen.getByText('Arriving')).toBeInTheDocument();
    rerender(<RobotQuickStats robot={offlineG1} telemetry={null} isTelemetryConnected={false} />);
    expect(screen.getByText('Robot offline')).toBeInTheDocument();
  });
});

describe('the Activity tab commands', () => {
  const props = (robot: Robot) => ({
    robot,
    robotId: robot.id,
    commandHistory: [],
    isCommandLoading: false,
    canExecuteCommands: robot.status !== 'offline',
    onSendToCharge: vi.fn().mockResolvedValue(undefined),
    onReturnHome: vi.fn().mockResolvedValue(undefined),
  });

  it('has no command bar and no quick acts for a robot without an agent', () => {
    inRouter(<CommandsTab {...props(expectedArm)} />);
    expect(screen.getByTestId('commands-awaiting-agent')).toHaveTextContent('Commands can be sent when');
    expect(screen.queryByTestId('command-bar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send to charge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Return home' })).toBeNull();
    expect(screen.getByText('No commands yet')).toBeInTheDocument();
  });

  it('leaves "Send to charge" out for a mains-powered arm', () => {
    inRouter(<CommandsTab {...props(onlineArm)} />);
    expect(screen.getByTestId('command-bar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to charge' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Return home' })).toBeEnabled();
  });
});

describe('the Telemetry tab', () => {
  const tab = (robot: Robot) =>
    inRouter(
      <TelemetryTab robot={robot} robotId={robot.id} telemetry={null} isTelemetryConnected={false} telemetryLastUpdate={null} />,
    );

  it('does not print the seed time of an expected robot as "last seen"', () => {
    tab(expectedArm);
    expect(screen.getByText('Not connected yet')).toBeInTheDocument();
    expect(screen.getByText("Telemetry appears here when the robot agent of SO-101 connects to this server.")).toBeInTheDocument();
    expect(screen.queryByText(/Last seen/)).toBeNull();
    expect(screen.queryByText(/is offline/)).toBeNull();
  });

  it('keeps "last seen" for a robot that was connected before', () => {
    tab(offlineG1);
    expect(screen.getByText(/G1 off is offline\. .* Last seen 15m ago\./)).toBeInTheDocument();
  });
});

describe('the Details tab', () => {
  it('shows the robot type the server links the robot to, with its widths', async () => {
    h.getRobotType.mockResolvedValue({
      robotType: { id: 'rt', name: 'Microduck', manufacturer: 'Pollen Robotics', model: 'microduck', actionDim: 15, proprioceptionDim: 15 },
      linkedBy: 'explicit',
    });
    inRouter(<InfoTab robot={arrivingDuck} robotId={arrivingDuck.id} />);
    await waitFor(() =>
      expect(screen.getByTestId('robot-type-link')).toHaveTextContent('Microduck · state 15 / action 15'),
    );
    expect(h.getRobotType).toHaveBeenCalledWith('demo-microduck');
    // The link is shown once, in Identity — not again as a raw metadata key.
    expect(screen.queryByText('Robot type name')).toBeNull();
    // An expected robot has no place to be unknown about.
    expect(screen.queryByText('Place unknown')).toBeNull();
  });

  it('reads a simulated robot\'s metadata as words, not raw keys and booleans (TASK-497)', async () => {
    h.getRobotType.mockResolvedValue({ robotType: null, linkedBy: null });
    const sim = makeRobot({
      id: 'sim-robot-001',
      name: 'SimBot-01',
      status: 'online',
      metadata: { isSimulated: true, hardwareConnected: false, robotType: 'g1', footprintRadiusM: 0.35 },
    });
    inRouter(<InfoTab robot={sim} robotId={sim.id} />);
    await waitFor(() => expect(h.getRobotType).toHaveBeenCalledWith('sim-robot-001'));
    expect(screen.getByText('Simulated').nextElementSibling).toHaveTextContent('Yes');
    expect(screen.getByText('Hardware connected').nextElementSibling).toHaveTextContent('No');
    expect(screen.getByText('Embodiment').nextElementSibling).toHaveTextContent('Unitree G1');
    // TASK-499: no robot type describes a plain G1, so the row names the
    // embodiment the robot reports instead of a dash — marked as not a link.
    expect(screen.getByTestId('robot-type-link')).toHaveTextContent(/^Unitree G1$/);
    expect(screen.getByTestId('robot-type-link')).toHaveAttribute('data-linked-by', 'embodiment');
    expect(screen.getByText('Footprint radius (m)').nextElementSibling).toHaveTextContent('0.35');
    expect(screen.queryByText('Is simulated')).toBeNull();
  });

  it('falls back to the type the robot states when the server cannot answer', async () => {
    h.getRobotType.mockRejectedValue(new Error('404'));
    inRouter(<InfoTab robot={expectedArm} robotId={expectedArm.id} />);
    await waitFor(() => expect(h.getRobotType).toHaveBeenCalled());
    expect(screen.getByTestId('robot-type-link')).toHaveTextContent('SO-101 Follower');
    // What the robot states wins over the embodiment fallback.
    expect(screen.getByTestId('robot-type-link')).not.toHaveAttribute('data-linked-by');
    // The key that picks the 3D model is no longer labelled as the robot type.
    expect(screen.getByText('Embodiment')).toBeInTheDocument();
  });
});

describe('the Details tab of a robot nothing names', () => {
  it('still shows a dash when there is no link, no stated type and no known embodiment', async () => {
    const bare = makeRobot({ id: 'bare', status: 'online', metadata: { robotType: 'something_new' } });
    inRouter(<InfoTab robot={bare} robotId={bare.id} />);
    await waitFor(() => expect(h.getRobotType).toHaveBeenCalledWith('bare'));
    expect(screen.getByTestId('robot-type-link')).toHaveTextContent('—');
  });
});

describe('readinessRows', () => {
  const readiness = (hands: unknown) =>
    ({
      robotId: 'r',
      bringup: null,
      agent: { reachable: true, readiness: hands === undefined ? null : { hands } },
    }) as unknown as RobotReadiness;
  const ids = (r: RobotReadiness, hands?: boolean) => readinessRows(r, 1420, { hands }).map((row) => row.id);

  it('lists no hands for a robot whose embodiment has none', () => {
    expect(ids(readiness(undefined), false)).not.toContain('hand_left');
    expect(ids(readiness(undefined), false)).not.toContain('hand_right');
  });

  it('keeps both hand rows by default and for an embodiment with hands', () => {
    expect(readinessRows(readiness(undefined)).map((row) => row.id)).toEqual(expect.arrayContaining(['hand_left', 'hand_right']));
    expect(ids(readiness(undefined), true)).toEqual(expect.arrayContaining(['hand_left', 'hand_right']));
  });
});
