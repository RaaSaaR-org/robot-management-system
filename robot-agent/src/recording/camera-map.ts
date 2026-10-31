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

/**
 * The dataset keys a policy can be trained on that name a robot-mounted view.
 * Only these are looked up by name; any other policy camera name (SmolVLA's
 * `up`/`side`, the apple configs' `ego_view`) has no camera of its own and
 * gets the head camera.
 */
const POLICY_VIEW_KEYS: ReadonlySet<string> = new Set([
  'cam_right_high',
  'cam_left_high',
  'cam_left_wrist',
  'cam_right_wrist',
]);

/**
 * The inverse of {@link datasetCameraKey} for a running policy: which of the
 * cameras a sidecar lists fills the policy camera `policyKey`.
 *
 * - A Unitree view key gets the listed camera that maps to it — `cam_left_high`
 *   gets `ego_camera`, `cam_left_wrist` only `left_wrist_camera`.
 * - Everything else, and a view key no listed camera maps to, gets the head
 *   camera: the camera that maps to `cam_right_high`, or the FIRST listed one
 *   when none does. That one fallback is the only place list order matters.
 * - An empty list gives `undefined`; the caller decides what a missing frame is.
 *
 * The match is chosen from the cameras in sorted order, so two cameras that
 * resolve to one key (no scene has that today) still pick the same one
 * whatever order the sidecar listed them in.
 */
export function sceneCameraForPolicyKey(
  scene: string | null | undefined,
  policyKey: string,
  cameras: readonly string[],
): string | undefined {
  if (cameras.length === 0) return undefined;
  const sorted = [...cameras].sort();
  const byKey = (key: string): string | undefined =>
    sorted.find((camera) => datasetCameraKey(scene, camera) === key);
  if (POLICY_VIEW_KEYS.has(policyKey)) {
    const match = byKey(policyKey);
    if (match !== undefined) return match;
  }
  return byKey('cam_right_high') ?? cameras[0];
}

/**
 * Which listed camera fills each of a policy's cameras, for a whole policy.
 *
 * A sidecar that lists a robot-mounted view (any camera that maps to a Unitree
 * view key — `head_camera`, `ego_camera`, a wrist) is filled BY NAME through
 * {@link sceneCameraForPolicyKey}. A sidecar that lists none — the SO-101 arm's
 * `['wrist', 'top']` — has no names to match, so it keeps the positional fill
 * it always had: the k-th policy camera gets the k-th listed camera, the last
 * one reused when the policy wants more. Without that, a two-camera SmolVLA
 * policy (`up`, `side`) on an SO-101 would get the wrist frame twice and never
 * see the top camera.
 *
 * An empty list gives `undefined` for every policy camera.
 */
export function policyCameraSources(
  scene: string | null | undefined,
  policyKeys: readonly string[],
  cameras: readonly string[],
): Map<string, string | undefined> {
  const listsRobotView = cameras.some((camera) =>
    POLICY_VIEW_KEYS.has(datasetCameraKey(scene, camera)),
  );
  const sources = new Map<string, string | undefined>();
  policyKeys.forEach((policyKey, i) => {
    sources.set(
      policyKey,
      listsRobotView
        ? sceneCameraForPolicyKey(scene, policyKey, cameras)
        : cameras[Math.min(i, cameras.length - 1)],
    );
  });
  return sources;
}
