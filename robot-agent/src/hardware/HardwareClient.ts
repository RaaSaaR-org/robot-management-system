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
 *
 *              TASK-184 extends the 2s /state poll to the full contract §2
 *              response: per-joint velocity/effort/temperature plus the
 *              imu/touch/battery/odometry field groups (getImu/getTouch/
 *              getBattery/getOdometry/getMotorTemperatures). The default
 *              sidecar URL is embodiment-aware (G1 → :8767, else :8765).
 * @feature hardware
 * @status live
 */

import type {
  BatteryState,
  HandTouch,
  ImuTelemetry,
  JointState,
  OdometryState,
  PointCloudFrame,
  PointCloudSensorType,
  TouchPad,
} from '../robot/types.js';
import { getJointConfig } from '../robot/joint-configs/index.js';
import { config } from '../config/config.js';

/**
 * A single IMU reading from the robot's base, as carried in the sidecar's
 * `/state` response under the `"imu"` key. Orientation is in radians (roll,
 * pitch, yaw), angular rate in rad/s, linear acceleration in m/s². Consumed by
 * the SafetyMonitor for humanoid fall detection.
 */
export interface ImuReading {
  /** Body orientation [roll, pitch, yaw] in radians. REQUIRED — drives the tilt stop. */
  rpy: [number, number, number];
  /**
   * Body angular velocity [wx, wy, wz] in rad/s. OPTIONAL — drives the fast-tip
   * check; if absent the absolute-tilt stop (rpy) still runs, so a robot that
   * reports orientation but no angular rate must NOT have the whole net disabled.
   */
  gyro?: [number, number, number];
  /**
   * Linear acceleration [ax, ay, az] in m/s². OPTIONAL — fall detection consumes
   * only rpy (+ gyro), so a robot reporting orientation but no accel must NOT be
   * treated as "no IMU". Present only when the sidecar reports it.
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

/** Coerce to a finite number, or undefined. Wire fields are never trusted. */
function _toNum(v: unknown): number | undefined {
  const n = Number(v);
  return typeof v === 'number' || typeof v === 'string' ? (Number.isFinite(n) ? n : undefined) : undefined;
}

/** Coerce to an array of finite numbers, or undefined (empty array = undefined). */
function _toNumArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  return out.length > 0 ? out : undefined;
}

// ────────────────────────────────────────────────────────────────
// TASK-184: defensive parsers for the contract §2 /state field groups.
// A malformed / absent group parses to null — NEVER a zero-filled value.
// ────────────────────────────────────────────────────────────────

function _parseImu(v: unknown): ImuTelemetry | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const rpy = _toVec3(o.rpy);
  const gyro = _toVec3(o.gyro);
  const accel = _toVec3(o.accel);
  const temperature = _toNum(o.temperature);
  if (!rpy && !gyro && !accel && temperature === undefined) return null;
  const imu: ImuTelemetry = {};
  if (rpy) imu.rpy = rpy;
  if (gyro) imu.gyro = gyro;
  if (accel) imu.accel = accel;
  if (temperature !== undefined) imu.temperature = temperature;
  return imu;
}

function _parseTouchPads(v: unknown): TouchPad[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const pads: TouchPad[] = [];
  for (const entry of v) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const pressure = _toNumArray(o.pressure);
    if (!pressure) continue; // pressure is the payload — skip pads without it
    const pad: TouchPad = { pressure };
    const temperature = _toNumArray(o.temperature);
    if (temperature) pad.temperature = temperature;
    pads.push(pad);
  }
  return pads.length > 0 ? pads : undefined;
}

function _parseTouch(v: unknown): HandTouch | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const left = _parseTouchPads(o.left);
  const right = _parseTouchPads(o.right);
  if (!left && !right) return null;
  const touch: HandTouch = {};
  if (left) touch.left = left;
  if (right) touch.right = right;
  return touch;
}

