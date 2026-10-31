/**
 * @file readiness-routes.ts
 * @description `GET /robots/:id/readiness` (TASK-405): one read-only snapshot
 *              of everything that decides whether a G1's arms follow the
 *              operator — the sidecar (reachable vs. lowstate fresh), the
 *              measured mode, the arm write path, each Dex3 hand, the control
 *              lease, the cameras, whether battery/IMU are synthetic — plus the
 *              single ordered "why not following" line the VR HUD shows.
 *
 *              A route file of its own (D4): `rest-routes.ts` is edited by
 *              another task in the same wave. Mounted next to it in `index.ts`.
 * @feature readiness
 * @status live
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { RobotStateManager } from '../robot/state.js';
import { hardwareClient, getSidecarUrl, type HardwareClient } from '../hardware/HardwareClient.js';
import { armRegistry, type ArmRegistry } from '../teleop/arm-registry.js';
import { controlLease, type ControlLeaseRegistry } from '../control-lease/control-lease.js';
import { readCameraList, SIDECAR_UNREACHABLE_DETAIL, type CameraListResult } from '../hardware/camera-list.js';
import { BASE_STATE_FRESH_S, type BaseModeName, type LocoCapability } from '../hardware/base-mode.js';
import type { HandHealth } from '../hardware/arm-status.js';
import { explainNotFollowing, type NotFollowingInput, type NotFollowingReason } from '../readiness/why-not-following.js';

/** The slices of the agent's singletons this route reads. */
export interface ReadinessDeps {
  robot: Pick<RobotStateManager, 'getRobotInterface' | 'isEStopTriggered' | 'getTelemetry'>;
  hardware: Pick<
    HardwareClient,
    | 'isSidecarReachable'
    | 'isConnected'
    | 'getArmStatus'
    | 'refreshArmStatus'
    | 'lastHealth'
    | 'getLocoCapability'
    | 'getBaseState'
    | 'getLastKnownSensors'
    | 'getSidecarBootId'
    | 'lastHealthAt'
  >;
  arms: Pick<ArmRegistry, 'view'>;
  leases: Pick<ControlLeaseRegistry, 'observe'>;
  cameras: () => Promise<CameraListResult>;
  sidecarUrl: () => string;
  now: () => number;
}

/** A fresh `/health` read must not hold the 1 Hz readiness poll for long. */
const HEALTH_TIMEOUT_MS = 800;
/** Resolving a camera source can take ~2 s on a robot that is off; ask rarely. */
const CAMERA_TIMEOUT_MS = 2500;
export const CAMERA_CACHE_MS = 10_000;

export interface ReadinessSnapshot {
  robotId: string;
  at: string;
  simulated: boolean;
  sidecar: {
    reachable: boolean;
    connected: boolean;
    url: string;
    lowstateAgeS: number | null;
    writeMode: 'read_only' | 'arm_sdk' | null;
    readOnly: boolean;
    bootId: string | null;
    sim: boolean;
    /** The values below are the last ones seen before the sidecar went away. */
    stale: boolean;
    /** ISO time of the last `/health` read; null = never. */
    lastHealthAt: string | null;
  };
  base: {
    gate: LocoCapability['gate'];
    mode: BaseModeName;
    fsmId: number | null;
    ageS: number | null;
    error: string | null;
    stale: boolean;
  } | null;
  arms: {
    armState: string | null;
    armed: boolean;
    arming: boolean;
    armWeight: number;
    deadman: 'ok' | 'hold' | null;
    lastDisarmReason: string | null;
    trackErrRad: number | null;
    trackErrJoint: string | null;
    estopLatched: boolean;
    sidecarEstopLatched: boolean;
    claims: number;
    lastError: string | null;
  };
  hands: { left: HandHealth; right: HandHealth } | null;
  lease: {
    enforced: boolean;
    state: string;
    holder: { userId: string | null; displayName: string | null } | null;
    bound: number;
  };
  /** `configured`: every camera the robot is set up for, when the sidecar says (TASK-445). */
  camera: { source: string | null; cameras: string[]; detail: string | null; configured?: string[] };
  telemetrySynthetic: boolean;
  reason: NotFollowingReason;
}

function portOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.port || (u.protocol === 'https:' ? '443' : '80');
  } catch {
    return null;
  }
}

/** The mode the reason rules see: a stale or missing reading is `unknown`. */
function modeForRules(
  base: ReadinessSnapshot['base'],
  fsm: { id: number | null; ageS: number | null } | null | undefined,
  loco: LocoCapability,
): NotFollowingInput['mode'] {
  if (base && !base.stale && base.mode !== 'unknown' && base.ageS !== null && base.ageS <= BASE_STATE_FRESH_S) {
    return { name: base.mode, error: null };
  }
  // No usable `base` block: the arm path's own FSM reading, mapped through the
  // ids the sidecar resolved (only when it did — never a guessed id table).
  if (fsm && fsm.id !== null && fsm.ageS !== null && fsm.ageS <= BASE_STATE_FRESH_S && loco.ids) {
    const { limp, stand, balance, balanceReported } = loco.ids;
    if (fsm.id === balance || balanceReported.includes(fsm.id)) return { name: 'balance', error: null };
    if (fsm.id === stand) return { name: 'stand', error: null };
    if (fsm.id === limp) return { name: 'limp', error: null };
    return { name: 'other', error: null };
  }
  if (!base) return null;
  if (base.stale || (base.ageS !== null && base.ageS > BASE_STATE_FRESH_S)) {
    return { name: 'unknown', error: base.ageS !== null ? `reading ${Math.round(base.ageS)} s old` : 'stale reading' };
  }
  return { name: 'unknown', error: base.error ?? (base.ageS === null ? 'no reading' : null) };
}

