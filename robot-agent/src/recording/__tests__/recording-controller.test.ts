/**
 * @file recording-controller.test.ts
 * @description The seam between the recorder and the robot: what gets wired to
 *              what when `attach()` runs, where the dataset tree lands, and how
 *              the controller behaves before anything is attached at all. The
 *              tick itself is covered by `EpisodeRecorder.test.ts`, so the
 *              recorder is a stand-in here and no frame is ever recorded.
 * @feature recording
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve, sep } from 'path';

/** Every EpisodeRecorder the controller built, in order, with its options. */
const built = vi.hoisted(() => ({
  list: [] as { opts: Record<string, unknown> }[],
}));

vi.mock('../EpisodeRecorder.js', () => ({
  // The controller throws this one itself, before it ever builds a recorder,
  // so the mock has to carry it.
  RecordingError: class RecordingError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly status: number,
    ) {
      super(message);
      this.name = 'RecordingError';
    }
  },
  EpisodeRecorder: class {
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      built.list.push(this);
    }
    start = vi.fn(async () => ({ recording: true }));
    nextEpisode = vi.fn(() => 0);
    discardEpisode = vi.fn(async () => true);
    stop = vi.fn(async () => ({ ok: true }));
    status = vi.fn(() => ({ recording: false }));
    refreshSidecarHealth = vi.fn(async () => undefined);
    isRecording = vi.fn(() => false);
  },
}));

const hardware = vi.hoisted(() => ({
  getJointMapNow: vi.fn(async () => ({ waist_yaw_joint: 0.1 })),
  getJointStates: vi.fn(() => []),
  snapshotRaw: vi.fn(async () => Buffer.alloc(0)),
  getCameras: vi.fn(async () => ['head_camera']),
  describeSidecar: vi.fn(async () => ({ scene: null, bootId: null, behindS: null })),
}));

vi.mock('../../hardware/HardwareClient.js', () => ({ hardwareClient: hardware }));

import { RecordingController, recordingController } from '../recording-controller.js';
import { config } from '../../config/config.js';
import type { RobotStateManager } from '../../robot/state.js';
import type { EpisodeRecorder, RecorderHooks, StopRecordingResult } from '../EpisodeRecorder.js';

interface FakeManager {
  getTeleopPositions: ReturnType<typeof vi.fn>;
  isTeleopActive: ReturnType<typeof vi.fn>;
  isEStopTriggered: ReturnType<typeof vi.fn>;
  /** Present so the test can prove the recorder does NOT read the 2 s cache. */
  getJointStates: ReturnType<typeof vi.fn>;
}

function fakeManager(tag: string): FakeManager {
  return {
    getTeleopPositions: vi.fn(() => ({ [`${tag}_joint`]: 1 })),
    isTeleopActive: vi.fn(() => true),
    isEStopTriggered: vi.fn(() => false),
    getJointStates: vi.fn(() => []),
  };
}

const asManager = (m: FakeManager): RobotStateManager => m as unknown as RobotStateManager;

/** The options the last-built recorder was constructed with. */
function lastOpts(): Record<string, unknown> {
  const last = built.list.at(-1);
  if (!last) throw new Error('no EpisodeRecorder was built');
  return last.opts;
}

const hooksOf = (opts: Record<string, unknown>): RecorderHooks => opts.hooks as RecorderHooks;

