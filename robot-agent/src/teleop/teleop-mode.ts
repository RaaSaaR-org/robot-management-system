/**
 * @file teleop-mode.ts
 * @description Which retargeting actually drove the robot, observed rather than
 *              declared. Read by the episode recorder so a dataset says how its
 *              demonstrations were produced.
 * @feature teleop
 * @status live
 *
 * WHY OBSERVED AND NOT DECLARED. The obvious design is a field on
 * `POST /recording/start` that the browser fills in. That field would be a
 * claim: it is set once, before the take, by the side of the link that is not
 * doing the retargeting, and nothing checks it. An operator who starts in
 * controller mode and switches to hand tracking mid-session — which the modal
 * lets them do — would produce a dataset labelled with whichever mode they
 * happened to open with.
 *
 * The agent already knows, exactly and continuously: `{positions}` is the
 * browser's orientation mapping, `{wrists}` is the arm IK in this process, and
 * `{hands}` is DexPilot finger retargeting. So the socket marks what it
 * received and the recorder reads it per episode. A session that used two modes
 * says so, on the episode that used them.
 */

/** How the joint targets being written were produced. */
export type TeleopMode =
  /** Joint angles computed in the browser from controller ORIENTATION only. */
  | 'orientation'
  /** Arm joint angles solved here from a streamed wrist pose. */
  | 'ik'
  /** Dex3 finger angles solved here from tracked hand keypoints. */
  | 'hand-tracking'
  /** A single joint moved by hand — keyboard rig, gamepad, roboctl. */
  | 'manual';

/**
 * The modes seen since the last `take()`.
 *
 * Module-level and shared, like `controlOwnerLock`: there is one robot, and the
 * recorder is not connected to any particular socket.
 */
const seen = new Set<TeleopMode>();

/** Record that `mode` just drove the robot. Cheap enough to call per message. */
export function markTeleopMode(mode: TeleopMode): void {
  seen.add(mode);
}

/** Everything seen since the last `takeTeleopModes`, sorted for stability. */
export function peekTeleopModes(): TeleopMode[] {
  return [...seen].sort();
}

/**
 * Everything seen since the last call, and reset.
 *
 * The recorder calls this at every episode boundary, so each episode is
 * labelled with the modes that drove IT rather than with everything the session
 * has ever used.
 */
export function takeTeleopModes(): TeleopMode[] {
  const modes = peekTeleopModes();
  seen.clear();
  return modes;
}

/** Forget everything. For tests, and for a session that is starting over. */
export function resetTeleopModes(): void {
  seen.clear();
}
