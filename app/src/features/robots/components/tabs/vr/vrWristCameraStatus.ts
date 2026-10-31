/**
 * @file vrWristCameraStatus.ts
 * @description What each VR wrist panel knows about its stream, keyed by camera
 *              name (TASK-443). Kept apart from `useVrCameraStatus` on purpose:
 *              that store is the head camera's alone, and the robot panel and
 *              the session page read it as "the camera" — a wrist going stale
 *              must never read as the head camera going stale.
 * @feature robots
 */

import { create } from 'zustand';
import type { VrCameraStatus } from './vrCameraStatus';

interface VrWristCameraStatusStore {
  /** One entry per mounted wrist panel, by camera name. */
  cameras: Record<string, VrCameraStatus>;
  /** Merge a partial update into one camera's entry. A no-op when nothing changed. */
  publish: (camera: string, next: Partial<VrCameraStatus>) => void;
  /** Drop one camera's entry — called when its panel unmounts. */
  remove: (camera: string) => void;
}

const INITIAL: VrCameraStatus = {
  robotId: null,
  state: 'connecting',
  detail: null,
  retryInS: null,
  fps: null,
};

/**
 * Written ONLY by `WristCameraPanels`. Compares before it sets, for the reason
 * `useVrCameraStatus` does: the panels publish from their render loop.
 */
export const useVrWristCameraStatus = create<VrWristCameraStatusStore>()((set, get) => ({
  cameras: {},
  publish: (camera, next) => {
    const current = get().cameras[camera] ?? INITIAL;
    const delta: Partial<VrCameraStatus> = {};
    for (const key of Object.keys(next) as Array<keyof VrCameraStatus>) {
      const value = next[key];
      if (value !== undefined && value !== current[key]) Object.assign(delta, { [key]: value });
    }
    if (Object.keys(delta).length === 0 && get().cameras[camera]) return;
    set({ cameras: { ...get().cameras, [camera]: { ...current, ...delta } } });
  },
  remove: (camera) => {
    if (!(camera in get().cameras)) return;
    const rest = { ...get().cameras };
    delete rest[camera];
    set({ cameras: rest });
  },
}));