function _parseBattery(v: unknown): BatteryState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const soc = _toNum(o.soc);
  if (soc === undefined) return null; // soc is the only required field
  const battery: BatteryState = { soc };
  const voltage = _toNum(o.voltage);
  const current = _toNum(o.current);
  const temperature = _toNum(o.temperature);
  const soh = _toNum(o.soh);
  const cycles = _toNum(o.cycles);
  const cellVoltages = _toNumArray(o.cellVoltages);
  if (voltage !== undefined) battery.voltage = voltage;
  if (current !== undefined) battery.current = current;
  if (temperature !== undefined) battery.temperature = temperature;
  if (soh !== undefined) battery.soh = soh;
  if (cycles !== undefined) battery.cycles = cycles;
  if (cellVoltages) battery.cellVoltages = cellVoltages;
  return battery;
}

function _parseOdometry(v: unknown): OdometryState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const position = _toVec3(o.position);
  if (!position) return null; // position is the only required field
  const odom: OdometryState = { position };
  const rpy = _toVec3(o.rpy);
  const velocity = _toVec3(o.velocity);
  const yawSpeed = _toNum(o.yawSpeed);
  if (rpy) odom.rpy = rpy;
  if (velocity) odom.velocity = velocity;
  if (yawSpeed !== undefined) odom.yawSpeed = yawSpeed;
  return odom;
}

/** Options for starting a sidecar `lerobot-record` session (TASK-179 sentry). */
export interface RecordingStartOptions {
  /** LeRobot dataset repo id, e.g. `sentry/pick-cube-1751900000000`. */
  repoId: string;
  /** Natural-language task label stored with the dataset. */
  task: string;
  /** Number of episodes; a sentry rollout records one long episode. Default 1. */
  numEpisodes?: number;
  /** Per-episode wall clock budget in seconds. Default 60. */
  episodeTimeS?: number;
  /** Recording frame rate. Default 30. */
  fps?: number;
  /** Optional dataset root override on the sidecar host. */
  datasetRoot?: string;
  /** Inter-episode reset time in seconds. Default 5. */
  resetTimeS?: number;
}

export interface RecordingStartResult {
  ok: boolean;
  error?: string;
  /** True when the sidecar refused with 403 (G1 read-only mode). */
  readOnly?: boolean;
  repoId?: string;
  datasetPath?: string;
}

export interface RecordingStopResult {
  ok: boolean;
  error?: string;
  episodesRecorded?: number;
  datasetPath?: string | null;
  exitCode?: number | null;
}

/**
 * Result of a `/loco/*` call. The sidecar's failure codes mean different things
 * and are kept distinct, because they call for different operator action:
 *
 * - **403** → `G1_LOCO_ENABLED != 1` on that sidecar (a telemetry-only process).
 *   Permanent for the life of the process; retrying is pointless. Flagged as
 *   {@link locoDisabled}.
 * - **503** → SDK missing, DDS down, or the RPC went unanswered. Transient-ish;
 *   the body carries the real reason.
 * - **400** → the request itself was malformed (e.g. a missing `duration_s`).
 *
 * The sidecar's `error` text is always surfaced verbatim so a block can fail
 * honestly instead of pretending the robot moved.
 */
export interface LocoResult {
  ok: boolean;
  error?: string;
  /** True only for HTTP 403 — locomotion is switched off on this sidecar. */
  locoDisabled?: boolean;
  /** Unitree RPC status code echoed by the sidecar on success. */
  rpcCode?: number;
}

/** Planar base pose from `GET /loco/odom` (`rt/odommodestate`). */
export interface LocoOdometry {
  /** Base x in metres, world frame. */
  x: number;
  /** Base y in metres, world frame. */
  y: number;
  /** Base yaw in **radians**, CCW positive (DDS convention). */
  yaw: number;
  /** Where the sidecar got it from, e.g. `rt/odommodestate` or `sim`. */
  source: string;
}

