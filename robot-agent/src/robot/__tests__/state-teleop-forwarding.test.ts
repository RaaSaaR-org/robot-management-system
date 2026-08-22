/**
 * @file state-teleop-forwarding.test.ts
 * @description Tests that the teleop pose actually reaches the robot — the
 *              sidecar `/action` stream that lets VR teleop drive the MuJoCo
 *              sim (and a real G1) instead of only the on-screen model.
 * @feature teleop
 * @status test
 *
 * What these protect:
 *
 * - **Seeding from the live pose.** With forwarding on, `enableTeleop` is a
 *   movement. The G1's joint defaults are all zero, which is the MJCF pose with
 *   both arms straight out; seeding from defaults hauled a standing robot into a
 *   T-pose the moment anyone opened the VR view.
 * - **Letting go.** When the last operator disconnects the stream must stop AND
 *   the sidecar's ramp state must be dropped, or the next operator's first frame
 *   continues a stranger's half-finished motion.
 * - **Not stacking requests.** At 50 Hz a slow sidecar would otherwise collect
 *   one outstanding request per tick, each carrying a target that was stale
 *   before it was sent.
 * - **The E-Stop reaching the writer.** The forwarder gated only on "teleop is
 *   on" and "a sidecar is attached", so a latched E-Stop stopped the base and
 *   then the operator's arm pose walked straight back out to the robot one
 *   frame later, 50 times a second.
 * - **Saying WHY nothing is moving.** A sidecar that answers 403 and a sidecar
 *   that answers nothing are different problems, and only the first is one an
 *   operator can fix — so they reach the socket as different codes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RobotConfig } from '../types.js';

const TEST_JOINTS = [
  { name: 'shoulder_pan', axis: 'z', limitLower: -1, limitUpper: 1, defaultPosition: 0 },
  { name: 'elbow_flex', axis: 'y', limitLower: 0, limitUpper: 2, defaultPosition: 0.5 },
];

vi.mock('../joint-configs/index.js', () => ({
  getJointConfig: vi.fn().mockReturnValue(TEST_JOINTS),
}));

/**
 * The mocked module has to carry the error CLASS too: `forwardTeleopToHardware`
 * branches on `err instanceof HardwareActionError`, and that identity is
 * resolved through this mock, not through the real module.
 */
const { HardwareActionError } = vi.hoisted(() => ({
  HardwareActionError: class HardwareActionError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
      this.name = 'HardwareActionError';
    }
  },
}));

const hw = {
  connected: false,
  joints: [] as Array<{ name: string; position: number }>,
  sendAction: vi.fn(async (_joints: Record<string, number>): Promise<void> => {}),
  releaseAction: vi.fn(async (): Promise<void> => {}),
  locoStop: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
};

vi.mock('../../hardware/HardwareClient.js', () => ({
  HardwareActionError,
  hardwareClient: {
    isConnected: () => hw.connected,
    getJointStates: () => hw.joints,
    sendAction: (j: Record<string, number>) => hw.sendAction(j),
    releaseAction: () => hw.releaseAction(),
    locoStop: () => hw.locoStop(),
    sendEstop: async () => {},
    onPoseSample: () => () => {},
    getOdometry: () => null,
    getMotorTemperatures: () => null,
    getBasePose: () => null,
    start: () => {},
    stop: () => {},
  },
}));

vi.mock('../../config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config.js')>();
  return { ...actual, config: { ...actual.config, robotId: 'test-robot' } };
});

const { RobotStateManager } = await import('../state.js');

function makeConfig(): RobotConfig {
  return {
    id: 'test-robot-1', name: 'TestBot', model: 'TestModel', robotClass: 'standard',
    robotType: 'so101', maxPayloadKg: 10, description: 'Test robot',
    initialLocation: { x: 0, y: 0, floor: '1' }, capabilities: ['navigation'],
  };
}

/** Let the forwarder's timer fire `n` times and its promises settle. */
async function tick(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(20);
  }
}

