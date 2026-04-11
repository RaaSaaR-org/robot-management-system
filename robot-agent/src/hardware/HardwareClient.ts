/**
 * @file HardwareClient.ts
 * @description HTTP client for the SO-101 hardware sidecar (so101_sidecar.py).
 *              Polls real joint states and forwards actions to the real arm.
 *              TASK-146 extended this with snapshot/getStateNow/sendActionVector
 *              for the TS-owned closed loop.
 * @feature hardware
 * @status live
 */

import type { JointState } from '../robot/types.js';

const SIDECAR_URL = process.env.HARDWARE_SIDECAR_URL ?? 'http://localhost:8765';
// Poll every 2s — avoids monopolizing /dev/ttyACM0 so other tools can use the arm.
// Idle watchdog in the sidecar disconnects after 5s without requests, releasing the port.
const POLL_INTERVAL_MS = 2000;

export class HardwareClient {
  private connected = false;
  private sidecarAvailable = false;
  private jointStates: JointState[] = [];
  private pollTimer: NodeJS.Timeout | null = null;

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
   * Synchronous joint read (unlike the 2s `jointStates` poll). Uses the
   * sidecar's /state/fast endpoint, which skips the between-read torque
   * disable so the arm holds position during a closed-loop run.
   *
   * Returns a 6-element vector in the canonical SO-101 joint order:
   * [shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper]
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
    const order = [
      'shoulder_pan',
      'shoulder_lift',
      'elbow_flex',
      'wrist_flex',
      'wrist_roll',
      'gripper',
    ];
    const byName = new Map(data.joints.map((j) => [j.name, j.position]));
    return order.map((n) => byName.get(n) ?? 0);
  }

  /**
   * Send an action vector in the canonical SO-101 joint order
   * (see `getStateNow`). Wraps `sendAction` with the naming.
   */
  async sendActionVector(action: number[]): Promise<void> {
    const order = [
      'shoulder_pan',
      'shoulder_lift',
      'elbow_flex',
      'wrist_flex',
      'wrist_roll',
      'gripper',
    ];
    const joints: Record<string, number> = {};
    for (let i = 0; i < order.length && i < action.length; i++) {
      joints[order[i]] = action[i];
    }
    await this.sendAction(joints);
  }
}

/** Singleton — imported by RobotStateManager */
export const hardwareClient = new HardwareClient();