/** Named high-level arm/loco actions the sidecar maps onto LocoClient calls. */
export type LocoActionName = 'wave' | 'shake' | 'stop';

export interface RecordingStatus {
  running: boolean;
  repoId: string | null;
  datasetPath: string | null;
  episodesDone: number;
  elapsedS: number;
  lastError: string | null;
  uploadStatus: string | null;
}

/**
 * Default sidecar port depends on the active embodiment: the G1 sidecar
 * (g1_sidecar.py) listens on :8767, the SO-101 sidecar (so101_sidecar.py) on
 * :8765. `HARDWARE_SIDECAR_URL` always wins. Resolved lazily (memoized) instead
 * of at module load so the URL never depends on import order relative to
 * config/env initialization.
 */
let _sidecarUrl: string | null = null;
export function getSidecarUrl(): string {
  if (_sidecarUrl === null) {
    const fromEnv = process.env.HARDWARE_SIDECAR_URL;
    if (fromEnv) {
      _sidecarUrl = fromEnv;
    } else if (config.robotType === 'g1' || config.robotType === 'g1_edu') {
      _sidecarUrl = 'http://localhost:8767';
    } else {
      _sidecarUrl = 'http://localhost:8765';
    }
  }
  return _sidecarUrl;
}

// Poll every 2s — avoids monopolizing /dev/ttyACM0 so other tools can use the arm.
// Idle watchdog in the sidecar disconnects after 5s without requests, releasing the port.
const POLL_INTERVAL_MS = 2000;

export class HardwareClient {
  private connected = false;
  private sidecarAvailable = false;
  private jointStates: JointState[] = [];
  private pollTimer: NodeJS.Timeout | null = null;
  /** Fired on every real-robot attach/detach transition (agent-card/identity re-report). */
  private connectionListeners = new Set<(connected: boolean) => void>();
  /** Ordered joint names for the active embodiment; resolved lazily, then cached. */
  private jointOrder: string[] | null = null;
  // TASK-184: latest contract §2 field groups from the 2s /state poll. A group
  // the sidecar omitted (stale source) is null — consumers must treat null as
  // "no fresh data", never substitute zeros.
  private imu: ImuTelemetry | null = null;
  private touch: HandTouch | null = null;
  private battery: BatteryState | null = null;
  private odometry: OdometryState | null = null;

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

