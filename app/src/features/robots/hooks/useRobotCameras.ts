/**
 * @file useRobotCameras.ts
 * @description Live list of the cameras a robot can actually serve.
 * @feature robots
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchRobotCameras, type RobotCameraList } from '../api/cameraApi';

export interface RobotCamerasState extends RobotCameraList {
  /** True until the first answer arrives — distinct from "answered: none". */
  loading: boolean;
  /** Ask again now (a camera was just plugged in). */
  refresh: () => void;
}

/**
 * Poll a robot's camera list (TASK-233).
 *
 * Polled rather than fetched once because the answer changes underneath a
 * running robot: attaching a RealSense to the bridge machine makes a camera
 * appear without anything restarting, and an operator staring at an empty
 * camera panel is exactly the person who just plugged one in.
 *
 * @param robotId    null to ask nothing.
 * @param intervalMs 0 disables polling (one fetch only).
 */
export function useRobotCameras(robotId: string | null, intervalMs = 15000): RobotCamerasState {
  const [state, setState] = useState<RobotCameraList & { loading: boolean }>({
    cameras: [],
    source: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!robotId) {
      setState({ cameras: [], source: null, loading: false });
      return;
    }
    let cancelled = false;
    const load = () => {
      fetchRobotCameras(robotId)
        .then((list) => {
          if (!cancelled) setState({ ...list, loading: false });
        })
        .catch(() => {
          // A failed list is itself an answer the operator can read. It must not
          // leave `loading` true, or the panel would claim it is still asking.
          if (!cancelled) {
            setState({
              cameras: [],
              source: null,
              detail: 'could not reach the server to ask which cameras exist',
              loading: false,
            });
          }
        });
    };
    load();
    if (intervalMs <= 0) return () => { cancelled = true; };
    const timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [robotId, intervalMs, nonce]);

  return { ...state, refresh };
}
