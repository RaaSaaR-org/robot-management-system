/**
 * @file HardwareClient.ts
 * @description HTTP client for a hardware sidecar (so101_sidecar.py / g1_sidecar.py).
 *              Polls real joint states and forwards actions to the real robot.
 *              TASK-146 extended this with snapshot/getStateNow/sendActionVector
 *              for the TS-owned closed loop.
 *
 *              Embodiment-aware: the joint vector order used by getStateNow /
 *              sendActionVector is resolved dynamically from the active robot
 *              type (ROBOT_TYPE → getJointConfig), not hardcoded to SO-101. This
 *              lets a G1 (29 DOF) / G1 EDU (43 DOF) be controlled without
 *              silently dropping its non-arm joints. Also exposes getImuNow() so
 *              the SafetyMonitor can read humanoid orientation for fall detection.
 * @feature hardware
 * @status live
 */

import type { JointState, PointCloudFrame, PointCloudSensorType } from '../robot/types.js';
import { getJointConfig } from '../robot/joint-configs/index.js';
import { config } from '../config/config.js';

/**
 * A single IMU reading from the robot's base, as carried in the sidecar's
 * `/state` response under the `"imu"` key. Orientation is in radians (roll,
 * pitch, yaw), angular rate in rad/s, linear acceleration in m/s². Consumed by
 * the SafetyMonitor for humanoid fall detection.
 */
export interface ImuReading {
  rpy: [number, number, number];
  gyro: [number, number, number];
  /**
   * Linear acceleration [ax, ay, az] in m/s². OPTIONAL — fall detection consumes
   * only rpy + gyro, so a robot reporting orientation + angular rate but no accel
   * must NOT be treated as "no IMU". Present only when the sidecar reports it.
   */
  accel?: [number, number, number];
}

/**
 * Coerce an unknown value into a numeric 3-tuple, or null if it isn't a
 * well-formed array of three finite numbers. Used to defensively parse IMU
 * sub-vectors that arrive over the wire.
 */
