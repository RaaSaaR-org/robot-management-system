/**
 * @file scan-session.test.ts
 * @description Regression: getPointCloudFrame is unchanged with no active scan
 *   session, pose-stamps frames once a session is started, and (TASK-190)
 *   forwards the active session across the hardware seam.
 * @feature robot
 * @status test
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { RobotStateManager } from '../state.js';
import { hardwareClient } from '../../hardware/HardwareClient.js';
import type { RobotConfig } from '../types.js';

const config: RobotConfig = {
  id: 'robot-twin-test',
  name: 'Twin Test G1',
  model: 'G1',
  robotClass: 'standard',
  robotType: 'generic', // no embodiment file dependency → MID-360 defaults
  maxPayloadKg: 10,
  description: 'scan-session test',
  initialLocation: { x: 1, y: 2, heading: 90 },
  capabilities: [],
};

describe('RobotStateManager scan sessions', () => {
  let mgr: RobotStateManager;

  beforeAll(() => {
    // Ensure the real-recording replay seam is inactive so frames are synthetic.
    delete process.env.POINTCLOUD_REPLAY_FILE;
    delete process.env.POINTCLOUD_REPLAY_DIR;
    mgr = new RobotStateManager(config);
  });

  it('returns plain sim frames with NO pose when no session is active', async () => {
    const frame = await mgr.getPointCloudFrame();
    expect(frame.source).toBe('sim');
    expect(frame.pose).toBeUndefined();
    expect(frame.scanSessionId).toBeUndefined();
    expect(mgr.getScanStatus().active).toBe(false);
  });

  it('pose-stamps frames (yaw in radians) once a session starts', async () => {
    const { sessionId } = mgr.startScanSession({ sessionId: 'sess_unit' });
    expect(sessionId).toBe('sess_unit');
    expect(mgr.getScanStatus().active).toBe(true);

    // Note: the constructor restores persisted state keyed by the configured
    // robot, so read the live heading rather than assuming initialLocation.
    const loc = mgr.getState().location;
    const frame = await mgr.getPointCloudFrame();
    expect(frame.source).toBe('sim');
    expect(frame.scanSessionId).toBe('sess_unit');
    expect(frame.pose).toBeDefined();
    // The ONLY deg→rad conversion: pose.yaw must equal heading° × π/180.
    expect(frame.pose!.yaw).toBeCloseTo(((loc.heading ?? 0) * Math.PI) / 180, 6);
    // The twin's world origin is anchored at the scan-start location, so the
    // first frame's pose is at local origin regardless of world position.
    expect(frame.pose!.x).toBeCloseTo(0, 6);
    expect(frame.pose!.y).toBeCloseTo(0, 6);
  });

  it('reverts to plain sim frames after stop', async () => {
    const stopped = mgr.stopScanSession();
    expect(stopped.sessionId).toBe('sess_unit');
    expect(stopped.frames).toBeGreaterThan(0);

    const frame = await mgr.getPointCloudFrame();
    expect(frame.pose).toBeUndefined();
    expect(frame.scanSessionId).toBeUndefined();
    expect(mgr.getScanStatus().active).toBe(false);
  });
});

/**
 * TASK-190: the hardware seam returns BEFORE the scan-session seam, so on a
 * real G1 the session was invisible to the sidecar and it re-decided the
 * MID-360 frame convention per frame. The active session must ride along with
 * the snapshot request instead.
 */
describe('RobotStateManager scan sessions — hardware seam', () => {
  let mgr: RobotStateManager;

  beforeEach(() => {
    mgr = new RobotStateManager({ ...config, id: 'robot-twin-hw-test' });
    vi.spyOn(hardwareClient, 'isConnected').mockReturnValue(true);
    vi.spyOn(hardwareClient, 'snapshotPointCloud').mockResolvedValue({
      robotId: '',
      sensor: 'mid360_lidar',
      sensorType: 'lidar',
      frame: 'base_link',
      pointCount: 0,
      positions: [],
      intensities: [],
      hasIntensity: true,
      sequence: 0,
      source: 'hardware',
      timestamp: new Date().toISOString(),
    });
  });

  afterEach(() => {
    mgr.stopScanSession();
    vi.restoreAllMocks();
  });

  it('passes the active scan session to the sidecar snapshot', async () => {
    mgr.startScanSession({ sessionId: 'sess_hw' });

    await mgr.getPointCloudFrame();
    await mgr.getPointCloudFrame();

    expect(hardwareClient.snapshotPointCloud).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(hardwareClient.snapshotPointCloud).mock.calls) {
      expect(call[1]).toEqual({ scanSessionId: 'sess_hw' });
    }
  });

  it('passes no session when no scan is running', async () => {
    await mgr.getPointCloudFrame();

    expect(hardwareClient.snapshotPointCloud).toHaveBeenCalledWith('mid360_lidar', {
      scanSessionId: undefined,
    });
  });
});
