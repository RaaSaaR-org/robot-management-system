/**
 * @file recording-controller.ts
 * @description The one EpisodeRecorder this agent owns, and the seams that let
 *              it read the robot without the recorder importing the robot.
 * @feature recording
 * @status live
 */

import { fileURLToPath } from 'url';
import { dirname, resolve, isAbsolute } from 'path';
import type { RobotStateManager } from '../robot/state.js';
import { hardwareClient } from '../hardware/HardwareClient.js';
import { config } from '../config/config.js';
import {
  EpisodeRecorder,
  RecordingError,
  type RecordingStatus,
  type StartRecordingRequest,
  type StopRecordingResult,
} from './EpisodeRecorder.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where finished datasets land. `data/workspace-<robotId>/datasets/<sessionId>/`
 * by default, next to the patrol photos and the journal — everything this robot
 * produced about a place is then in one tree that a retention sweep can find.
 */
function defaultDatasetRoot(robotId: string): string {
  const fromEnv = process.env.RECORDING_DATASET_DIR;
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(process.cwd(), fromEnv);
  return resolve(HERE, '../../data', `workspace-${robotId}`, 'datasets');
}

/** JPEGs while recording. Deleted on stop, whether or not the write succeeded. */
function defaultScratchRoot(robotId: string): string {
  return resolve(defaultDatasetRoot(robotId), '.scratch');
}

export class RecordingController {
  private stateManager: RobotStateManager | null = null;
  private recorder: EpisodeRecorder | null = null;

  /** Called once at boot, the same way `agentModeController.attach` is. */
  attach(stateManager: RobotStateManager): void {
    this.stateManager = stateManager;
    this.recorder = null; // rebuilt on next use, against the new manager
  }

  /** Test seam. */
  setRecorder(recorder: EpisodeRecorder | null): void {
    this.recorder = recorder;
  }

  isAttached(): boolean {
    return this.stateManager !== null;
  }

  private ensure(): EpisodeRecorder {
    if (this.recorder) return this.recorder;
    const sm = this.stateManager;
    if (!sm) {
      // 503, not 500: `attachController` runs only once the process has decided
      // it IS the robot, so a status poll during boot lands here. That is a
      // transient state with a right answer — ask again — not a failure.
      throw new RecordingError(
        'recording is not available: no RobotStateManager is attached',
        'RECORDING_UNAVAILABLE',
        503,
      );
    }
    this.recorder = new EpisodeRecorder({
      robotType: config.robotType,
      scratchRoot: defaultScratchRoot(config.robotId),
      datasetRoot: defaultDatasetRoot(config.robotId),
      hooks: {
        getCommanded: () => sm.getTeleopPositions(),
        isTeleopActive: () => sm.isTeleopActive(),
        isEStopTriggered: () => sm.isEStopTriggered(),
        // NOT `getJointStates()`: that answers from the 2 s poll cache, so a
        // 30 Hz recorder would store the same measured pose sixty times over
        // and the commanded/measured distinction would be an artefact of the
        // cache rather than of the robot.
        getMeasured: () => hardwareClient.getJointMapNow(),
        snapshot: (camera, opts) =>
          hardwareClient.snapshotRaw(camera, { shadows: opts.shadows, quality: opts.quality }),
        listCameras: () => hardwareClient.getCameras(),
        describeSidecar: () => hardwareClient.describeSidecar(),
      },
    });
    return this.recorder;
  }

  async start(req: StartRecordingRequest): Promise<RecordingStatus> {
    return this.ensure().start(req);
  }

  nextEpisode(): number {
    return this.ensure().nextEpisode();
  }

  async discardEpisode(index: number): Promise<boolean> {
    return this.ensure().discardEpisode(index);
  }

  async stop(): Promise<StopRecordingResult> {
    return this.ensure().stop();
  }

  status(): RecordingStatus {
    return this.ensure().status();
  }

  async refreshHealth(): Promise<void> {
    await this.ensure().refreshSidecarHealth();
  }

  isRecording(): boolean {
    return this.recorder?.isRecording() ?? false;
  }

  /** Shutdown hook: an unfinished session still writes what it has. */
  async stopIfRecording(): Promise<StopRecordingResult | null> {
    if (!this.isRecording()) return null;
    return this.stop();
  }
}

export const recordingController = new RecordingController();