  /**
   * Subscribe to hardware attach/detach transitions. The callback fires only
   * on actual changes of `isConnected()`, never on every poll. Returns an
   * unsubscribe function.
   */
  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.connectionListeners.add(cb);
    return () => this.connectionListeners.delete(cb);
  }

  /** Set the connected flag, notifying listeners on transitions only. */
  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    for (const cb of this.connectionListeners) {
      try {
        cb(connected);
      } catch (err) {
        console.error('[Hardware] Connection listener error:', err);
      }
    }
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
      const res = await fetch(`${getSidecarUrl()}/health`, { signal: AbortSignal.timeout(2000) });
      const data = (await res.json()) as { status: string; connected: boolean };
      this.sidecarAvailable = data.status === 'ok';
      this.setConnected(data.connected);
      if (this.sidecarAvailable) {
        console.log(`[Hardware] Sidecar reachable — arm connected: ${this.connected}`);
        if (!this.pollTimer) this.startPolling();
      }
    } catch {
      this.sidecarAvailable = false;
      this.setConnected(false);
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
        const res = await fetch(`${getSidecarUrl()}/state`, { signal: AbortSignal.timeout(500) });
        const data = (await res.json()) as Record<string, unknown>;
        // Contract §2 carries an explicit `connected`; older sidecars only send
        // `simulated` — accept either, defensively.
        this.setConnected(
          typeof data.connected === 'boolean' ? data.connected : data.simulated === false
        );
        // Joints: velocity/effort/temperature are OPTIONAL on the wire — carry
        // them through only when present (never fabricate zeros).
        const joints = Array.isArray(data.joints) ? data.joints : [];
        this.jointStates = joints.flatMap((j: unknown): JointState[] => {
          if (!j || typeof j !== 'object') return [];
          const o = j as Record<string, unknown>;
          const position = _toNum(o.position);
          if (typeof o.name !== 'string' || position === undefined) return [];
          const js: JointState = { name: o.name, position };
          const velocity = _toNum(o.velocity);
          const effort = _toNum(o.effort);
          const temperature = _toNum(o.temperature);
          if (velocity !== undefined) js.velocity = velocity;
          if (effort !== undefined) js.effort = effort;
          if (temperature !== undefined) js.temperature = temperature;
          return [js];
        });
        // Field groups (TASK-184): the sidecar OMITS a group when its source is
        // stale, so an absent/malformed group resets the cache to null.
        this.imu = _parseImu(data.imu);
        this.touch = _parseTouch(data.touch);
        this.battery = _parseBattery(data.battery);
        this.odometry = _parseOdometry(data.odometry);
      } catch {
        // sidecar went away — stop polling and schedule reconnect
        this.sidecarAvailable = false;
        this.setConnected(false);
        this.stopPolling();
        console.log('[Hardware] Lost connection to sidecar — retrying in 10s');
        this._scheduleRetry();
        // NOTE: jointStates kept intact so the 3D viewer shows last known pose
        //       instead of jumping to simulated defaults during brief reconnects.
        //       The sensor groups are DROPPED instead — stale IMU/battery/touch
        //       data must never keep driving telemetry or safety decisions.
        this.imu = null;
        this.touch = null;
        this.battery = null;
        this.odometry = null;
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

  // ────────────────────────────────────────────────────────────────
  // TASK-184: cached field-group accessors (fed by the 2s /state poll).
  // null = no fresh data from the sidecar — callers must fall back to
  // their simulated value (and keep the group marked as simulated),
  // never treat null as zeros.
  // ────────────────────────────────────────────────────────────────

  /** Latest base IMU sample from the poll, or null when the group is stale. */
  getImu(): ImuTelemetry | null {
    return this.imu;
  }

  /** Latest Dex3 touch-pad readings, or null (e.g. no hands / stale). */
  getTouch(): HandTouch | null {
    return this.touch;
  }

  /** Latest battery/BMS state, or null when the BMS topic is absent/stale. */
  getBattery(): BatteryState | null {
    return this.battery;
  }

  /** Latest odometry sample, or null when the odom topic is absent/stale. */
  getOdometry(): OdometryState | null {
    return this.odometry;
  }

  /**
   * Joint-name → motor temperature (°C) map built from the polled joint states.
   * Only joints that actually reported a temperature are included; null when
   * none did (SO-101, or a G1 sidecar without fresh lowstate).
   */
  getMotorTemperatures(): Record<string, number> | null {
    const out: Record<string, number> = {};
    let any = false;
    for (const j of this.jointStates) {
      if (j.temperature !== undefined) {
        out[j.name] = j.temperature;
        any = true;
      }
    }
    return any ? out : null;
  }

  async sendAction(joints: Record<string, number>): Promise<void> {
    if (!this.sidecarAvailable) return;
    await fetch(`${getSidecarUrl()}/action`, {
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
    const res = await fetch(`${getSidecarUrl()}/cameras`, {
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
   * closed loop when it needs fresh frames for `/predict`, and by Agent Mode's
   * `look` / `scan_room` blocks.
   *
   * Wire-key note (TASK-194): so101_sidecar.py returns `image_b64`, while
   * g1_sidecar.py's `_snapshot()` returns **`jpeg_base64`**. Both are accepted —
   * before this, every G1 snapshot failed with a misleading "empty response".
   * The sidecar's `error` text is surfaced verbatim instead of being swallowed.
   */
  async snapshot(name: string): Promise<string> {
    const res = await fetch(`${getSidecarUrl()}/cameras/${encodeURIComponent(name)}/snapshot`, {
      signal: AbortSignal.timeout(1500),
    });
    const data = (await res.json().catch(() => ({}))) as {
      image_b64?: string;
      jpeg_base64?: string;
      ok?: boolean;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(
        `Sidecar snapshot ${name} failed: HTTP ${res.status}${data.error ? ` — ${data.error}` : ''}`
      );
    }
    const b64 = data.image_b64 ?? data.jpeg_base64;
    if (!b64) {
      throw new Error(
        `Sidecar snapshot ${name}: ${data.error ?? 'response carried neither image_b64 nor jpeg_base64'}`
      );
    }
    return b64;
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
    const res = await fetch(`${getSidecarUrl()}/pointcloud/sensors`, {
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
    const res = await fetch(`${getSidecarUrl()}/pointcloud/${encodeURIComponent(name)}/snapshot`, {
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
   * Toggle the G1's head LiDAR via the sidecar (rt/utlidar/switch). A pure
   * sensor enable — commands no robot motion; the single authorized write
   * while the read-only stage is active. Timeout is generous because the
   * sidecar repeats the DDS write for ~3 s to ride out discovery.
   */
  async setLidarSwitch(on: boolean): Promise<{ ok: boolean; lidar?: string; error?: string }> {
    const res = await fetch(`${getSidecarUrl()}/pointcloud/lidar/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { ok?: boolean; lidar?: string; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `Sidecar LiDAR switch returned HTTP ${res.status}` };
    }
    return { ok: true, lidar: data.lidar };
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
    const res = await fetch(`${getSidecarUrl()}/state/fast`, {
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
   * Strict on rpy — the absolute-tilt stop runs on orientation alone, and a
   * zero-filled reading could mask a fall, so rpy is never fabricated. gyro
   * (fast-tip) and accel are optional refinements: a robot that reports rpy but
   * not gyro/accel keeps the tilt net armed rather than having it disabled.
   */
  async getImuNow(): Promise<ImuReading | null> {
    let data: { imu?: unknown };
    try {
      const res = await fetch(`${getSidecarUrl()}/state`, {
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
    // Require only rpy — the absolute-tilt stop runs on orientation alone. gating
    // the whole reading on gyro/accel would silently disable the tilt net for a
    // robot that reports orientation but not angular rate / acceleration.
    if (!rpyVec) return null;
    const gyroVec = _toVec3(gyro);
    const accelVec = _toVec3(accel);
    const reading: ImuReading = { rpy: rpyVec };
    if (gyroVec) reading.gyro = gyroVec;
    if (accelVec) reading.accel = accelVec;
    return reading;
  }

  // ────────────────────────────────────────────────────────────────
  // TASK-179: sidecar dataset recording (lerobot-record wrapper).
  // Used by the `sentry` rollout strategy to capture a real-hardware
  // rollout as a LeRobot dataset. Both sidecars expose the same
  // /record/start | /record/stop | /record/status surface
  // (so101_sidecar.py / g1_sidecar.py → hardware/recorder.py).
  // All three methods are best-effort and NEVER throw — a rollout must
  // not die because its recording sidecar call failed.
  // ────────────────────────────────────────────────────────────────

  /**
   * Start a sidecar recording session. The sidecar wraps `lerobot-record`
   * and takes exclusive ownership of the cameras (and, on SO-101, the
   * follower serial port) for the duration.
   *
   * Returns `ok: false` with `readOnly: true` when the sidecar refuses with
   * HTTP 403 (G1 stage-1 read-only mode, `G1_READ_ONLY=1`) — callers should
   * continue un-recorded rather than fail the rollout.
   */
  async startRecording(opts: RecordingStartOptions): Promise<RecordingStartResult> {
    if (!this.sidecarAvailable) {
      return { ok: false, error: 'hardware sidecar unavailable' };
    }
    try {
      const res = await fetch(`${getSidecarUrl()}/record/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_id: opts.repoId,
          task: opts.task,
          num_episodes: opts.numEpisodes ?? 1,
          episode_time_s: opts.episodeTimeS ?? 60,
          fps: opts.fps ?? 30,
          reset_time_s: opts.resetTimeS ?? 5,
          ...(opts.datasetRoot ? { dataset_root: opts.datasetRoot } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        repo_id?: string;
        dataset_path?: string;
      };
      if (res.status === 403) {
        return {
          ok: false,
          readOnly: true,
          error: data.error ?? 'sidecar is read-only (G1_READ_ONLY) — recording refused',
        };
      }
      if (!res.ok || data.ok === false) {
        return { ok: false, error: data.error ?? `sidecar /record/start returned HTTP ${res.status}` };
      }
      return { ok: true, repoId: data.repo_id ?? opts.repoId, datasetPath: data.dataset_path };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Stop the active sidecar recording (SIGINT → clean episode finalization,
   * then the sidecar auto-uploads the finished dataset to RustFS). The
   * sidecar's stop path can block up to ~20s while lerobot-record finalizes,
   * so the request timeout is generous.
   */
  async stopRecording(): Promise<RecordingStopResult> {
    try {
      const res = await fetch(`${getSidecarUrl()}/record/stop`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        episodes_recorded?: number;
        dataset_path?: string | null;
        exit_code?: number | null;
      };
      if (!res.ok || data.ok === false) {
        return { ok: false, error: data.error ?? `sidecar /record/stop returned HTTP ${res.status}` };
      }
      return {
        ok: true,
        episodesRecorded: data.episodes_recorded ?? 0,
        datasetPath: data.dataset_path ?? null,
        exitCode: data.exit_code ?? null,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Current recorder status (progress, dataset path, RustFS upload state).
   * Returns null when the sidecar is unreachable.
   */
  async getRecordingStatus(): Promise<RecordingStatus | null> {
    try {
      const res = await fetch(`${getSidecarUrl()}/record/status`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        running?: boolean;
        repo_id?: string | null;
        dataset_path?: string | null;
        episodes_done?: number;
        elapsed_s?: number;
        last_error?: string | null;
        upload_status?: string | null;
      };
      return {
        running: data.running ?? false,
        repoId: data.repo_id ?? null,
        datasetPath: data.dataset_path ?? null,
        episodesDone: data.episodes_done ?? 0,
        elapsedS: data.elapsed_s ?? 0,
        lastError: data.last_error ?? null,
        uploadStatus: data.upload_status ?? null,
      };
    } catch {
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // TASK-194: LocoClient facade (`/loco/*` on g1_sidecar.py, port 8767).
  //
  // Identical call path in simulation and on the real G1 EDU: the sidecar
  // either talks to the onboard FSM (hardware) or to our own DDS `sport`
  // service shim (sim). All four endpoints answer 503 with a clear `error`
  // when the SDK/DDS is unavailable or `G1_LOCO_ENABLED` is off; none of these
  // methods throw — the caller turns `ok:false` into a failed block.
  // ────────────────────────────────────────────────────────────────

  /** Shared POST helper for the `/loco/*` endpoints. Never throws. */
  private async _loco(
    path: string,
    body: Record<string, unknown>,
    timeoutMs: number
  ): Promise<LocoResult> {
    try {
      const res = await fetch(`${getSidecarUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        rpc_code?: number;
      };
      if (res.status === 403) {
        return {
          ok: false,
          locoDisabled: true,
          error:
            data.error ??
            'locomotion is not enabled on this robot (G1_LOCO_ENABLED is off on the sidecar)',
        };
      }
      if (!res.ok || data.ok === false) {
        return {
          ok: false,
          error: data.error ?? `sidecar ${path} returned HTTP ${res.status}`,
        };
      }
      return typeof data.rpc_code === 'number' ? { ok: true, rpcCode: data.rpc_code } : { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: `sidecar ${path} unreachable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * `LocoClient.SetVelocity(vx, vy, omega, duration)` — a planar base velocity
   * held for `durationS` seconds. vx/vy are m/s in the robot frame (+x forward,
   * +y left), omega is rad/s (CCW positive).
   *
   * The request timeout covers the whole motion plus slack, because the sidecar
   * is free to either return immediately or block for the duration; callers
   * additionally wait out any remaining wall-clock time themselves.
   */
  async locoMove(vx: number, vy: number, omega: number, durationS: number): Promise<LocoResult> {
    return this._loco(
      '/loco/move',
      { vx, vy, omega, duration_s: durationS },
      Math.round(durationS * 1000) + 5_000
    );
  }

  /** `LocoClient.WaveHand` / `ShakeHand` / `StopMove` by name. */
  async locoAction(name: LocoActionName, args?: Record<string, unknown>): Promise<LocoResult> {
    return this._loco('/loco/action', args ? { name, args } : { name }, 15_000);
  }

  /**
   * `LocoClient.SetFsmId(id)` — posture switch (stand / high / low / sit / damp).
   * The numeric ids live in `agent-mode/block-executor.ts` (`G1_FSM_IDS`).
   */
  async locoFsm(id: number): Promise<LocoResult> {
    return this._loco('/loco/fsm', { id }, 10_000);
  }

  /**
   * `LocoClient.SetStandHeight()` — how tall the robot stands.
   *
   * Deliberately NOT `locoFsm`: standing height is a separate RPC (api 7104) and
   * there is no high-stand/low-stand entry in the FSM table, so routing
   * `posture: high|low` through an FSM id would mean guessing an id and sending
   * it to a 43-DOF humanoid.
   */
  async locoStandHeight(preset: 'high' | 'low'): Promise<LocoResult> {
    return this._loco('/loco/stand-height', { preset }, 10_000);
  }

  /** `LocoClient.StopMove()` — zero the base velocity immediately. */
  async locoStop(): Promise<LocoResult> {
    return this.locoAction('stop');
  }

  /**
   * Planar base pose from `GET /loco/odom`. Returns null when the sidecar is
   * unreachable or reports `ok:false` — callers must treat null as "no odometry"
   * and fall back to dead reckoning *explicitly*, never fabricate a pose.
   */
  async getLocoOdometry(): Promise<LocoOdometry | null> {
    try {
      const res = await fetch(`${getSidecarUrl()}/loco/odom`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        ok?: boolean;
        x?: unknown;
        y?: unknown;
        yaw?: unknown;
        source?: unknown;
      };
      if (data.ok === false) return null;
      const x = _toNum(data.x);
      const y = _toNum(data.y);
      const yaw = _toNum(data.yaw);
      if (x === undefined || y === undefined || yaw === undefined) return null;
      return { x, y, yaw, source: typeof data.source === 'string' ? data.source : 'unknown' };
    } catch {
      return null;
    }
  }

  /**
   * Best-effort soft E-stop: POST the sidecar's `/estop`, which clears the action
   * ramp so a later command re-seeds the ramp from the true pose. The safety loop
   * calls this to propagate a protective stop to the hardware command path. Never
   * throws — if the sidecar is unreachable there is nothing more to do here.
   *
   * ⚠️ SOFT stop (ramp reset), NOT a physical motor cut. Real-hardware bring-up
   * still needs Unitree's damping/E-stop mode + a safety gantry.
   */
  async sendEstop(): Promise<void> {
    try {
      await fetch(`${getSidecarUrl()}/estop`, {
        method: 'POST',
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      // Sidecar unreachable / timeout — best-effort only.
    }
  }
}

/** Singleton — imported by RobotStateManager */
export const hardwareClient = new HardwareClient();