/** A readiness router; every dependency defaults to the agent's singleton. */
export function createReadinessRoutes(
  deps: Partial<ReadinessDeps> & Pick<ReadinessDeps, 'robot'>,
): Router {
  const d: ReadinessDeps = {
    hardware: hardwareClient,
    arms: armRegistry,
    leases: controlLease,
    cameras: () => readCameraList({ timeoutMs: CAMERA_TIMEOUT_MS }),
    sidecarUrl: getSidecarUrl,
    now: () => Date.now(),
    ...deps,
  };
  const router = Router();

  let cameraCache: { atMs: number; value: ReadinessSnapshot['camera'] } | null = null;
  let cameraInFlight: Promise<ReadinessSnapshot['camera']> | null = null;

  const cameraState = async (reachable: boolean): Promise<ReadinessSnapshot['camera']> => {
    if (!reachable) {
      cameraCache = null;
      return { source: null, cameras: [], detail: SIDECAR_UNREACHABLE_DETAIL };
    }
    if (cameraCache && d.now() - cameraCache.atMs < CAMERA_CACHE_MS) return cameraCache.value;
    cameraInFlight ??= d.cameras().then((list): ReadinessSnapshot['camera'] => {
      switch (list.kind) {
        case 'ok':
          return {
            source: list.source,
            cameras: list.cameras,
            detail: list.detail ?? null,
            ...(list.configured ? { configured: list.configured } : {}),
          };
        case 'bad_status':
          return { source: null, cameras: [], detail: `sidecar answered ${list.status} for the camera list` };
        case 'bad_body':
          return { source: null, cameras: [], detail: 'sidecar camera list was not JSON' };
        case 'read_failed':
          return { source: null, cameras: [], detail: 'camera list read failed' };
        case 'unreachable':
          return { source: null, cameras: [], detail: SIDECAR_UNREACHABLE_DETAIL };
      }
    }).then((value) => {
      // A list that could not be read is asked for again on the next poll.
      cameraCache = value.detail === SIDECAR_UNREACHABLE_DETAIL ? null : { atMs: d.now(), value };
      return value;
    }).finally(() => {
      cameraInFlight = null;
    });
    return cameraInFlight;
  };

  // GET /robots/:id/readiness — read-only; same access as GET /base/mode.
  router.get('/robots/:id/readiness', async (req: Request, res: Response) => {
    const robot = d.robot.getRobotInterface();
    if (req.params.id !== robot.id) {
      res.status(404).json({ code: 'ROBOT_NOT_FOUND', message: `This agent serves robot ${robot.id}` });
      return;
    }

    // A fresh `/health` (GET only) so the line is not up to a poll period old.
    // Skipped while the sidecar is lost — the reconnect loop owns that.
    if (d.hardware.isSidecarReachable()) await d.hardware.refreshArmStatus(HEALTH_TIMEOUT_MS);

    const reachable = d.hardware.isSidecarReachable();
    const camera = await cameraState(reachable);
    const health = d.hardware.lastHealth();
    const arm = d.hardware.getArmStatus();
    const view = d.arms.view();
    const loco = d.hardware.getLocoCapability();
    const lastKnown = d.hardware.getLastKnownSensors(d.now());
    const live = d.hardware.getBaseState(d.now());
    const reading = live ?? lastKnown.base;
    const base: ReadinessSnapshot['base'] = reading
      ? { gate: loco.gate, mode: reading.mode, fsmId: reading.fsmId, ageS: reading.ageS, error: reading.error, stale: live === null }
      : null;
    const lease = d.leases.observe();
    const telemetry = d.robot.getTelemetry();
    const synthetic = (telemetry.simulated ?? []).some((g) => g === 'imu' || g === 'battery');
    const agentEstop = d.robot.isEStopTriggered();
    const url = d.sidecarUrl();
    const sim = (health?.sim ?? false) || arm.sim;
    const hands = arm.handHealth ?? null;

    const reason = explainNotFollowing({
      sidecar: {
        reachable,
        connected: d.hardware.isConnected(),
        sim,
        writeMode: arm.writeMode,
        readOnly: arm.readOnly,
        port: portOf(url),
      },
      estopLatched: agentEstop || arm.estopLatched,
      mode: modeForRules(base, arm.fsm, loco),
      lease: { enforced: lease.enforced, state: lease.state, bound: lease.bound },
      hands,
      arms: {
        armed: view.armed,
        arming: view.arming,
        armWeight: view.armWeight,
        armState: arm.armState ?? null,
        deadman: arm.deadman ?? null,
        lastDisarmReason: arm.lastDisarmReason ?? null,
        trackErrRad: arm.trackErrRad ?? null,
        trackErrJoint: arm.trackErrJoint ?? null,
        claims: view.claims,
      },
    });

    const snapshot: ReadinessSnapshot = {
      robotId: robot.id,
      at: new Date(d.now()).toISOString(),
      simulated: sim || !reachable,
      sidecar: {
        reachable,
        connected: d.hardware.isConnected(),
        url,
        lowstateAgeS: health?.lowstateAgeS ?? arm.lowstateAgeS ?? null,
        writeMode: arm.writeMode,
        readOnly: arm.readOnly,
        bootId: health?.bootId ?? d.hardware.getSidecarBootId(),
        sim,
        stale: lastKnown.stale,
        lastHealthAt: d.hardware.lastHealthAt !== null ? new Date(d.hardware.lastHealthAt).toISOString() : null,
      },
      base,
      arms: {
        armState: arm.armState ?? null,
        armed: view.armed,
        arming: view.arming,
        armWeight: view.armWeight,
        deadman: arm.deadman ?? null,
        lastDisarmReason: arm.lastDisarmReason ?? null,
        trackErrRad: arm.trackErrRad ?? null,
        trackErrJoint: arm.trackErrJoint ?? null,
        estopLatched: agentEstop,
        sidecarEstopLatched: arm.estopLatched,
        claims: view.claims,
        lastError: view.lastError,
      },
      hands,
      lease: {
        enforced: lease.enforced,
        state: lease.state,
        holder: lease.state === 'held' ? { userId: lease.userId, displayName: lease.displayName } : null,
        bound: lease.bound,
      },
      camera,
      telemetrySynthetic: synthetic,
      reason,
    };
    res.json(snapshot);
  });

  return router;
}
