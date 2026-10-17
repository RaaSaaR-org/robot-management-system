/**
 * @file vrCameraStatus.ts
 * @description What the VR head-camera panel currently knows about its stream —
 *              live, stale, offline or connecting, why, and when it retries —
 *              published for the views that are not the panel (TASK-401).
 * @feature robots
 */

import { create } from 'zustand';
import type { CameraPanelState } from './vrCamera';

export interface VrCameraStatus {
  /** The robot the panel is showing, or null when no panel is mounted. */
  robotId: string | null;
  state: CameraPanelState;
  /** Why the stream is offline, in the agent's words, or null. */
  detail: string | null;
  /** Whole seconds until the next reconnect attempt, or null when none is due. */
  retryInS: number | null;
  /** Distinct frames per second reaching the panel, or null before the first. */
  fps: number | null;
}

interface VrCameraStatusStore extends VrCameraStatus {
  /** Merge a partial update. A no-op when nothing in it changed. */
  publish: (next: Partial<VrCameraStatus>) => void;
  /** Back to "no panel" — called when the panel unmounts. */
  reset: () => void;
}

const INITIAL: VrCameraStatus = {
  robotId: null,
  state: 'connecting',
  detail: null,
  retryInS: null,
  fps: null,
};

/**
 * Written ONLY by `HeadCameraPanel`. Read by whatever needs the panel's view of
 * the camera without being inside the XR scene — the VR robot panel and the
 * session page (TASK-413, TASK-414).
 *
 * The panel publishes from its render loop, so `publish` compares before it
 * sets: a store update per headset frame would re-render every subscriber
 * 72-120 times a second for nothing.
 */
export const useVrCameraStatus = create<VrCameraStatusStore>()((set, get) => ({
  ...INITIAL,
  publish: (next) => {
    const current = get();
    const delta: Partial<VrCameraStatus> = {};
    for (const key of Object.keys(next) as Array<keyof VrCameraStatus>) {
      const value = next[key];
      if (value !== undefined && value !== current[key]) Object.assign(delta, { [key]: value });
    }
    if (Object.keys(delta).length > 0) set(delta);
  },
  reset: () => set(INITIAL),
}));
