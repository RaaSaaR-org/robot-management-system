/**
 * @file EpisodeRecorder.test.ts
 * @description The tick: what it records, what it refuses, and what it drops.
 * @feature recording
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { ParquetReader } from '@dsnp/parquetjs';
import { EpisodeRecorder, jpegSize, type RecorderHooks } from '../EpisodeRecorder.js';
import { G1_DEX3_JOINTS } from '../dex3-layout.js';
import { markTeleopMode, resetTeleopModes } from '../../teleop/teleop-mode.js';

const HAVE_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

/** A real 64x48 JPEG, so the encode at stop time is a real encode. */
let JPEG: Buffer;

beforeAll(() => {
  const res = spawnSync(
    'ffmpeg',
    ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=1',
     '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  JPEG = res.status === 0 ? res.stdout : Buffer.alloc(0);
});

async function readParquet(path: string): Promise<Record<string, unknown>[]> {
  const reader = await ParquetReader.openFile(path);
  const cursor = reader.getCursor();
  const rows: Record<string, unknown>[] = [];
  let row: Record<string, unknown> | null;
  while ((row = (await cursor.next()) as Record<string, unknown> | null)) {
    if (Object.keys(row).length === 0) break;
    rows.push(row);
  }
  await reader.close();
  return rows;
}

function listValues(cell: unknown): number[] {
  return ((cell as { list?: { element?: number }[] })?.list ?? []).map((e) => e.element ?? 0);
}

function fullPose(offset: number): Record<string, number> {
  const pose: Record<string, number> = {};
  G1_DEX3_JOINTS.forEach((name, i) => {
    pose[name] = offset + i * 0.001;
  });
  return pose;
}

interface Harness {
  hooks: RecorderHooks;
  clock: { ms: number };
  commanded: Record<string, number>;
  measured: Record<string, number>;
  flags: { estop: boolean; teleop: boolean };
  snapshotDelayMs: number;
  snapshotError: string | null;
  /** Fail every second snapshot, to halve the rate without stopping it. */
  failEveryOther: boolean;
  snapshotCalls: { camera: string; shadows: boolean; quality: number }[];
  /**
   * Ticks that have begun capturing, counted at the first hook the tick awaits.
   * `advance()` uses it to tell "a tick is still writing" from "the tick is
   * done"; see the comment there.
   */
  captureStarts: number;
}

function harness(overrides: Partial<Harness> = {}): Harness {
  const clock = { ms: 1_000_000 };
  const h: Harness = {
    clock,
    commanded: fullPose(0.1),
    measured: fullPose(0.2),
    flags: { estop: false, teleop: true },
    snapshotDelayMs: 0,
    snapshotError: null,
    failEveryOther: false,
    snapshotCalls: [],
    captureStarts: 0,
    hooks: undefined as unknown as RecorderHooks,
    ...overrides,
  };
  h.hooks = {
    getCommanded: () => h.commanded,
    isTeleopActive: () => h.flags.teleop,
    isEStopTriggered: () => h.flags.estop,
    // The first thing a capturing tick awaits, and the only hook `start()` also
    // calls — which it does before any `advance()` samples the counter, so the
    // deltas `advance()` compares are unaffected by it.
    getMeasured: async () => {
      h.captureStarts += 1;
      return h.measured;
    },
    snapshot: async (camera, opts) => {
      h.snapshotCalls.push({ camera, ...opts });
      if (h.failEveryOther && h.snapshotCalls.length % 2 === 0) {
        throw new Error('camera busy');
      }
      if (h.snapshotError) throw new Error(h.snapshotError);
      if (h.snapshotDelayMs > 0) await new Promise((r) => setTimeout(r, h.snapshotDelayMs));
      return JPEG;
    },
    listCameras: async () => ['head_camera', 'house_iso'],
    describeSidecar: async () => ({
      scene: 'g1_dex3_house_scene.xml',
      bootId: 'boot-1',
      behindS: 0.01,
    }),
    now: () => clock.ms,
  };
  return h;
}

/** Ticks that have finished: each one ends by accepting or dropping exactly one. */
function settledTicks(rec: EpisodeRecorder): number {
  const status = rec.status();
  return status.totalFrames + status.totalDropped;
}

/**
 * Advance the fake timers and the harness clock together by one step, then hand
 * the REAL event loop back until the tick that step fired has finished.
 *
 * The waiting is the whole point, and it is why nothing in this file sleeps. A
 * tick with a camera on it writes a real JPEG, and `advanceTimersByTimeAsync`
 * yields only a turn or two of the real loop — an order of magnitude fewer than
 * a write needs even on an idle box. Advancing again while that write is still
 * in the air is what made this file load-dependent: the next tick lands on
 * `tickInFlight` and is dropped as "behind", and a budget counted in VIRTUAL
 * milliseconds buys no real time to recover in — ten seconds of fake clock go
 * by in a fraction of a second of wall clock, so on a busy box the first write
 * had not landed when the budget ran out. Waiting on the tick rather than on a
 * duration makes the count the same however busy the disk is.
 *
 * Step no further than one tick period, so at most one tick fires per call and
 * the two counters below cannot be describing different ticks.
 *
 * Fake timers must already be installed when `start()` creates its interval —
 * installing them afterwards leaves a real interval that never fires, and every
 * assertion about frames then reads zero for a reason that has nothing to do
 * with the recorder.
 */
async function advance(h: Harness, rec: EpisodeRecorder, ms: number): Promise<void> {
  const startsBefore = h.captureStarts;
  const settledBefore = settledTicks(rec);
  h.clock.ms += ms;
  await vi.advanceTimersByTimeAsync(ms);
  // Zero fires no timer and moves no clock — it only yields a real macrotask —
  // so this drains the write without ticking the recorder underneath it.
  while (settledTicks(rec) - settledBefore < h.captureStarts - startsBefore) {
    await vi.advanceTimersByTimeAsync(0);
  }
}

/** Advance `ms` of fake clock, letting every tick it fires finish. */
async function run(h: Harness, rec: EpisodeRecorder, ms: number, step = 10): Promise<void> {
  for (let t = 0; t < ms; t += step) {
    await advance(h, rec, step);
  }
}

/**
 * Advance until the open episode holds `frames` frames, and fail saying why if
 * it never gets there.
 *
 * A tick with a camera on it writes a real JPEG, and a tick that fires while
 * the previous one is still writing is dropped on purpose — "the previous frame
 * had not finished" is the recorder's whole backpressure design. `advance()`
 * never fires a tick into a write that is still running, so the budget below
 * counts ticks the recorder actually got to attempt rather than wall clock the
 * disk may have eaten.
 */
async function runUntilFrames(
  h: Harness,
  rec: EpisodeRecorder,
  frames: number,
  budgetMs = 10_000,
): Promise<void> {
  for (let t = 0; t < budgetMs && rec.status().frames < frames; t += 10) {
    await advance(h, rec, 10);
  }
  const status = rec.status();
  if (status.frames < frames) {
    throw new Error(
      `recorder never reached ${frames} frame(s) in ${budgetMs} ms: ` +
        `frames=${status.frames} dropped=${status.dropped} last=${status.lastDropReason}`,
    );
  }
}

/**
 * Park the recorder and let whatever tick is mid-write land, so a count taken
 * afterwards cannot be moved by I/O that was already in flight.
 *
 * Without this a frame can be accepted DURING the call under test: a discard
 * that correctly drops one episode's frames then reads back the same total,
 * because a straggler landed in the other episode meanwhile (TASK-218).
 *
 * The pause is what does the work now — `advance()` already returns with no
 * write in the air, so there is no straggler left to poll for, and the step
 * below only lets the parked interval fire once against the pause.
 */
async function quiesce(h: Harness, rec: EpisodeRecorder): Promise<void> {
  rec.pause();
  await advance(h, rec, 10);
}

describe('jpegSize', () => {
  it('reads the dimensions out of the SOF marker', () => {
    if (!HAVE_FFMPEG) return;
    expect(jpegSize(JPEG)).toEqual({ width: 64, height: 48 });
  });

  it('answers null for something that is not a JPEG', () => {
    expect(jpegSize(Buffer.from('not a jpeg'))).toBeNull();
    expect(jpegSize(Buffer.alloc(0))).toBeNull();
  });
});

describe('EpisodeRecorder', () => {
  let dir: string;
  let h: Harness;
  let rec: EpisodeRecorder;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'episode-recorder-'));
    h = harness();
    rec = new EpisodeRecorder({
      hooks: h.hooks,
      robotType: 'g1_edu',
      scratchRoot: join(dir, 'scratch'),
      datasetRoot: join(dir, 'datasets'),
    });
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (rec.isRecording()) await rec.stop().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  // -- refusing to start ----------------------------------------------------

  it('starts before teleop is engaged, and drops until it is', async () => {
    // The order people actually work in: press Start, then put the headset on.
    // Refusing here would make the recorder unusable; recording the un-driven
    // pose would be a lie. Dropping and counting is the third answer.
    h.flags.teleop = false;
    const status = await rec.start({ sessionId: 's1', cameras: [] });
    expect(status.recording).toBe(true);
    await run(h, rec, 100);
    expect(rec.status().frames).toBe(0);
    expect(rec.status().dropped).toBeGreaterThan(0);

    h.flags.teleop = true;
    await run(h, rec, 100);
    // Exact, not "> 0": 100 ms at the default 30 fps is a 33 ms period, so
    // three ticks land. A recorder that quietly ticked at the wrong rate would
    // pass a `toBeGreaterThan(0)` and fail this.
    expect(rec.status().frames).toBe(3);
  });

  it('refuses to start when the sidecar does not report every joint', async () => {
    // Exactly the state the sim was in before /state learned the hands: the
    // fingers would have been recorded as a constant zero column.
    const partial = { ...fullPose(0.2) };
    for (const name of G1_DEX3_JOINTS) if (name.includes('_hand_')) delete partial[name];
    h.measured = partial;
    await expect(rec.start({ sessionId: 's1', cameras: [] })).rejects.toThrow(
      /does not report 14 of 28 joints/,
    );
  });

  it('refuses a second session while one is running', async () => {
    await rec.start({ sessionId: 's1', cameras: [] });
    await expect(rec.start({ sessionId: 's2', cameras: [] })).rejects.toThrow(/busy recording session s1/);
  });

  it('maps the cameras it was given through the scene table', async () => {
    const status = await rec.start({ sessionId: 's1', cameras: ['head_camera', 'house_iso'] });
    expect(status.cameras).toEqual([
      { camera: 'head_camera', key: 'cam_right_high' },
      { camera: 'house_iso', key: 'cam_third_person' },
    ]);
    expect(status.scene).toBe('g1_dex3_house_scene.xml');
  });

  it('defaults to the head camera when none was named', async () => {
    const status = await rec.start({ sessionId: 's1' });
    expect(status.cameras.map((c) => c.camera)).toEqual(['head_camera']);
  });

  // -- the tick -------------------------------------------------------------

  it('records commanded and measured as different arrays', async () => {
    // The harness drives them 0.1 rad apart on every joint, so this reads the
    // PARQUET and proves the two columns are different — the earlier version of
    // this test only checked info.json's shape and would have passed with
    // `action: state`, which is exactly the bug the recorder exists to fix.
    await rec.start({ sessionId: 's1', fps: 20, cameras: [] });
    await run(h, rec, 200);
    expect(rec.status().frames).toBe(4);
    const stop = await rec.stop();
    expect(stop.ok).toBe(true);

    const info = JSON.parse(await readFile(join(stop.datasetPath!, 'meta/info.json'), 'utf-8'));
    expect(info.robot_type).toBe('Unitree_G1_Dex3');
    expect(info.features['observation.state'].shape).toEqual([28]);

    const rows = await readParquet(join(stop.datasetPath!, 'data/chunk-000/file-000.parquet'));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const state = listValues(row['observation.state']);
      const action = listValues(row['action']);
      expect(state).toHaveLength(28);
      expect(action).toHaveLength(28);
      expect(action).not.toEqual(state);
      // The harness's fixed offset, so a swap or a copy is visible here.
      expect(state[0]! - action[0]!).toBeCloseTo(0.1, 6);
    }
  });

  it('drops a tick while an emergency stop is latched, and says so', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: [] });
    h.flags.estop = true;
    await run(h, rec, 200);
    const status = rec.status();
    expect(status.frames).toBe(0);
    expect(status.dropped).toBeGreaterThan(0);
    expect(status.lastDropReason).toMatch(/emergency stop/);
  });

  it('drops a tick while teleop is disengaged rather than recording a stale pose', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: [] });
    h.flags.teleop = false;
    await run(h, rec, 200);
    expect(rec.status().lastDropReason).toMatch(/teleop is not engaged/);
  });

  it.skipIf(!HAVE_FFMPEG)('drops a tick whose camera failed instead of writing a frame with no picture', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: ['head_camera'] });
    h.snapshotError = 'sidecar snapshot head_camera failed: HTTP 503';
    await run(h, rec, 200);
    const status = rec.status();
    expect(status.frames).toBe(0);
    expect(status.dropped).toBeGreaterThan(0);
    expect(status.lastDropReason).toMatch(/503/);
  });

  it.skipIf(!HAVE_FFMPEG)('calls the sidecar with shadows off by default and 90 quality', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: ['head_camera'] });
    await run(h, rec, 120);
    expect(h.snapshotCalls.length).toBeGreaterThan(0);
    expect(h.snapshotCalls[0]).toEqual({ camera: 'head_camera', shadows: false, quality: 90 });
  });

  it.skipIf(!HAVE_FFMPEG)('keeps shadows when asked for them', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: ['head_camera'], shadows: true });
    await run(h, rec, 120);
    expect(h.snapshotCalls[0]?.shadows).toBe(true);
  });

  it('reports itself degraded after a run of drops', async () => {
    await rec.start({ sessionId: 's1', fps: 50, cameras: [] });
    h.flags.estop = true;
    await run(h, rec, 1000);
    expect(rec.status().degraded).toBe(true);
  });

  // -- episodes -------------------------------------------------------------

  it('draws episode boundaries where nextEpisode was called', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: [] });
    await run(h, rec, 200);
    const firstCount = rec.status().frames;
    expect(await rec.nextEpisode()).toBe(1);
    expect(rec.status().frames).toBe(0);
    await run(h, rec, 200);

    const status = rec.status();
    expect(status.episodeIndex).toBe(1);
    expect(status.episodes).toHaveLength(2);
    expect(status.episodes[0]!.frames).toBe(firstCount);
    expect(status.totalFrames).toBe(status.episodes[0]!.frames + status.episodes[1]!.frames);
  });

  it.skipIf(!HAVE_FFMPEG)('forgets a discarded episode and its images', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: ['head_camera'] });
    // Both episodes have to end up with at least one frame for a discard to be
    // observable at all, and with a camera attached each frame is a real JPEG
    // write — so wait for the frame instead of counting on the tick.
    await runUntilFrames(h, rec, 1);
    await rec.nextEpisode();
    await runUntilFrames(h, rec, 1);
    // Park it before reading the count: a tick still writing when `before` is
    // sampled lands during the discard and puts the frame back, so the discard
    // looks like it removed nothing.
    await quiesce(h, rec);
    const before = rec.status().totalFrames;
    vi.useRealTimers();

    await rec.discardEpisode(0);
    const after = rec.status();
    expect(after.totalFrames).toBeLessThan(before);
    expect(after.episodes[0]!.frames).toBe(0);
    expect(existsSync(join(dir, 'scratch', 's1', 'ep_000'))).toBe(false);
  });

  // -- stopping -------------------------------------------------------------

  it('says nothing was recorded rather than writing an empty dataset', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: [] });
    h.flags.estop = true;
    await run(h, rec, 200);
    vi.useRealTimers();
    const result = await rec.stop();
    expect(result.ok).toBe(false);
    expect(result.datasetPath).toBeNull();
    expect(result.error).toMatch(/no frames recorded/);
    expect(existsSync(join(dir, 'datasets', 's1'))).toBe(false);
  });

  it('leaves no scratch behind', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: [] });
    await run(h, rec, 200);
    vi.useRealTimers();
    await rec.stop();
    expect(existsSync(join(dir, 'scratch', 's1'))).toBe(false);
    expect(rec.isRecording()).toBe(false);
  });

  // Gated: it drives a camera, so without ffmpeg the fixture JPEG is empty and
  // the encode fails — a hard failure where every other camera test in this file
  // skips, which turns a machine that simply lacks ffmpeg into a red build.
  it.skipIf(!HAVE_FFMPEG)('reports the fps it achieved, not the one it was asked for', async () => {
    // Every second snapshot fails, so frames land at half the tick rate.
    // Declaring 50 would put a timestamp on every row claiming the episode ran
    // twice as fast as it did — and the video, encoded at that fps, would agree
    // with the lie.
    h.failEveryOther = true;
    await rec.start({ sessionId: 's1', fps: 50, cameras: ['head_camera'] });
    // A measured rate needs two frames to measure between, and each of them is
    // a real JPEG write — so wait for them rather than assume 400 ms of ticks
    // produced them.
    await runUntilFrames(h, rec, 4);
    vi.useRealTimers();
    const result = await rec.stop();
    expect(result.ok).toBe(true);
    expect(result.fpsActual).toBeLessThan(50);
    const info = JSON.parse(await readFile(join(result.datasetPath!, 'meta/info.json'), 'utf-8'));
    expect(info.fps).toBe(result.fpsActual);
    expect(info._neodem.fpsTarget).toBe(50);
  });

  // -- what the review found ------------------------------------------------

  it.skipIf(!HAVE_FFMPEG)('keeps recording after the LIVE episode is discarded', async () => {
    // The episode panel offers discard on the live row. The rm that removes the
    // take also removed the directory the next tick writes into, so every
    // remaining frame failed with ENOENT and the operator recorded nothing
    // until they pressed Next episode.
    // Real JPEG writes here, so the counts are I/O-paced rather than exact —
    // what matters is that recording RESUMES, which it did not before.
    await rec.start({ sessionId: 's1', fps: 20, cameras: ['head_camera'] });
    await runUntilFrames(h, rec, 1);
    expect(rec.status().frames).toBeGreaterThan(0);

    await rec.discardEpisode(0);
    expect(rec.status().frames).toBe(0);

    await runUntilFrames(h, rec, 1);
    expect(rec.status().frames).toBeGreaterThan(0);
    expect(rec.status().lastDropReason ?? '').not.toMatch(/ENOENT/);
  });

  it.skipIf(!HAVE_FFMPEG)('leaves no image behind when a later camera fails to write', async () => {
    // One orphan JPEG makes that camera's video one frame longer than the
    // parquet, and every frame after it a frame out of step with the joints.
    // A failed tick's cleanup is real I/O, and a tick that fired while it was
    // still running used to drop with "the previous frame had not finished" and
    // overwrite the reason under test. `advance()` no longer fires into a tick
    // that has not finished, but the reasons are still collected as they appear
    // rather than read once at the end — the last one is not the point (TASK-218).
    await rec.start({ sessionId: 's1', fps: 5, cameras: ['head_camera', 'house_iso'] });
    await rm(join(dir, 'scratch', 's1', 'ep_000', 'cam_third_person'), {
      recursive: true,
      force: true,
    });

    const reasons = new Set<string>();
    const sawWriteFailure = (): boolean =>
      [...reasons].some((reason) => /could not write frame/.test(reason));
    for (let t = 0; t < 5000 && !sawWriteFailure(); t += 10) {
      await advance(h, rec, 10);
      const reason = rec.status().lastDropReason;
      if (reason) reasons.add(reason);
    }

    const status = rec.status();
    expect(status.frames).toBe(0);
    expect(status.dropped).toBeGreaterThan(0);
    expect([...reasons]).toContainEqual(expect.stringMatching(/could not write frame/));

    // Park the recorder so no further tick can re-create the file, then let the
    // last failed tick's cleanup land — it unlinks camera 1's image, and that
    // unlink is itself I/O. Bounded rather than a fixed sleep: with the fix it
    // converges in a tick or two, and without it the orphan never goes away.
    rec.pause();
    const camDir = join(dir, 'scratch', 's1', 'ep_000', 'cam_right_high');
    for (let i = 0; i < 50 && (await readdir(camDir)).length > 0; i++) {
      await run(h, rec, 20);
    }
    expect(await readdir(camDir)).toEqual([]);
  });

  it('does not average the fps across the gap between two takes', async () => {
    // Two brisk takes ten minutes apart are not a session recorded at one frame
    // a minute — but a rate measured from the session's first frame to its last
    // says exactly that, and every timestamp and the mp4's framerate inherit it.
    await rec.start({ sessionId: 's1', fps: 20, cameras: [] });
    await run(h, rec, 200);
    await rec.nextEpisode();
    h.clock.ms += 600_000; // the operator walks back to the start
    await run(h, rec, 200);

    expect(rec.status().fpsActual).toBeGreaterThan(15);
    expect(rec.status().fpsActual).toBeLessThan(25);
  });

  it('refuses a new session while the previous one is still being written', async () => {
    // The encode can take tens of seconds, and the old stop's cleanup would
    // delete the new session's scratch tree and null out its id.
    await rec.start({ sessionId: 's1', fps: 20, cameras: [] });
    await run(h, rec, 200);
    vi.useRealTimers();
    const stopping = rec.stop();
    await expect(rec.start({ sessionId: 's2', cameras: [] })).rejects.toThrow(
      /still being written/,
    );
    await stopping;
  });

  it('pauses without counting the parked ticks as dropped frames', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: [] });
    await run(h, rec, 200);
    const droppedBefore = rec.status().dropped;
    rec.pause();
    await run(h, rec, 400);
    expect(rec.status().frames).toBe(4);
    expect(rec.status().dropped).toBe(droppedBefore);
    expect(rec.isPaused()).toBe(true);

    rec.resume();
    await run(h, rec, 200);
    expect(rec.status().frames).toBe(8);
    // …and the pause did not halve the rate it reports.
    expect(rec.status().fpsActual).toBeGreaterThan(15);
  });

  it('reports the episode numbers the dataset ended up with, not its own', async () => {
    // The writer re-indexes densely, so an operator who discards take 1 of
    // three leaves 0 and 2 in the recorder and 0 and 1 in the file. Handing the
    // platform its own numbering would give it episode ids that address nothing.
    await rec.start({ sessionId: 's1', fps: 20, cameras: [] });
    await run(h, rec, 200);
    await rec.nextEpisode();
    await run(h, rec, 200);
    await rec.nextEpisode();
    await run(h, rec, 200);
    vi.useRealTimers();
    await rec.discardEpisode(1);

    const result = await rec.stop();
    expect(result.ok).toBe(true);
    expect(result.episodes.map((e) => e.episodeIndex)).toEqual([0, 1]);
    const lines = (await readFile(join(result.datasetPath!, 'meta/episodes.jsonl'), 'utf-8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.episode_index)).toEqual([0, 1]);
    expect(result.totalEpisodes).toBe(2);
  });

  it('records the scene, the sim boot and the drop count as provenance', async () => {
    await rec.start({ sessionId: 's1', fps: 20, cameras: [], inputMode: 'vr_controller' });
    await run(h, rec, 200);
    vi.useRealTimers();
    const result = await rec.stop();
    const info = JSON.parse(await readFile(join(result.datasetPath!, 'meta/info.json'), 'utf-8'));
    expect(info._neodem.droppedFrames).toBe(result.totalDropped);
    expect(info._neodem).toMatchObject({
      scene: 'g1_dex3_house_scene.xml',
      simBootId: 'boot-1',
      simulated: true,
      inputMode: 'vr_controller',
      shadows: false,
    });
  });
});

