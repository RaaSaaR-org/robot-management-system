/**
 * @file IdentityDialog.test.tsx
 * @description The naming ritual's non-conversational door (TASK-198): it must
 *              send only what the operator actually changed, must not let a
 *              robot go unnamed, and must not have the form pulled out from
 *              under the typist by the robot's own state pushes.
 * @feature agentmode
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IdentityDialog } from '../IdentityDialog';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type { AgentSelfState } from '../../types/agentmode.types';

vi.mock('../../api/agentmodeApi', () => ({
  agentmodeApi: {
    getState: vi.fn(),
    getScene: vi.fn(),
    sendCommand: vi.fn(),
    toggle: vi.fn(),
    estop: vi.fn(),
    resetEstop: vi.fn(),
    getMemory: vi.fn(),
    writeIdentity: vi.fn(),
  },
}));

import { agentmodeApi } from '../../api/agentmodeApi';

const mockedApi = vi.mocked(agentmodeApi);

const ROBOT_ID = 'sim-robot-g1-edu';

const self = (over: Partial<AgentSelfState> = {}): AgentSelfState => ({
  name: 'G1-EDU-Bot',
  emoji: null,
  unit: 'Unitree G1 EDU (Dex3-1)',
  robotId: ROBOT_ID,
  operator: null,
  site: null,
  bootstrapRequired: true,
  bootId: 'b-now',
  incarnation: 200,
  uptimeS: 30,
  lastShutdown: null,
  place: null,
  poseSource: null,
  batteryPct: 96,
  controlOwner: 'idle',
  damped: false,
  estopLatched: false,
  plansLast24h: 0,
  failuresLast24h: 0,
  memoryEntries: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAgentModeStore.getState().reset();
  useAgentModeStore.getState().selectRobot(ROBOT_ID);
  useAgentModeStore.setState({ self: self() });
});

describe('IdentityDialog', () => {
  it('sends only the fields the operator touched', async () => {
    mockedApi.writeIdentity.mockResolvedValueOnce({
      ok: true,
      self: self({ name: 'Nova', bootstrapRequired: false }),
    });
    const onClose = vi.fn();
    render(<IdentityDialog isOpen onClose={onClose} robotId={ROBOT_ID} />);

    await userEvent.type(screen.getByTestId('agent-identity-name'), 'Nova');
    await userEvent.click(screen.getByTestId('agent-identity-save'));

    // Site and operator were never touched, so they are not in the patch — the
    // robot must not have a site blanked by someone who only came to name it.
    expect(mockedApi.writeIdentity).toHaveBeenCalledWith(ROBOT_ID, { Name: 'Nova' });
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses to submit a robot that is still asking for a name', async () => {
    render(<IdentityDialog isOpen onClose={() => {}} robotId={ROBOT_ID} />);

    await userEvent.click(screen.getByTestId('agent-identity-save'));

    expect(screen.getByTestId('agent-identity-problem')).toHaveTextContent(/name/i);
    expect(mockedApi.writeIdentity).not.toHaveBeenCalled();
  });

  it('keeps what is being typed when the robot pushes a state snapshot', async () => {
    render(<IdentityDialog isOpen onClose={() => {}} robotId={ROBOT_ID} />);
    await userEvent.type(screen.getByTestId('agent-identity-name'), 'Nov');

    // The agent reports state on every plan, block and mode change.
    act(() => {
      useAgentModeStore.setState({ self: self({ batteryPct: 95 }) });
    });

    expect(screen.getByTestId('agent-identity-name')).toHaveValue('Nov');
  });

  it('says the robot refused rather than pretending the name landed', async () => {
    mockedApi.writeIdentity.mockRejectedValueOnce({
      code: 'IDENTITY_REFUSED',
      message: 'Name is not writable on this agent.',
      statusCode: 400,
    });
    const onClose = vi.fn();
    render(<IdentityDialog isOpen onClose={onClose} robotId={ROBOT_ID} />);

    await userEvent.type(screen.getByTestId('agent-identity-name'), 'Nova');
    await userEvent.click(screen.getByTestId('agent-identity-save'));

    expect(screen.getByTestId('agent-identity-problem')).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(useAgentModeStore.getState().error).toBe('Name is not writable on this agent.');
  });
});