function _toVec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const a = Number(v[0]);
  const b = Number(v[1]);
  const c = Number(v[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  return [a, b, c];
}

const SIDECAR_URL = process.env.HARDWARE_SIDECAR_URL ?? 'http://localhost:8765';
// Poll every 2s — avoids monopolizing /dev/ttyACM0 so other tools can use the arm.
// Idle watchdog in the sidecar disconnects after 5s without requests, releasing the port.
const POLL_INTERVAL_MS = 2000;

export class HardwareClient {
  private connected = false;
  private sidecarAvailable = false;
  private jointStates: JointState[] = [];
  private pollTimer: NodeJS.Timeout | null = null;
  /** Ordered joint names for the active embodiment; resolved lazily, then cached. */
  private jointOrder: string[] | null = null;

  /**
   * Ordered list of joint names for the active embodiment (ROBOT_TYPE),
   * e.g. SO-101 → 6 arm joints, G1 → 29 DOF, G1 EDU → 43 DOF. This is the
   * canonical index↔joint mapping for getStateNow / sendActionVector, so an
   * N-DOF action vector is no longer truncated to the SO-101 6.
   *
   * Resolved from the same source the 3D viewer / sim use
   * (getJointConfig), memoized because ROBOT_TYPE is fixed per process.
   * Empty for the `generic` embodiment (must not throw — callers no-op).
   */
  private getJointOrder(): string[] {
    if (this.jointOrder === null) {
      this.jointOrder = getJointConfig(config.robotType).map((j) => j.name);
      console.log(
        `[Hardware] Joint order resolved for robotType=${config.robotType}: ${this.jointOrder.length} joints`,
      );
    }
    return this.jointOrder;
  }

  async init(): Promise<boolean> {
    const ok = await this._tryConnect();
    if (!ok) {
      // Sidecar not up yet — retry every 10s in background
      console.log('[Hardware] Sidecar not available — will retry every 10s');
      this._scheduleRetry();
    }
    return ok;
  }

  private async _tryConnect(): Promise<boolean> {
    try {
      const res = await fetch(`${SIDECAR_URL}/health`, { signal: AbortSignal.timeout(2000) });
      const data = (await res.json()) as { status: string; connected: boolean };
      this.sidecarAvailable = data.status === 'ok';
      this.connected = data.connected;
      if (this.sidecarAvailable) {
        console.log(`[Hardware] Sidecar reachable — arm connected: ${this.connected}`);
        if (!this.pollTimer) this.startPolling();
      }
    } catch {
      this.sidecarAvailable = false;
      this.connected = false;
    }
    return this.sidecarAvailable;
  }

  private _scheduleRetry(): void {
    setTimeout(async () => {
      const ok = await this._tryConnect();
      if (!ok) this._scheduleRetry(); // keep retrying until sidecar is up
    }, 10_000);
  }

  private startPolling() {
    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${SIDECAR_URL}/state`, { signal: AbortSignal.timeout(500) });
        const data = (await res.json()) as {
          joints: Array<{ name: string; position: number; velocity: number; effort: number }>;
          simulated: boolean;
        };
        this.connected = !data.simulated;
        this.jointStates = data.joints.map((j) => ({
          name: j.name,
          position: j.position,
          velocity: j.velocity,
          effort: j.effort ?? 0,
          temperature: 0,
          current: 0,
        }));
      } catch {
        // sidecar went away — stop polling and schedule reconnect
        this.sidecarAvailable = false;
        this.connected = false;
        this.stopPolling();
        console.log('[Hardware] Lost connection to sidecar — retrying in 10s');
        this._scheduleRetry();
        // NOTE: jointStates kept intact so the 3D viewer shows last known pose
        //       instead of jumping to simulated defaults during brief reconnects.
      }
    }, POLL_INTERVAL_MS);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  isAvailable(): boolean {
    return this.sidecarAvailable;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getJointStates(): JointState[] {
    return this.jointStates;
  }

  async sendAction(joints: Record<string, number>): Promise<void> {
    if (!this.sidecarAvailable) return;
    await fetch(`${SIDECAR_URL}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(joints),
      signal: AbortSignal.timeout(1000),
    });
  }

  // ────────────────────────────────────────────────────────────────
  // TASK-146: helpers used by SkillExecutor's closed loop.
  // Unlike the 2s polling path above, these are synchronous per-call
  // fetches the closed loop makes at ~5 Hz.
  // ────────────────────────────────────────────────────────────────

  /**
   * List of camera names the sidecar exposes. Called once at connect time
   * by SkillExecutor so it can map vla-server's expected camera names onto
   * the physical cameras.
   */
  async getCameras(): Promise<string[]> {
    const res = await fetch(`${SIDECAR_URL}/cameras`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      throw new Error(`Sidecar /cameras returned ${res.status}`);
    }
    const data = (await res.json()) as { cameras?: string[] };
    return data.cameras ?? [];
  }

  /**
   * One-shot camera snapshot as a base64 JPEG. Used per-tick by the
   * closed loop when it needs fresh frames for `/predict`.
   */
  async snapshot(name: string): Promise<string> {
    const res = await fetch(`${SIDECAR_URL}/cameras/${encodeURIComponent(name)}/snapshot`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      throw new Error(`Sidecar snapshot ${name} failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { image_b64?: string };
    if (!data.image_b64) {
      throw new Error(`Sidecar snapshot ${name}: empty response`);
    }
    return data.image_b64;
  }

  /**
   * List of depth / LiDAR sensor names the sidecar exposes.
   *
   * @status hardware-pending — on real G1 hardware these come from the Livox
   * SDK2 / livox_ros_driver2 (`/livox/lidar`) and the RealSense ROS2 wrapper
   * (`/camera/depth/color/points`). Sim is the default; this path is only taken
   * when a connected sidecar reports real sensors.
   */
  async getPointCloudSensors(): Promise<string[]> {
    const res = await fetch(`${SIDECAR_URL}/pointcloud/sensors`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      throw new Error(`Sidecar /pointcloud/sensors returned ${res.status}`);
    }
    const data = (await res.json()) as { sensors?: string[] };
    return data.sensors ?? [];
  }

  /**
   * One-shot point-cloud snapshot from a real depth / LiDAR sensor.
   *
   * @status hardware-pending — returns XYZ(+intensity) as flat arrays so it maps
   * 1:1 onto {@link PointCloudFrame}. The caller (RobotStateManager) fills in
   * robotId / sequence / timestamp.
   */
  async snapshotPointCloud(name: string): Promise<PointCloudFrame> {
    const res = await fetch(`${SIDECAR_URL}/pointcloud/${encodeURIComponent(name)}/snapshot`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      throw new Error(`Sidecar point cloud ${name} failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      positions?: number[];
      intensities?: number[];
      sensor_type?: PointCloudSensorType;
      has_intensity?: boolean;
      origin?: [number, number, number];
    };
    const positions = data.positions ?? [];
    const intensities = data.intensities ?? [];
    return {
      robotId: '',
      sensor: name,
      sensorType: data.sensor_type ?? 'lidar',
      frame: 'base_link',
      pointCount: Math.floor(positions.length / 3),
      positions,
      intensities,
      hasIntensity: data.has_intensity ?? intensities.length > 0,
      sequence: 0,
      origin: data.origin,
      source: 'hardware',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Synchronous joint read (unlike the 2s `jointStates` poll). Uses the
   * sidecar's /state/fast endpoint, which skips the between-read torque
   * disable so the robot holds position during a closed-loop run.
   *
   * Returns a vector in the active embodiment's joint order (see
   * {@link getJointOrder}): SO-101 → 6 elements, G1 → 29, G1 EDU → 43.
   * Missing joints read as 0; an empty order (generic) yields [].
   */
  async getStateNow(): Promise<number[]> {
    const res = await fetch(`${SIDECAR_URL}/state/fast`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      throw new Error(`Sidecar /state/fast returned ${res.status}`);
    }
    const data = (await res.json()) as {
      joints: Array<{ name: string; position: number }>;
    };
    const order = this.getJointOrder();
    const byName = new Map(data.joints.map((j) => [j.name, j.position]));
    return order.map((n) => byName.get(n) ?? 0);
  }

  /**
   * Send an action vector in the active embodiment's joint order (see
   * {@link getStateNow}). Maps `action[i]` to the i-th joint name and POSTs a
   * name-keyed dict (the shape both sidecars' `send_action` expect).
   *
   * Length mismatches are logged and the overlap is mapped — never silently
   * truncated (the old SO-101 hardcoding dropped a G1's joints 7..N silently).
   */
  async sendActionVector(action: number[]): Promise<void> {
    const order = this.getJointOrder();
    if (order.length === 0) {
      console.warn(
        `[Hardware] sendActionVector: no joint order for robotType=${config.robotType} — action of ${action.length} ignored`,
      );
      return;
    }
    if (action.length !== order.length) {
      console.warn(
        `[Hardware] sendActionVector: action length ${action.length} ≠ ${order.length} joints ` +
          `(robotType=${config.robotType}) — mapping overlap of ${Math.min(action.length, order.length)}`,
      );
    }
    const joints: Record<string, number> = {};
    const n = Math.min(order.length, action.length);
    for (let i = 0; i < n; i++) {
      joints[order[i]] = action[i];
    }
    await this.sendAction(joints);
  }

  /**
   * Read the robot's base IMU from the sidecar's `/state` response (the same
   * gentle path the 2s poll uses). Returns null when the sidecar carries no
   * `"imu"` field (e.g. SO-101, or a G1 not yet reporting IMU) or when the
   * reading is malformed — callers must treat null as "no reliable IMU" rather
   * than "upright". The SafetyMonitor uses this for humanoid fall detection.
   *
   * Strict on the CONSUMED signals: rpy and gyro must both be well-formed numeric
   * triples or null is returned — they are never fabricated, since a zero-filled
   * reading could mask a fall. accel is optional (the fall-detection net ignores
   * it), so a missing/malformed accel does NOT disable the safety net.
   */
  async getImuNow(): Promise<ImuReading | null> {
    let data: { imu?: unknown };
    try {
      const res = await fetch(`${SIDECAR_URL}/state`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) return null;
      data = (await res.json()) as { imu?: unknown };
    } catch {
      // Sidecar unreachable / timeout — no IMU available this tick.
      return null;
    }
    const imu = data?.imu;
    if (!imu || typeof imu !== 'object') return null;
    const { rpy, gyro, accel } = imu as Record<string, unknown>;
    const rpyVec = _toVec3(rpy);
    const gyroVec = _toVec3(gyro);
    // Require only the signals fall detection actually uses (rpy + gyro). accel is
    // optional — gating the whole reading on a field nobody reads would silently
    // disable the safety net for a robot that reports orientation but no accel.
    if (!rpyVec || !gyroVec) return null;
    const accelVec = _toVec3(accel);
    return accelVec
      ? { rpy: rpyVec, gyro: gyroVec, accel: accelVec }
      : { rpy: rpyVec, gyro: gyroVec };
  }
}

/** Singleton — imported by RobotStateManager */
export const hardwareClient = new HardwareClient();