describe.skipIf(!HAVE_FFMPEG)('EpisodeRecorder with cameras', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'episode-recorder-cam-'));
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes one video per camera with as many frames as it recorded', async () => {
    const h = harness();
    const rec = new EpisodeRecorder({
      hooks: h.hooks,
      robotType: 'g1_edu',
      scratchRoot: join(dir, 'scratch'),
      datasetRoot: join(dir, 'datasets'),
    });
    await rec.start({ sessionId: 's1', fps: 20, cameras: ['head_camera', 'house_iso'] });
    // Two cameras means two real JPEG writes per tick, and a tick that fires
    // while the previous one is still writing is dropped by design — so 400 ms
    // of ticks can leave nothing to encode on a busy box (TASK-218). Wait for
    // the frames instead.
    await runUntilFrames(h, rec, 2);
    vi.useRealTimers();
    const result = await rec.stop();

    expect(result.ok).toBe(true);
    expect(result.videoFeatures.sort()).toEqual([
      'observation.images.cam_right_high',
      'observation.images.cam_third_person',
    ]);
    for (const key of ['cam_right_high', 'cam_third_person']) {
      const mp4 = join(
        result.datasetPath!,
        'videos',
        `observation.images.${key}`,
        'chunk-000',
        'file-000.mp4',
      );
      expect(existsSync(mp4), key).toBe(true);
      const probe = spawnSync('ffprobe', [
        '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', mp4,
      ]);
      if (probe.status === 0) {
        expect(parseInt(probe.stdout.toString().trim(), 10)).toBe(result.totalFrames);
      }
    }
    // 64x48 came from the JPEG itself, not from a default.
    const info = JSON.parse(await readFile(join(result.datasetPath!, 'meta/info.json'), 'utf-8'));
    expect(info.features['observation.images.cam_right_high'].shape).toEqual([48, 64, 3]);
  }, 60_000);

  it('leaves per-episode image directories while recording', async () => {
    const h = harness();
    const rec = new EpisodeRecorder({
      hooks: h.hooks,
      robotType: 'g1_edu',
      scratchRoot: join(dir, 'scratch'),
      datasetRoot: join(dir, 'datasets'),
    });
    await rec.start({ sessionId: 's1', fps: 20, cameras: ['head_camera'] });
    // No sleep before the count. A tick writes its JPEGs and pushes its row in
    // the same continuation, so observing between the two sees one more file
    // than frame — but `run` waits for the tick rather than for a fixed 50 ms
    // that a busy disk can outlast, so there is nothing mid-flight left to race.
    await run(h, rec, 200);
    vi.useRealTimers();

    const files = await readdir(join(dir, 'scratch', 's1', 'ep_000', 'cam_right_high'));
    expect(files.length).toBe(rec.status().frames);
    expect(files.every((f) => /^f_\d{6}\.jpg$/.test(f))).toBe(true);
    await rec.stop();
  }, 60_000);
});

