/**
 * @file command-executor-estop.test.ts
 * @description The `emergency_stop` command path (`roboctl estop`, fleet
 *              commands, the Genkit emergencyStop tool). It has to reach Agent
 *              Mode — zeroing the simulated speed does not stop a plan that is
 *              driving the robot over LocoClient — and it must report what it
 *              actually did rather than claiming "all movement halted".
 * @feature robot
 * @status test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandExecutor, type AgentEstop } from '../CommandExecutor.js';
import type { SimulatedRobotState } from '../types.js';

function makeState(): SimulatedRobotState {
  return {
    id: 'robot-1',
    status: 'busy',
    batteryLevel: 90,
    location: { x: 1, y: 2, zone: 'A' },
    speed: 0.6,
    warnings: [],
    updatedAt: new Date().toISOString(),
  } as unknown as SimulatedRobotState;
}

describe('CommandExecutor — emergency stop reaches Agent Mode', () => {
  let state: SimulatedRobotState;
  let agentEstop: ReturnType<typeof vi.fn>;
  let executor: CommandExecutor;

  beforeEach(() => {
    state = makeState();
    agentEstop = vi.fn().mockResolvedValue({ stopped: true });
    executor = new CommandExecutor(
      { speedUnitsPerSecond: 2, agentEstop: agentEstop as unknown as AgentEstop },
      () => state,
      (updater) => updater(state)
    );
  });

  it('forwards the stop to the Agent Mode controller', async () => {
    await executor.emergencyStop();

    expect(agentEstop).toHaveBeenCalledOnce();
    expect(agentEstop.mock.calls[0][0]).toMatch(/emergency stop/i);
  });

  it('reports that a running plan was aborted, without claiming a verified halt', async () => {
    const result = await executor.emergencyStop();

    expect(result.success).toBe(true);
    expect(result.message).toContain('Agent Mode plan was aborted');
    expect(result.message).toContain('not verified');
    // The old fabricated claim: nothing here can observe the physical robot.
    expect(result.message).not.toBe('EMERGENCY STOP ACTIVATED - All movement halted');
    expect(result.message).not.toMatch(/All movement halted/);
    expect(state.speed).toBe(0);
  });

  it('says so honestly when no plan was running', async () => {
    agentEstop.mockResolvedValue({ stopped: false });

    const result = await executor.emergencyStop();

    expect(result.success).toBe(true);
    expect(result.message).toContain('no Agent Mode plan was running');
  });

  // Review round 2: a stop that latched but was never acked by the sidecar
  // (StopMove/Damp delivery failure) used to be invisible — estop() resolved
  // normally and this executor reported a clean stop about an un-damped robot.
  it('fails loudly when the stop latched but never reached the sidecar', async () => {
    agentEstop.mockResolvedValue({
      stopped: true,
      delivered: false,
      deliveryError: 'StopMove: sidecar /loco/action unreachable',
    });

    const result = await executor.emergencyStop();

    expect(result.success).toBe(false);
    expect(result.message).toContain('StopMove: sidecar /loco/action unreachable');
    expect(state.speed).toBe(0);
  });

  it('fails loudly when the Agent Mode stop could not be delivered', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    agentEstop.mockRejectedValue(new Error('sidecar unreachable'));

    const result = await executor.emergencyStop();

    expect(result.success).toBe(false);
    expect(result.message).toContain('sidecar unreachable');
    // The simulated state is still stopped — that part did happen.
    expect(state.speed).toBe(0);
    spy.mockRestore();
  });

  it('routes the emergency_stop command type through the same path', async () => {
    const command = await executor.execute('emergency_stop');

    expect(agentEstop).toHaveBeenCalledOnce();
    expect(command.status).toBe('completed');
  });
});