describe('RobotStateManager — teleop reaches the robot', () => {
  let mgr: InstanceType<typeof RobotStateManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    hw.connected = false;
    hw.joints = [];
    hw.sendAction.mockClear().mockImplementation(async () => {});
    hw.releaseAction.mockClear().mockImplementation(async () => {});
    hw.locoStop.mockClear().mockImplementation(async () => ({ ok: true }));
    mgr = new RobotStateManager(makeConfig());
  });

  afterEach(() => {
    mgr.disableTeleop();
    vi.useRealTimers();
  });

  describe('seeding', () => {
    it('starts from where the robot actually is, not from the joint defaults', async () => {
      hw.connected = true;
      hw.joints = [{ name: 'shoulder_pan', position: 0.4 }, { name: 'elbow_flex', position: 1.7 }];
      expect(mgr.enableTeleop()).toEqual({ shoulder_pan: 0.4, elbow_flex: 1.7 });
    });

    it('falls back to the defaults when no sidecar is reporting joints', () => {
      expect(mgr.enableTeleop()).toEqual({ shoulder_pan: 0, elbow_flex: 0.5 });
    });

    it('clamps a live pose that sits outside the configured limits', () => {
      hw.connected = true;
      hw.joints = [{ name: 'shoulder_pan', position: 9 }, { name: 'elbow_flex', position: -9 }];
      expect(mgr.enableTeleop()).toEqual({ shoulder_pan: 1, elbow_flex: 0 });
    });

    it('uses the default for a joint the sidecar does not report', () => {
      hw.connected = true;
      hw.joints = [{ name: 'shoulder_pan', position: 0.4 }];
      expect(mgr.enableTeleop()).toEqual({ shoulder_pan: 0.4, elbow_flex: 0.5 });
    });
  });

  describe('forwarding', () => {
    it('streams the commanded pose to the sidecar', async () => {
      hw.connected = true;
      mgr.enableTeleop();
      mgr.setTeleopJoint('shoulder_pan', 0.6);
      await tick(2);
      expect(hw.sendAction).toHaveBeenCalled();
      expect(hw.sendAction.mock.calls.at(-1)![0]).toMatchObject({ shoulder_pan: 0.6 });
    });

    it('keeps re-sending the same target, because the sidecar ramps per call', async () => {
      hw.connected = true;
      mgr.enableTeleop();
      await tick(4);
      expect(hw.sendAction.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('sends nothing while no sidecar is attached', async () => {
      hw.connected = false;
      mgr.enableTeleop();
      await tick(4);
      expect(hw.sendAction).not.toHaveBeenCalled();
    });

    it('never has two requests outstanding at once', async () => {
      hw.connected = true;
      let release: (() => void) | undefined;
      hw.sendAction.mockImplementation(() => new Promise<void>((r) => { release = r; }));
      mgr.enableTeleop();
      await tick(5);
      expect(hw.sendAction).toHaveBeenCalledTimes(1);
      release!();
      await tick(2);
      expect(hw.sendAction.mock.calls.length).toBeGreaterThan(1);
    });

    it('reports a broken sidecar once, not once per frame', async () => {
      hw.connected = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      hw.sendAction.mockRejectedValue(new Error('sidecar down'));
      mgr.enableTeleop();
      await tick(6);
      expect(hw.sendAction.mock.calls.length).toBeGreaterThan(2);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('letting go', () => {
    it('stops streaming and drops the sidecar ramp when teleop ends', async () => {
      hw.connected = true;
      mgr.enableTeleop();
      await tick(2);
      const sent = hw.sendAction.mock.calls.length;
      mgr.disableTeleop();
      expect(hw.releaseAction).toHaveBeenCalledTimes(1);
      await tick(5);
      expect(hw.sendAction.mock.calls.length).toBe(sent);
    });

    it('does not release twice when teleop is already off', () => {
      mgr.enableTeleop();
      mgr.disableTeleop();
      mgr.disableTeleop();
      expect(hw.releaseAction).toHaveBeenCalledTimes(1);
    });

    it('survives a sidecar that refuses the release', async () => {
      hw.connected = true;
      hw.releaseAction.mockRejectedValue(new Error('gone'));
      mgr.enableTeleop();
      await tick(1);
      expect(() => mgr.disableTeleop()).not.toThrow();
      await tick(1);
    });

    it('re-entering teleop starts a fresh stream', async () => {
      hw.connected = true;
      mgr.enableTeleop();
      await tick(2);
      mgr.disableTeleop();
      hw.sendAction.mockClear();
      mgr.enableTeleop();
      await tick(2);
      expect(hw.sendAction).toHaveBeenCalled();
    });
  });
  describe('the E-Stop reaches the writer', () => {
    it('stops streaming the pose the moment the latch is taken', async () => {
      hw.connected = true;
      mgr.enableTeleop();
      await tick(2);
      expect(hw.sendAction.mock.calls.length).toBeGreaterThan(0);

      mgr.triggerEmergencyStop('remote', 'operator hit the button');
      const sentAtStop = hw.sendAction.mock.calls.length;
      await tick(6);

      // Not "fewer frames" — none. A latched E-Stop that still wrote /action
      // let the arm pose walk back out one frame after the base was stopped.
      expect(hw.sendAction.mock.calls.length).toBe(sentAtStop);
    });

    it('does NOT resume on its own once the latch is cleared', async () => {
      // This test used to assert the opposite, and the opposite was a defect.
      //
      // Only the teleop socket's own `{estop}` dropped the teleop target; every
      // other stop path — `POST /safety/estop` (what the VR modal's STOP button
      // and the fleet console both reach), a zone trigger, Agent Mode — left
      // `teleopJoints` holding the PRE-STOP target with the 20 ms forwarder
      // still running, gated only on the latch. So: operator mid-reach, the
      // console latches, the arm halts half-way, the operator takes the headset
      // off and puts the controllers down — and whoever clicks Reset E-Stop gets
      // the interrupted reach completed at 50 Hz with nobody at the controls.
      //
      // Clearing a stop must never itself be a motion command.
      hw.connected = true;
      mgr.enableTeleop();
      mgr.triggerEmergencyStop('remote', 'operator hit the button');
      await tick(3);
      const stalled = hw.sendAction.mock.calls.length;

      // The monitor refuses a reset while it believes the server is gone, so
      // the heartbeat is part of "a deliberate operator reset" here.
      mgr.updateServerHeartbeat();
      expect(mgr.resetEmergencyStop()).toBe(true);
      await tick(3);

      expect(hw.sendAction.mock.calls.length).toBe(stalled);

      // It resumes when an OPERATOR asks for it, which is the whole difference:
      // re-entering teleop re-seeds from where the robot actually is, so the
      // motion that follows is one somebody commanded from the real pose.
      mgr.enableTeleop();
      await tick(3);
      expect(hw.sendAction.mock.calls.length).toBeGreaterThan(stalled);
    });

    it('a category-0 stop hands the joints back, so the ramp is not left mid-reach', async () => {
      hw.connected = true;
      mgr.enableTeleop();
      await tick(1);
      hw.releaseAction.mockClear();

      mgr.triggerEmergencyStop('remote', 'operator hit the button');
      await tick(1);

      expect(hw.locoStop).toHaveBeenCalled();
      expect(hw.releaseAction).toHaveBeenCalled();
    });

    it('a protective (category 2) stop keeps the pose held — no ramp release', async () => {
      hw.connected = true;
      mgr.enableTeleop();
      await tick(1);
      hw.releaseAction.mockClear();

      mgr.triggerProtectiveStop('someone walked into the cell');
      await tick(1);

      expect(hw.releaseAction).not.toHaveBeenCalled();
    });

    it('survives a sidecar that refuses the category-0 ramp release', async () => {
      hw.connected = true;
      hw.releaseAction.mockRejectedValue(new Error('gone'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mgr.enableTeleop();

      expect(() => mgr.triggerEmergencyStop('remote', 'boom')).not.toThrow();
      await tick(2);
      warn.mockRestore();
    });
  });

  describe('telling the operator why nothing moves', () => {
    it('reports a sidecar that ANSWERED no as action_rejected, with its own words', async () => {
      hw.connected = true;
      const seen: Array<{ code: string; message: string }> = [];
      mgr.onTeleopError((e) => seen.push(e));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      hw.sendAction.mockRejectedValue(
        new HardwareActionError('G1_READ_ONLY — command path disabled', 403),
      );

      mgr.enableTeleop();
      await tick(2);

      expect(seen[0]).toEqual({
        code: 'action_rejected',
        message: 'G1_READ_ONLY — command path disabled',
      });
      warn.mockRestore();
    });

    it('reports a sidecar that answered NOTHING as sidecar_down', async () => {
      hw.connected = true;
      const seen: Array<{ code: string; message: string }> = [];
      mgr.onTeleopError((e) => seen.push(e));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      hw.sendAction.mockRejectedValue(new Error('fetch failed'));

      mgr.enableTeleop();
      await tick(2);

      expect(seen[0]?.code).toBe('sidecar_down');
      warn.mockRestore();
    });

    it('keeps reporting per frame — a socket that connects after the break is still told', async () => {
      hw.connected = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      hw.sendAction.mockRejectedValue(new Error('fetch failed'));
      mgr.enableTeleop();
      await tick(3);

      // Late subscriber: the console line is latched once per session, the
      // listener stream deliberately is not.
      const seen: Array<{ code: string }> = [];
      mgr.onTeleopError((e) => seen.push(e));
      await tick(3);

      expect(seen.length).toBeGreaterThan(0);
      warn.mockRestore();
    });

    it('one listener throwing does not stop the next one hearing about it', async () => {
      hw.connected = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      hw.sendAction.mockRejectedValue(new Error('fetch failed'));
      mgr.onTeleopError(() => { throw new Error('listener blew up'); });
      const seen: string[] = [];
      mgr.onTeleopError((e) => seen.push(e.code));

      mgr.enableTeleop();
      await tick(2);

      expect(seen.length).toBeGreaterThan(0);
      warn.mockRestore();
      err.mockRestore();
    });

    it('unsubscribing stops the stream', async () => {
      hw.connected = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      hw.sendAction.mockRejectedValue(new Error('fetch failed'));
      const seen: string[] = [];
      const off = mgr.onTeleopError((e) => seen.push(e.code));

      mgr.enableTeleop();
      await tick(2);
      const before = seen.length;
      off();
      await tick(3);

      expect(seen.length).toBe(before);
      warn.mockRestore();
    });
  });
});