describe('per-episode retargeting labels (TASK-216)', () => {
  let dir: string;
  let h: Harness;
  let rec: EpisodeRecorder;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'episode-modes-'));
    h = harness();
    rec = new EpisodeRecorder({
      hooks: h.hooks,
      robotType: 'g1_edu',
      scratchRoot: join(dir, 'scratch'),
      datasetRoot: join(dir, 'datasets'),
    });
    // Module-level state shared by every recorder in the process: without this
    // a mode marked by an earlier test is still "seen" here and these
    // assertions pass no matter what the recorder does.
    resetTeleopModes();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (rec.isRecording()) await rec.stop().catch(() => {});
    await rm(dir, { recursive: true, force: true });
    resetTeleopModes();
  });

  it('ignores what drove the robot before Start was pressed', async () => {
    // THE BUG THIS PINS, found in a live run. The tracker is emptied only by a
    // recorder tick, so a mode marked while the operator was lining the robot
    // up landed on episode 0 — a take driven purely by IK came out labelled
    // `ik+orientation` because the arm had been nudged by hand beforehand.
    markTeleopMode('manual');
    await rec.start({ sessionId: 's', fps: 20, cameras: [] });
    markTeleopMode('ik');
    await run(h, rec, 300);
    vi.useRealTimers();
    const stopped = await rec.stop();
    expect(stopped.ok).toBe(true);
    expect(stopped.episodes[0]!.retargetModes).toEqual(['ik']);
  });

  it('labels each take with what drove THAT take', async () => {
    await rec.start({ sessionId: 's', fps: 20, cameras: [] });
    markTeleopMode('ik');
    await run(h, rec, 300);
    await rec.nextEpisode();
    markTeleopMode('orientation');
    await run(h, rec, 300);
    vi.useRealTimers();
    const stopped = await rec.stop();
    expect(stopped.ok).toBe(true);
    // Not a session-wide union. An operator who changes how they are driving
    // between takes gets two differently labelled episodes, which is the whole
    // point: a dataset that mixes them silently is a trap for whoever trains
    // on it.
    expect(stopped.episodes[0]!.retargetModes).toEqual(['ik']);
    expect(stopped.episodes[1]!.retargetModes).toEqual(['orientation']);
  });

  it('says both when one take used both', async () => {
    await rec.start({ sessionId: 's', fps: 20, cameras: [] });
    markTeleopMode('ik');
    markTeleopMode('hand-tracking');
    await run(h, rec, 300);
    vi.useRealTimers();
    const stopped = await rec.stop();
    expect(stopped.ok).toBe(true);
    expect(stopped.episodes[0]!.retargetModes).toEqual(['hand-tracking', 'ik']);
  });

  it('carries the label into meta/episodes, where a trainer would read it', async () => {
    markTeleopMode('ik');
    await rec.start({ sessionId: 's', fps: 20, cameras: [] });
    markTeleopMode('hand-tracking');
    await run(h, rec, 300);
    vi.useRealTimers();
    const stopped = await rec.stop();
    expect(stopped.ok).toBe(true);
    const lines = await readFile(join(stopped.datasetPath!, 'meta', 'episodes.jsonl'), 'utf-8');
    const rows = lines.trim().split('\n').map((l) => JSON.parse(l) as { retarget_modes: string[] });
    expect(rows[0]!.retarget_modes).toEqual(['hand-tracking']);

    // And in the file lerobot ACTUALLY reads. `episodes.jsonl` is this repo's
    // own twin of it, written twenty lines away from the parquet row and from
    // a different expression — `[...modes]` there against `modes.join('+')`
    // here — so asserting the jsonl says nothing about what a trainer opening
    // the dataset would see.
    const episodes = await readParquet(
      join(stopped.datasetPath!, 'meta/episodes/chunk-000/file-000.parquet'),
    );
    expect(episodes[0]!.retarget_modes).toBe('hand-tracking');
  });

  it('joins several modes with + in the parquet, and drops them with the take', async () => {
    await rec.start({ sessionId: 's', fps: 20, cameras: [] });
    markTeleopMode('orientation');
    await run(h, rec, 300);
    // Discard the LIVE take and re-record it driven purely by IK. Before this
    // was fixed the mode set survived the discard — the `LiveEpisode` object is
    // reused for the re-recorded frames — and the dataset claimed
    // `ik+orientation` with not one orientation-driven frame in it. That mixed
    // provenance is the exact claim this column exists to prevent.
    await rec.discardEpisode(0);
    markTeleopMode('ik');
    await run(h, rec, 300);
    await rec.nextEpisode();
    markTeleopMode('ik');
    markTeleopMode('hand-tracking');
    await run(h, rec, 300);
    vi.useRealTimers();
    const stopped = await rec.stop();
    expect(stopped.ok).toBe(true);
    expect(stopped.episodes[0]!.retargetModes).toEqual(['ik']);
    const episodes = await readParquet(
      join(stopped.datasetPath!, 'meta/episodes/chunk-000/file-000.parquet'),
    );
    expect(episodes[0]!.retarget_modes).toBe('ik');
    expect(episodes[1]!.retarget_modes).toBe('hand-tracking+ik');
  });
});
