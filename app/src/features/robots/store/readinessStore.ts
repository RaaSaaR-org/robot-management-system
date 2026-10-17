/**
 * @file readinessStore.ts
 * @description The latest `robot:readiness` snapshot per robot (TASK-411),
 *              written by the app's robot socket (`useRobotWebSocket`) and by
 *              the readiness hook's GET fallback, plus whether that socket is
 *              open — the hook polls only while it is not.
 * @feature robots
 */

import { create } from 'zustand';
import type { RobotReadiness } from '../api/readinessApi';

export interface ReadinessEntry {
  readiness: RobotReadiness;
  /** `Date.now()` when this console received it. */
  receivedAt: number;
}

interface ReadinessStore {
  byRobot: Record<string, ReadinessEntry>;
  /** The global robot socket is open (snapshots arrive by push). */
  socketOpen: boolean;
  put: (readiness: RobotReadiness, receivedAt?: number) => void;
  setSocketOpen: (open: boolean) => void;
  reset: () => void;
}

export const useReadinessStore = create<ReadinessStore>()((set) => ({
  byRobot: {},
  socketOpen: false,
  put: (readiness, receivedAt = Date.now()) =>
    set((s) => ({ byRobot: { ...s.byRobot, [readiness.robotId]: { readiness, receivedAt } } })),
  setSocketOpen: (open) => set((s) => (s.socketOpen === open ? s : { socketOpen: open })),
  reset: () => set({ byRobot: {}, socketOpen: false }),
}));
