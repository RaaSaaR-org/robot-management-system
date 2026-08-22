/**
 * @file camera-map.ts
 * @description Scene camera name -> LeRobot dataset feature key.
 * @feature recording
 * @status live
 */

/**
 * Why this table exists: the sim's cameras are named for the scene they live in
 * (`house_iso`, `warehouse_follow`), and a dataset column called
 * `observation.images.house_iso` is unloadable by any recipe written for a G1.
 * The Unitree `Unitree_G1_Dex3` config names four:
 * `cam_left_high`, `cam_right_high`, `cam_left_wrist`, `cam_right_wrist`.
 *
 * **`head_camera` maps to `cam_right_high`, and that is a decision, not a
 * measurement.** The sim's head camera is monocular and mounted on the
 * centreline (`pos="0.08 0.0 0.42"`), so it is neither the left nor the right of
 * a stereo pair. It is pinned to the right slot so that a scene which later
 * grows a real stereo pair can add `cam_left_high` beside it without renaming a
 * column that datasets already carry.
 *
 * No scene in this repo defines a wrist camera, so `cam_*_wrist` is never
 * produced. That is a gap in the scenes, not something to paper over by
 * relabelling a third-person view as a wrist view.
 *
 * A scene camera with no entry becomes `cam_<name>` — legible, obviously
 * non-standard, and impossible to mistake for a Unitree key.
 */
const SCENE_CAMERA_KEYS: Record<string, Record<string, string>> = {
  'g1_dex3_house_scene.xml': {
    head_camera: 'cam_right_high',
    house_iso: 'cam_third_person',
    house_overview: 'cam_overview',
    house_follow: 'cam_follow',
  },
  'g1_dex3_room_scene.xml': {
    head_camera: 'cam_right_high',
    room_overview: 'cam_third_person',
  },
  'g1_warehouse_scene.xml': {
    head_camera: 'cam_right_high',
    warehouse_iso: 'cam_third_person',
    warehouse_overview: 'cam_overview',
    warehouse_follow: 'cam_follow',
  },
  'g1_dex3_pickplace_scene.xml': {
    head_camera: 'cam_right_high',
  },
  'g1_apple_pnp_scene.xml': {
    head_camera: 'cam_right_high',
    // The only second robot-mounted view in any scene we have. It is a real
    // egocentric camera, so it earns the other half of the stereo pair.
    ego_camera: 'cam_left_high',
  },
};

/** Applied when the scene is unknown or does not list the camera. */
const DEFAULT_CAMERA_KEYS: Record<string, string> = {
  head_camera: 'cam_right_high',
  ego_camera: 'cam_left_high',
  left_wrist_camera: 'cam_left_wrist',
  right_wrist_camera: 'cam_right_wrist',
};

/** Anything not `[a-z0-9_]` would break a feature key and a file path. */
function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'camera';
}

/**
 * The dataset key for one scene camera, WITHOUT the `observation.images.`
 * prefix. Deterministic and total: every camera name gets a key.
 */
export function datasetCameraKey(scene: string | null | undefined, camera: string): string {
  const table = scene ? SCENE_CAMERA_KEYS[scene] : undefined;
  const mapped = table?.[camera] ?? DEFAULT_CAMERA_KEYS[camera];
  return mapped ?? `cam_${sanitize(camera)}`;
}

/** The full LeRobot feature name for one scene camera. */
export function datasetImageFeature(scene: string | null | undefined, camera: string): string {
  return `observation.images.${datasetCameraKey(scene, camera)}`;
}

/**
 * Map a list of scene cameras, refusing a collision rather than letting two
 * cameras write into one video column. Two scene cameras that both resolve to
 * `cam_right_high` would silently interleave into one mp4.
 */
export function mapCameras(
  scene: string | null | undefined,
  cameras: readonly string[],
): { camera: string; key: string }[] {
  const seen = new Map<string, string>();
  return cameras.map((camera) => {
    const key = datasetCameraKey(scene, camera);
    const clash = seen.get(key);
    if (clash !== undefined) {
      throw new Error(
        `cameras "${clash}" and "${camera}" both map to ${key} in ${scene ?? 'an unknown scene'}`,
      );
    }
    seen.set(key, camera);
    return { camera, key };
  });
}
