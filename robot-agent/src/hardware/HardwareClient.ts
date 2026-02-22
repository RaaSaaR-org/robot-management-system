/**
 * @file HardwareClient.ts
 * @description HTTP client for the SO-101 hardware sidecar (so101_sidecar.py).
 *              Polls real joint states and forwards actions to the real arm.
 * @feature hardware
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
}

/** Singleton — imported by RobotStateManager */
export const hardwareClient = new HardwareClient();