describe('RecordingController', () => {
  let controller: RecordingController;

  beforeEach(() => {
    built.list = [];
    vi.clearAllMocks();
    controller = new RecordingController();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // before attach
  // -------------------------------------------------------------------------

  it('refuses every verb before a RobotStateManager is attached, and says which one is missing', async () => {
    expect(controller.isAttached()).toBe(false);
    expect(() => controller.status()).toThrow(/RobotStateManager/);
    await expect(controller.nextEpisode()).rejects.toThrow(/RobotStateManager/);
    await expect(controller.start({ sessionId: 'session-1' })).rejects.toThrow(/RobotStateManager/);
    await expect(controller.stop()).rejects.toThrow(/RobotStateManager/);
    await expect(controller.refreshHealth()).rejects.toThrow(/RobotStateManager/);
    // Nothing half-built: a failed `ensure()` must not leave a recorder behind.
    expect(built.list).toHaveLength(0);
  });

  it('reports not-recording before attach instead of throwing', async () => {
    // The shutdown hook runs whether or not boot got as far as attaching, so
    // these two must be safe on an unattached controller.
    expect(controller.isRecording()).toBe(false);
    await expect(controller.stopIfRecording()).resolves.toBeNull();
    expect(built.list).toHaveLength(0);
  });

  it('exports a module singleton, unattached until boot attaches it', () => {
    expect(recordingController).toBeInstanceOf(RecordingController);
  });

  // -------------------------------------------------------------------------
  // attach
  // -------------------------------------------------------------------------

  it('builds the recorder lazily, once, on first use', () => {
    controller.attach(asManager(fakeManager('one')));
    expect(built.list).toHaveLength(0);

    controller.status();
    controller.status();
    controller.nextEpisode();
    expect(built.list).toHaveLength(1);
  });

  it('rebuilds against the new manager when attach() runs a second time', async () => {
    const first = fakeManager('one');
    const second = fakeManager('two');

    controller.attach(asManager(first));
    controller.status();
    expect(built.list).toHaveLength(1);

    controller.attach(asManager(second));
    controller.status();
    expect(built.list).toHaveLength(2);

    // The point: the recorder built after the second attach reads the SECOND
    // manager. A stale closure here would record one robot's commanded pose
    // against another robot's measured one.
    const hooks = hooksOf(lastOpts());
    expect(hooks.getCommanded()).toEqual({ two_joint: 1 });
    expect(second.getTeleopPositions).toHaveBeenCalledTimes(1);
    expect(first.getTeleopPositions).not.toHaveBeenCalled();

    hooks.isTeleopActive();
    hooks.isEStopTriggered();
    expect(second.isTeleopActive).toHaveBeenCalledTimes(1);
    expect(second.isEStopTriggered).toHaveBeenCalledTimes(1);
    expect(first.isTeleopActive).not.toHaveBeenCalled();
  });

  it('takes the measured pose fresh from the sidecar, not from the state manager cache', async () => {
    const manager = fakeManager('one');
    controller.attach(asManager(manager));
    controller.status();

    await expect(hooksOf(lastOpts()).getMeasured()).resolves.toEqual({ waist_yaw_joint: 0.1 });
    expect(hardware.getJointMapNow).toHaveBeenCalledTimes(1);
    // `getJointStates()` answers from the 2 s poll, so a 30 Hz recorder reading
    // it would store the same measured pose sixty times over.
    expect(manager.getJointStates).not.toHaveBeenCalled();
  });

  it('passes the render options through to the sidecar snapshot', async () => {
    controller.attach(asManager(fakeManager('one')));
    controller.status();

    await hooksOf(lastOpts()).snapshot('head_camera', { shadows: false, quality: 90 });
    expect(hardware.snapshotRaw).toHaveBeenCalledWith('head_camera', { shadows: false, quality: 90 });
  });

  it('honours setRecorder() as the test seam, in both directions', async () => {
    controller.attach(asManager(fakeManager('one')));

    const stand = { status: vi.fn(() => ({ recording: true })) } as unknown as EpisodeRecorder;
    controller.setRecorder(stand);
    controller.status();
    expect(stand.status).toHaveBeenCalledTimes(1);
    expect(built.list).toHaveLength(0);

    controller.setRecorder(null);
    controller.status();
    expect(built.list).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // stopIfRecording
  // -------------------------------------------------------------------------

  it('stopIfRecording() is a no-op when nothing is recording', async () => {
    controller.attach(asManager(fakeManager('one')));
    const stand = {
      isRecording: vi.fn(() => false),
      stop: vi.fn(async () => ({ ok: true }) as unknown as StopRecordingResult),
    } as unknown as EpisodeRecorder;
    controller.setRecorder(stand);

    await expect(controller.stopIfRecording()).resolves.toBeNull();
    expect(stand.stop).not.toHaveBeenCalled();
  });

  it('stopIfRecording() writes out a session that was still running at shutdown', async () => {
    controller.attach(asManager(fakeManager('one')));
    const result = { ok: true, datasetPath: '/data/ds', totalFrames: 12 } as unknown as StopRecordingResult;
    const stand = {
      isRecording: vi.fn(() => true),
      stop: vi.fn(async () => result),
    } as unknown as EpisodeRecorder;
    controller.setRecorder(stand);

    expect(controller.isRecording()).toBe(true);
    await expect(controller.stopIfRecording()).resolves.toBe(result);
    expect(stand.stop).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // where the dataset lands
  // -------------------------------------------------------------------------

  it('writes into data/workspace-<robotId>/datasets by default, with scratch inside it', () => {
    controller.attach(asManager(fakeManager('one')));
    controller.status();

    const opts = lastOpts();
    const datasetRoot = opts.datasetRoot as string;
    expect(datasetRoot.endsWith(['data', `workspace-${config.robotId}`, 'datasets'].join(sep))).toBe(true);
    // Next to the patrol photos and the journal, so one retention sweep can
    // find everything this robot produced about a place.
    expect(datasetRoot).toContain(`${sep}robot-agent${sep}data${sep}`);
    expect(opts.scratchRoot).toBe(resolve(datasetRoot, '.scratch'));
    expect(opts.robotType).toBe(config.robotType);
  });

  it('honours a relative RECORDING_DATASET_DIR against the working directory', () => {
    vi.stubEnv('RECORDING_DATASET_DIR', 'tmp/recordings');
    controller.attach(asManager(fakeManager('one')));
    controller.status();

    const opts = lastOpts();
    expect(opts.datasetRoot).toBe(resolve(process.cwd(), 'tmp/recordings'));
    expect(opts.scratchRoot).toBe(resolve(process.cwd(), 'tmp/recordings', '.scratch'));
  });

  it('honours an absolute RECORDING_DATASET_DIR verbatim', () => {
    const dir = resolve(sep, 'var', 'tmp', 'neodem-datasets');
    vi.stubEnv('RECORDING_DATASET_DIR', dir);
    controller.attach(asManager(fakeManager('one')));
    controller.status();

    expect(lastOpts().datasetRoot).toBe(dir);
  });

  it('reads RECORDING_DATASET_DIR when the recorder is built, not when the module loads', () => {
    // Boot order matters: `attach()` happens at start-up, and an operator who
    // sets the variable in a profile must not have to care whether it was
    // exported before this module was imported.
    controller.attach(asManager(fakeManager('one')));
    controller.status();
    const before = lastOpts().datasetRoot as string;

    vi.stubEnv('RECORDING_DATASET_DIR', resolve(sep, 'var', 'tmp', 'later'));
    controller.setRecorder(null);
    controller.status();

    expect(lastOpts().datasetRoot).not.toBe(before);
    expect(lastOpts().datasetRoot).toBe(resolve(sep, 'var', 'tmp', 'later'));
  });
});
