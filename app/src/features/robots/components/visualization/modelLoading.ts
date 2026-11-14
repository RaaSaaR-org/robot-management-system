/**
 * @file modelLoading.ts
 * @description Load gate and material pass for the URDF robot model: the model
 *              is revealed only once every mesh has arrived (or a timeout says
 *              "show what there is"), and every mesh gets the model's material
 *              however late it lands (TASK-502).
 * @feature robots
 */

import * as THREE from 'three';

// ============================================================================
// LOAD GATE
// ============================================================================

/**
 * How long a model may stay hidden waiting for its meshes. A hung mesh request
 * must not keep the viewer on the placeholder for good: after this the model
 * is revealed with whatever has loaded, and late meshes still appear.
 */
export const MODEL_REVEAL_TIMEOUT_MS = 20_000;

/**
 * Where a model's load stands.
 * - `loading`: meshes are still arriving; the model is hidden.
 * - `ready`: every item the loader started has ended; the model is shown.
 * - `timeout`: {@link MODEL_REVEAL_TIMEOUT_MS} passed first; the model is shown
 *   with whatever has loaded.
 * - `cancelled`: this load was abandoned (unmount, another robot type).
 */
export interface ModelLoadState {
  phase: 'loading' | 'ready' | 'timeout' | 'cancelled';
  /** Files finished so far (the URDF itself counts as one). */
  loaded: number;
  /** Files the loader has asked for so far. */
  total: number;
}

/** True while the model has to stay hidden. */
export function isModelHidden(state: ModelLoadState | null): boolean {
  return state?.phase === 'loading';
}

/**
 * What a viewer says while the model is hidden, or null when there is nothing
 * to say. The count appears once the URDF has parsed and named its meshes —
 * before that the only file known is the URDF itself.
 */
export function modelLoadLabel(state: ModelLoadState | null): string | null {
  if (!state || !isModelHidden(state)) return null;
  return state.total > 1
    ? `Loading 3D model… ${state.loaded} / ${state.total}`
    : 'Loading 3D model…';
}

/**
 * Watch a `THREE.LoadingManager` that a URDF load runs through and report its
 * progress. `onState` is called at once with `loading`, on every started or
 * finished file, and exactly once with the settling phase: `ready` when the
 * manager reports everything loaded (a failed mesh still ends, so it settles
 * too), or `timeout` when that takes longer than `timeoutMs`.
 *
 * @returns dispose — stops the timer, detaches from the manager and reports
 *   `cancelled` unless the load had already settled.
 */
export function watchModelLoad(
  manager: THREE.LoadingManager,
  onState: (state: ModelLoadState) => void,
  timeoutMs: number = MODEL_REVEAL_TIMEOUT_MS
): () => void {
  let loaded = 0;
  let total = 0;
  let settled = false;
  let disposed = false;

  const emit = (phase: ModelLoadState['phase']) => onState({ phase, loaded, total });
  const settle = (phase: 'ready' | 'timeout') => {
    if (settled || disposed) return;
    settled = true;
    clearTimeout(timer);
    emit(phase);
  };
  const progress = (_url: string, itemsLoaded: number, itemsTotal: number) => {
    loaded = itemsLoaded;
    total = itemsTotal;
    if (!settled && !disposed) emit('loading');
  };

  manager.onStart = progress;
  manager.onProgress = progress;
  manager.onLoad = () => settle('ready');
  const timer = setTimeout(() => settle('timeout'), timeoutMs);
  emit('loading');

  return () => {
    if (disposed) return;
    clearTimeout(timer);
    manager.onStart = undefined;
    manager.onProgress = () => {};
    manager.onLoad = () => {};
    const wasSettled = settled;
    disposed = true;
    if (!wasSettled) emit('cancelled');
  };
}

// ============================================================================
// MATERIAL PASS
// ============================================================================

/** Name that marks a mesh as already carrying the model's material. */
export const ROBOT_MATERIAL_NAME = 'RobotCustomMaterial';

/**
 * Give every mesh under `root` the model's material. Safe — and meant — to run
 * every frame: a mesh that already has it is skipped by name, so a mesh that
 * arrives late (a slow STL, a retry) is restyled on the next pass instead of
 * keeping the loader's default material. A mesh with `userData.keepMaterial`
 * (a `linkOverlay`, TASK-414) hangs in the same tree and is never touched.
 *
 * @param createMaterial - Builds a fresh material, named {@link ROBOT_MATERIAL_NAME}
 * @returns how many meshes were restyled in this pass
 */
export function applyRobotMaterial(
  root: THREE.Object3D,
  createMaterial: () => THREE.Material
): number {
  let restyled = 0;
  root.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh;
    if (mesh.userData?.keepMaterial) return;
    if (!mesh.isMesh || !mesh.material) return;
    const current = mesh.material as THREE.Material;
    if (current.name === ROBOT_MATERIAL_NAME) return;
    mesh.material = createMaterial();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    restyled += 1;
  });
  return restyled;
}
