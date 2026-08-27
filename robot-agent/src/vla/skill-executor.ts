/**
 * @file skill-executor.ts
 * @description Closed-loop skill executor — runs observe → predict → execute
 * against vla-server. Replaces the TASK-143 stub on
 * `POST /robots/:id/skills/execute`.
 *
 * ONE loop for sim and hardware (TASK-146 final 20%). The only difference
 * between modes is where frames and joint state come from, and whether
 * actions actually move anything:
 *
 *   mode=sim       — synthetic gray frames + sim telemetry, actions discarded
 *   mode=hardware  — real frames via sidecar `/cameras/:n/snapshot`, real
 *                    joint state via sidecar `/state/fast`, real actions
 *                    via sidecar `/action`, delta-clipped for motor safety
 *
 * The previous design delegated hardware mode to a Python thread
 * (VLARunner) which owned its own camera stack. That was fragile and
 * architecturally redundant — everything VLARunner did is now a small
 * set of sidecar HTTP endpoints driven by TS.
 *
 * TASK-183 adds Real-Time Chunking on top of that: with `VLA_RTC_ENABLED` the
 * loop asks for chunk N+1 while chunk N is still executing and crossfades the
 * two across the boundary, so a boundary no longer costs a full `/predict` of
 * dead air. Off by default, and off means the loop below runs the same
 * statements it ran before — every RTC branch is gated on a `rtc` that is
 * `null` when disabled — and says the same things: the boundary counters ride
 * on the run result only when RTC actually ran. See {@link RtcMetrics}.
 *
 * Prefetching is not unconditional. A merged chunk is shorter than the one the
 * backend answered with — the actions covering the timesteps that elapsed
 * during inference are dropped — so every merge brings the next boundary
 * forward, and once the round trip outgrows the lead the queue can buy, those
 * extra boundaries cost more than the one they replaced. RTC therefore weighs
 * each prefetch against the serial refill at the measured latency and declines
 * when it would lose ({@link rtcPrefetchPaysOff}), and gives each boundary
 * exactly one attempt whether it succeeds or fails.
 *
 * What RTC overlaps is the `/predict` — vla-server, another process on another
 * machine. It does NOT overlap anything at the robot's own sidecar: the
 * prefetch's observation is captured on the loop's thread, so this executor
 * issues at most one sidecar request at a time with RTC on or off. See
 * {@link SkillExecutor.maybePrefetch} for why that matters more than it
 * sounds.
 *
 * TASK-179 adds LeRobot-0.6.0-style rollout strategies on top of the same
 * loop (see {@link RolloutStrategy}): `sentry` (sidecar dataset recording),
 * `highlight` (frame ring buffer → incident + clip on failure/abort), and
 * `dagger` (sim teleop pre-emption → InterventionEpisode). `default` keeps
 * the exact pre-TASK-179 behavior.
 *
 * @feature vla
 * @status live
 */

import { EventEmitter } from 'events';
import type { RobotStateManager } from '../robot/state.js';
import { hardwareClient } from '../hardware/HardwareClient.js';
import { config } from '../config/config.js';
import type { RolloutStrategy } from './types.js';

const VLA_SERVER_URL_DEFAULT = 'http://localhost:8000';

/**
 * Per-joint delta clip for real-arm safety. At the default 5 Hz this is a
 * 25°/s max slew rate — matches VLARunner's `max_delta = 5` default and
 * prevents servo stall from a sudden VLA action spike. It is a per-STEP bound,
 * not a per-second one, so a shorter `loopPeriodMs` raises the slew rate it
 * permits in the same proportion.
 *
 * Exported so a test can assert the property rather than the number: nothing
 * outside `clipAction` should be reading it at runtime.
 */
export const MAX_DELTA_DEGREES = 5;

/** Per-step vla-server /predict timeout. */
const PREDICT_TIMEOUT_MS = 3_000;

/** Max consecutive /predict failures before we bail with 'vla-server unreachable'. */
const MAX_PREDICT_FAILURES = 3;

/**
 * How much better than the serial boundary a prefetch has to be before RTC
 * issues it (TASK-183). See {@link rtcPrefetchPaysOff} for why a margin rather
 * than a straight comparison, and what 1.5 was chosen against.
 */
const RTC_PAYOFF_MARGIN = 1.5;

/**
 * Weight of the previous estimate when the latest `/predict` was faster than
 * it. The estimate rises to a new peak immediately and comes back down at 20%
 * of the remaining gap per round trip — three of them cover about half the
 * gap, seven about four fifths — so a single slow predict makes RTC cautious
 * at once while a single fast one cannot talk it back into prefetching
 * (TASK-183). Those are the arithmetic of 0.8^n, not a measurement: no test
 * drives a falling latency, so the decay's shape is unexercised.
 */
const RTC_LATENCY_DECAY = 0.8;

// 32×32 gray JPEG (Pillow-generated, quality=70). Used only when a camera
// source isn't available (pure sim). The real hardware path replaces this
// with snapshots from the sidecar.
const SYNTHETIC_GRAY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooooAKKKKACiiigAooooA/9k=';

export type SkillExecutionMode = 'sim' | 'hardware';
export type SkillExecutionStatus = 'completed' | 'failed' | 'aborted' | 'timeout';

/**
 * Highlight ring capacity: ~15 s of frames at the 5 Hz loop rate. In practice
 * hardware frames are captured once per action-chunk refill, so the buffer
 * usually spans more wall time — 75 is the hard memory bound either way.
 */
const HIGHLIGHT_MAX_FRAMES = 75;

/** Hard cap on collected dagger steps — maxSteps already bounds this in practice. */
const DAGGER_MAX_STEPS = 5_000;

/** One buffered camera frame for the `highlight` strategy. */
export interface HighlightFrame {
  /** Capture time, Unix epoch ms. */
  t: number;
  /** Sidecar/vla-server camera name the frame came from. */
  camera: string;
  /** Base64-encoded JPEG. */
  jpegB64: string;
}

/**
 * Bounded FIFO of the most recent camera frames. Only ONE camera is buffered
 * (the first configured one) to bound memory: 75 frames × ~20 KB JPEG ≈ 1.5 MB.
 */
export class HighlightRing {
  private buf: HighlightFrame[] = [];

  constructor(private readonly capacity: number = HIGHLIGHT_MAX_FRAMES) {}

  push(frame: HighlightFrame): void {
    this.buf.push(frame);
    if (this.buf.length > this.capacity) {
      this.buf.splice(0, this.buf.length - this.capacity);
    }
  }

  get frames(): readonly HighlightFrame[] {
    return this.buf;
  }

  get size(): number {
    return this.buf.length;
  }
}

/** One step of a dagger rollout trace (contract §7). */
export interface InterventionStep {
  /** Milliseconds since rollout start. */
  t: number;
  /** Who produced the applied action for this step. */
  source: 'human' | 'policy';
  /** The applied joint-target vector. */
  action: number[];
}

export interface RolloutRecordingMeta {
  repoId: string;
  status: 'recording' | 'recorded' | 'skipped' | 'failed';
}

/** Optional per-strategy metadata attached to a rollout result (TASK-179). */
export interface RolloutMetadata {
  strategy: RolloutStrategy;
  /** sentry: sidecar recording outcome. */
  recording?: RolloutRecordingMeta;
  /** highlight: server incident created on failure/abort. */
  incidentId?: string;
  /** dagger: number of human-sourced (teleop pre-empted) steps. */
  interventionSteps?: number;
  /** Human-readable notes (sim no-ops, best-effort upload failures, …). */
  notes?: string[];
}

/**
 * Per-run Real-Time Chunking counters (TASK-183).
 *
 * Counted on every run, but attached to the result ONLY when RTC was on. The
 * counters are two `Date.now()`s and keep the loop a single path; *reporting*
 * them is not so cheap — `result.rtc` reaches the `[Skill]` log line, both
 * response bodies of `/skills/execute`, and the per-episode `metadata` this
 * agent POSTs to the platform's `/api/evaluation/episodes`. TASK-183 asks for
 * a strictly opt-in optimisation, so a run with RTC off has to produce the
 * same bytes on all four as it did before this task existed, which it cannot
 * do while carrying a block of counters nobody asked for.
 *
 * That does cost the A/B its self-reported baseline. It was never the honest
 * one anyway: with RTC off the boundary stall IS the `/predict` round trip by
 * construction, so the baseline is the run's own wall clock against the same
 * skill with RTC on — which is what the A/B test in the suite measures.
 *
 * Nothing here changes what the loop does — see {@link RtcState} for the parts
 * that do, all of which are gated on RTC being enabled.
 */
export interface RtcMetrics {
  /** Chunks that entered the action queue after the initial fill. */
  chunkTransitions: number;
  /**
   * Transitions the robot had to sit through with an empty queue. This is the
   * number RTC is meant to drive to zero; `chunkTransitions` is its
   * denominator.
   */
  stalledTransitions: number;
  /** Total milliseconds the queue was empty mid-run, across all transitions. */
  totalStallMs: number;
  /** Worst single stall, in milliseconds. */
  maxStallMs: number;
  /**
   * Prefetch `/predict` calls actually SENT to vla-server — so this number can
   * be reconciled against the server's own request count. An attempt whose
   * speculative capture threw never reaches `/predict` and is counted in
   * {@link prefetchFailed} only.
   */
  prefetchIssued: number;
  /** Prefetched chunks spliced into a still-executing queue — stalls avoided. */
  prefetchMerged: number;
  /** Prefetches that failed or returned nothing; the boundary fell back to serial. */
  prefetchFailed: number;
  /** Prefetches whose whole chunk had been overtaken by the time they landed. */
  prefetchStale: number;
  /**
   * Boundaries where RTC declined to prefetch because, at the measured
   * `/predict` latency, prefetching would have cost the robot MORE dead time
   * than simply refilling on the serial path — see {@link rtcPrefetchPaysOff}.
   * A run with a high `prefetchSkipped` is not RTC failing; it is RTC
   * declining to make things worse, and its boundaries cost what they cost
   * with the feature off.
   */
  prefetchSkipped: number;
  /**
   * Steps whose applied action really was a crossfade of the outgoing and
   * incoming chunks. Counted where the action is popped, not where the blend
   * is scheduled: a crossfade at the head of the queue can still be replaced
   * by the next merge, dropped by a dagger teleop pre-emption, or left unplayed
   * when the run ends, and counting those would make the number a statement
   * about the queue rather than about the robot.
   */
  blendedSteps: number;
}

export interface SkillExecutionResult {
  status: SkillExecutionStatus;
  mode: SkillExecutionMode;
  steps: number;
  durationMs: number;
  message?: string;
  error?: string;
  lastAction?: number[];
  /** Present only when a non-default rollout strategy was requested. */
  rollout?: RolloutMetadata;
  /**
   * Chunk-boundary timing for this run (TASK-183). Present ONLY when RTC was
   * enabled — an RTC-off run answers exactly what it answered before the
   * feature existed. See {@link RtcMetrics}.
   */
  rtc?: RtcMetrics;
}

export interface SkillExecutorOptions {
  skillId: string;
  taskPrompt: string;
  maxSteps: number;
  timeoutMs: number;
  /** WebSocket / event bus to push step events to. Optional. */
  emitter?: EventEmitter;
  /** Rollout strategy (TASK-179). Defaults to 'default' — zero behavior change. */
  rolloutStrategy?: RolloutStrategy;
  /** Robot ID for server-side reporting (incidents/interventions). Defaults to config.robotId. */
  robotId?: string;
  /** NeoDEM server base URL override (tests). Defaults to NEODEM_SERVER_URL / SERVER_URL. */
  serverBaseUrl?: string;
  /**
   * Control-loop period for this run, ms — the sleep between action sends.
   * Defaults to `config.vla.loopPeriodMs` (`VLA_LOOP_PERIOD_MS`, 200 ms / 5 Hz),
   * so an omitted value is the historical pacing exactly. Same escape hatch as
   * `rtc` below: it is what lets one process A/B two rates without
   * `vi.resetModules()`, which is what an RTC figure at 15 Hz needs.
   *
   * NOT range-checked here — the env var is (see `envNumberChecked`). A caller
   * passing 0 gets an unthrottled loop.
   */
  loopPeriodMs?: number;
  /**
   * Real-Time Chunking overrides for this run (TASK-183). Each key falls back
   * to `config.vla.rtc`, which is read once at import — same escape hatch as
   * `serverBaseUrl`, and the only way a test can toggle RTC without
   * `vi.resetModules()`.
   */
  rtc?: Partial<{ enabled: boolean; overlap: number; blendSteps: number }>;
}

/** Mutable per-run state shared between the loop and the strategy hooks. */
interface RolloutContext {
  strategy: RolloutStrategy;
  mode: SkillExecutionMode;
  /** ISO timestamp taken before the loop starts (intervention episode start). */
  startedAtIso: string;
  /** Resolved control-loop period for this run, ms. See SkillExecutorOptions. */
  loopPeriodMs: number;
  notes: string[];
  /** sentry */
  recording: RolloutRecordingMeta | null;
  /** highlight (hardware): recent camera frames. */
  highlight: HighlightRing;
  /** highlight (sim): lightweight step log instead of frames. */
  simStepLog: Array<{ t: number; action: number[] }>;
  /** dagger: full human/policy step trace. */
  interventionSteps: InterventionStep[];
  /** dagger: count of human-sourced steps. */
  humanSteps: number;
  /** Chunk-boundary counters. Reported only on an RTC run — see RtcMetrics. */
  rtcMetrics: RtcMetrics;
  /** Prefetch/blend state, or null when RTC is disabled for this run. */
  rtc: RtcState | null;
}

interface VlaConfig {
  cameras: string[];
  stateDim: number;
  chunkSize: number;
}

/**
 * Live Real-Time Chunking state for one run. Exists only when RTC is enabled;
 * every RTC branch in `runLoop` is gated on `rtc !== null`, so a disabled run
 * executes the same statements it did before TASK-183.
 */
interface RtcState {
  /** Fraction of a chunk still queued that triggers the prefetch. */
  overlap: number;
  /** Length of the boundary crossfade, in steps. */
  blendSteps: number;
  /**
   * Length of a chunk as the BACKEND answers it. Seeded from `/config`'s
   * `chunk_size` and then updated from what the server actually returns — the
   * reply length is authoritative, `chunk_size` is only advertised.
   *
   * Deliberately NOT the length of the queue currently executing (TASK-183).
   * A merged chunk is only `backendChunkLen - consumed` long, so anchoring the
   * threshold to the live queue let it shrink at every merge, which brought the
   * next boundary forward, which shrank it again. That ratchet is one half of
   * why RTC used to end up slower than the serial loop at high latency.
   */
  backendChunkLen: number;
  /** The single in-flight prefetch, or null. Resolves; never rejects. */
  inflight: Promise<void> | null;
  /** Cancels the in-flight prefetch's HTTP request. */
  cancel: AbortController | null;
  /**
   * Generation of the in-flight prefetch. A cancelled or superseded prefetch
   * that resolves late finds a bumped generation and writes nothing — that is
   * what keeps an orphaned promise out of a dead (or human-driven) run.
   */
  gen: number;
  /**
   * Step the in-flight prefetch's OBSERVATION was taken at, for re-aligning
   * its chunk. The chunk's t=0 is the observation, so this has to be the step
   * the capture happened on and not the step the prefetch was decided on —
   * an over-large `consumed` drops actions that are still in the robot's
   * future and the arm skips forward by the capture latency (TASK-183).
   *
   * The two are now the same step by construction: `maybePrefetch` captures
   * inline, so no step can be applied between the decision and the
   * observation. That is a consequence of the serialisation described there,
   * not an independent choice, and the regression test for it stays.
   */
  issuedAtStep: number;
  /** A resolved chunk waiting to be merged at the top of the next iteration. */
  pending: number[][] | null;
  /** How many actions at the head of the queue are crossfades. */
  blendedAhead: number;
  /**
   * Whether this boundary has already had its one prefetch attempt.
   *
   * Cleared whenever a new chunk becomes the queue (serial refill or merge) and
   * when a prefetch is abandoned, so it tracks "the chunk now executing", not
   * the run. Without it a prefetch that fails FAST — 503, connection refused —
   * cleared `inflight` inside the same sleep and the next step fired another,
   * and the next, until the queue hit 0 — one per step at or below the
   * threshold, so 2 at the shipped default and 4 at overlap 0.5, each one a
   * full getCameras + snapshot + getStateNow burst at the sidecar on hardware.
   * (That is the threshold's own arithmetic; what the suite asserts is the
   * post-latch result, `prefetchIssued === 1` in both parameterisations.) A
   * speculative fetch gets one try; the boundary itself still has the serial
   * refill and its existing retry budget behind it.
   */
  attempted: boolean;
  /**
   * Observed cost of one refill in milliseconds — the capture AND the
   * `/predict` — or 0 before the first one has come back. That is the quantity
   * a prefetch spends its lead on, and on hardware the capture is a real
   * sidecar leg, so timing only the HTTP call would flatter it. Fed by every
   * successful refill, serial or prefetched, and read by
   * {@link rtcPrefetchPaysOff}.
   */
  latencyMs: number;
}

/**
 * Actions still queued at or below which the next `/predict` is issued.
 *
 * Clamped into `[1, backendChunkLen - 1]`. At 0 the serial refill always gets
 * there first, so RTC would be on and do nothing; at `backendChunkLen` the
 * threshold is met by a *full* queue, so every step would fire a `/predict`.
 * The config parser already refuses an overlap outside (0, 1] — this clamp
 * covers the remaining case, a server that returns a chunk far shorter than it
 * advertised.
 *
 * The threshold is deliberately NOT adapted to the observed latency (TASK-183).
 * Firing earlier does buy more lead, but it does not buy a longer chunk: a
 * prefetch that lands without stalling is merged at the next loop top whatever
 * the queue depth, so `consumed` — and with it the `backendChunkLen - consumed`
 * the merge leaves behind — is set by the round trip, not by when we asked.
 * NOT MEASURED: the suite exercises the shipped threshold only (chunk 8 /
 * overlap 0.25 → 2), so the argument above is the mechanism, not a comparison
 * against a run at a wider overlap. What the suite does establish is the other
 * half — that the lead is bought back by {@link rtcPrefetchPaysOff} declining
 * instead; see the sweep and the payoff-policy unit tests.
 */
function rtcThreshold(rtc: RtcState): number {
  const ceiling = Math.max(rtc.backendChunkLen - 1, 1);
  return Math.max(1, Math.min(ceiling, Math.round(rtc.backendChunkLen * rtc.overlap)));
}

/**
 * How much dead time a prefetch issued right now would leave, per step of the
 * chunk it would leave behind, against the same figure for not issuing it.
 * A prefetch is worth making only when it wins by {@link RTC_PAYOFF_MARGIN}.
 *
 * RTC is not free. A merged chunk is `backendChunkLen - consumed` long, because
 * the actions describing timesteps the robot lived through during inference are
 * dropped; so every merge brings the NEXT boundary forward. While the prefetch
 * covers the whole round trip that is a pure win — the boundaries it creates
 * cost nothing. Once the round trip outruns the lead the queue can buy, each of
 * those extra boundaries costs the residual wait, and past some latency the
 * arithmetic turns: unconditional prefetching would then leave the robot with
 * MORE dead air than the serial loop it replaced, and every latency that does
 * it sits inside `PREDICT_TIMEOUT_MS`, so nothing else would bound it.
 *
 * How far past is what this function decides, and it is decided from the
 * numbers below rather than from a rollout: at the shipped chunk 8 / overlap
 * 0.25 the cut-off falls at 1.2 s. That figure is asserted directly, on this
 * function, in `rtcPrefetchPaysOff — the prefetch policy, in isolation`. The
 * degradation the policy exists to prevent is NOT measured on this branch —
 * the code that would exhibit it (prefetching without this check) no longer
 * exists, so nothing in the tree can reproduce it.
 *
 * The comparison is therefore made in the only unit that is fair across two
 * different boundary rates: milliseconds of stall per step executed.
 *
 * - Serial pays the whole round trip once per `backendChunkLen` steps.
 * - A prefetch pays `latencyMs - lead` once per `backendChunkLen - consumed`
 *   steps, where `lead` is the wall time the queue can still cover: the loop
 *   sleeps one period after issuing and one before each remaining pop, so a
 *   queue of `queueLen` is worth `(queueLen + 1)` periods.
 *
 * The margin is what makes this safe on SHORT runs as well as in the limit. The
 * rates above are steady-state; a 16-step sim rollout has room for one serial
 * boundary and two RTC ones, so a prefetch that wins narrowly per step can
 * still lose over the run. At 1.5 the cut-off lands on 1.2 s for the shipped
 * chunk 8 / overlap 0.25. The suite's sweep runs the 16-step rollout, and only
 * that one — nothing on this branch has been run on hardware, or at any other
 * run length.
 *
 * Returns true before the first round trip has been observed (`latencyMs` 0):
 * with nothing measured there is nothing to weigh, and the first boundary is
 * the one RTC most reliably wins.
 */
export function rtcPrefetchPaysOff(o: {
  /** Observed capture + `/predict` round trip, ms. 0 = not measured yet. */
  latencyMs: number;
  /** Actions still queued at the moment of the decision. */
  queueLen: number;
  /** Chunk length as the backend answers it — NOT the merged queue length. */
  backendChunkLen: number;
  /**
   * Loop period the run is pacing at, ms. Omitted means the configured one
   * (`VLA_LOOP_PERIOD_MS`, 200 ms by default) — every cut-off quoted above is
   * a figure at that 5 Hz, and halving the period halves the lead a queue of a
   * given depth is worth.
   */
  loopPeriodMs?: number;
}): boolean {
  if (o.latencyMs <= 0) return true;
  const loopPeriodMs = o.loopPeriodMs ?? config.vla.loopPeriodMs;
  const leadMs = (o.queueLen + 1) * loopPeriodMs;
  const stallMs = Math.max(0, o.latencyMs - leadMs);
  // The prefetch covers the whole round trip: this boundary costs nothing at
  // all, so there is no rate to compare.
  if (stallMs === 0) return true;
  // Steps the robot gets through before the chunk lands, and so the actions the
  // merge will drop. Bounded by the queue: once it is empty the robot is frozen
  // and stops consuming the chunk's future.
  const consumed = Math.min(o.queueLen, Math.ceil(o.latencyMs / loopPeriodMs));
  const rtcStallPerStep = stallMs / Math.max(1, o.backendChunkLen - consumed);
  const serialStallPerStep = o.latencyMs / Math.max(1, o.backendChunkLen);
  return rtcStallPerStep * RTC_PAYOFF_MARGIN < serialStallPerStep;
}

/**
 * Splice a freshly predicted chunk onto the one still executing, crossfading
 * the overlap (Real-Time Chunking, arXiv:2506.07339).
 *
 * `incoming` was predicted from an observation taken `consumed` steps ago, so
 * its first `consumed` actions describe timesteps the robot has already lived
 * through; they are dropped. What remains is time-aligned with `queue[0]`, and
 * the two disagree by exactly as much as the world moved during inference — a
 * hard splice there is the discontinuity RTC exists to remove. The first
 * `blendSteps` of the aligned pair are therefore averaged on a linear ramp
 * (`wNew = (i + 1) / (n + 1)`, never fully 0 or 1), after which the new chunk
 * stands alone: the stale tail of the old one is *discarded*, not appended,
 * which is the whole point of having predicted again.
 *
 * Note this is a different alignment from `hardware/vla_runner.py`'s
 * `RTCActionQueue.merge`, which appends the new chunk after the old queue and
 * fades only its last few steps — that treats the new chunk as the *future* of
 * the old one, so the queue grows on every merge and the freshest predictions
 * are always played last. Same ramp, deliberately different splice point.
 *
 * Vectors of unequal length are taken verbatim from whichever side has the
 * joint. A server that changes action dim mid-run is a bug, but not one worth
 * NaN-ing a moving arm over.
 */
export function blendChunks(
  queue: readonly number[][],
  incoming: readonly number[][],
  consumed: number,
  blendSteps: number,
): { queue: number[][]; blended: number } {
  const drop = Math.min(Math.max(consumed, 0), incoming.length);
  const aligned = incoming.slice(drop);
  // Overtaken entirely: nothing in this chunk is still in the future.
  if (aligned.length === 0) return { queue: queue.map((a) => a.slice()), blended: 0 };
  // Nothing to fade against — this is the serial refill, by another route.
  if (queue.length === 0) return { queue: aligned.map((a) => a.slice()), blended: 0 };

  // Floor first: `blendSteps` is typed `number`, and a fractional one survives
  // both `Math.max` and `Math.min` to become a fractional loop bound below,
  // where `aligned[i]` is `undefined` and `.slice()` throws out of the rollout.
  // `envNumberChecked` rejects non-integers, so this guards the exported
  // function and the `SkillExecutorOptions.rtc` path, not the env path.
  const n = Math.min(Math.max(Math.floor(blendSteps) || 0, 0), queue.length, aligned.length);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const wNew = (i + 1) / (n + 1);
    const wOld = 1 - wNew;
    const old = queue[i];
    const fresh = aligned[i];
    const dim = Math.max(old.length, fresh.length);
    const merged = new Array<number>(dim);
    for (let j = 0; j < dim; j++) {
      const o = old[j];
      const f = fresh[j];
      if (o === undefined) merged[j] = f;
      else if (f === undefined) merged[j] = o;
      else merged[j] = wOld * o + wNew * f;
    }
    out.push(merged);
  }
  for (let i = n; i < aligned.length; i++) out.push(aligned[i].slice());
  return { queue: out, blended: n };
}

/**
 * One closed-loop skill execution. The route handler creates one per
 * call and registers it with `skillExecutorRegistry` so abort can find it.
 */
export class SkillExecutor {
  private aborted = false;
  private fetchImpl: typeof fetch;

  constructor(
    private readonly robotStateManager: RobotStateManager,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
  }

  abort(): void {
    this.aborted = true;
  }

  isAborted(): boolean {
    return this.aborted;
  }

  async run(opts: SkillExecutorOptions): Promise<SkillExecutionResult> {
    const strategy: RolloutStrategy = opts.rolloutStrategy ?? 'default';
    const mode: SkillExecutionMode = hardwareClient.isAvailable() ? 'hardware' : 'sim';
    const ctx: RolloutContext = {
      strategy,
      mode,
      startedAtIso: new Date().toISOString(),
      loopPeriodMs: opts.loopPeriodMs ?? config.vla.loopPeriodMs,
      notes: [],
      recording: null,
      highlight: new HighlightRing(),
      simStepLog: [],
      interventionSteps: [],
      humanSteps: 0,
      rtcMetrics: {
        chunkTransitions: 0,
        stalledTransitions: 0,
        totalStallMs: 0,
        maxStallMs: 0,
        prefetchIssued: 0,
        prefetchMerged: 0,
        prefetchFailed: 0,
        prefetchStale: 0,
        prefetchSkipped: 0,
        blendedSteps: 0,
      },
      rtc: null,
    };

    // Hardware dagger (leader-arm pre-emption during a real rollout) is OUT OF
    // SCOPE for TASK-179 — during a real rollout the sidecar owns the leader
    // arm (teleop/recording take the serial port exclusively), so pre-emption
    // is sim-teleop only. In hardware mode every step is tagged 'policy'.
    if (strategy === 'dagger' && mode === 'hardware') {
      ctx.notes.push(
        'dagger: hardware mode — teleop pre-emption is sim-only (leader-arm pre-emption out of scope); all steps tagged policy',
      );
    }

    await this.startSentryRecording(ctx, opts);
    let result: SkillExecutionResult;
    try {
      result = await this.runLoop(opts, mode, ctx);
    } finally {
      // Finally-safe: stop the sidecar recorder even if the loop threw, so a
      // crashed rollout never leaves lerobot-record holding the cameras/port.
      //
      // Same reasoning for the prefetch: runLoop leaves by eleven different
      // returns plus the sim chunk-cap break, and none of them is a natural
      // place to hang a cancel. Abandoning it here is the one path they all
      // share, so no /predict outlives the run it was issued for.
      if (ctx.rtc) this.cancelPrefetch(ctx.rtc);
      await this.stopSentryRecording(ctx);
    }
    await this.finalizeRollout(ctx, opts, result);
    // Only an RTC run reports boundary timing. `ctx.rtc` is null exactly when
    // RTC is off, and that is the whole gate: attaching the counters would put
    // an `rtc` block on the log line, both response bodies and the evaluation
    // episode POSTed to the platform, on a path where nobody enabled RTC.
    if (ctx.rtc) result.rtc = ctx.rtcMetrics;
    return result;
  }

  /**
   * The TASK-146 closed loop — unchanged behavior for strategy 'default'.
   * Strategy hooks (highlight frame buffering, dagger pre-emption/tagging)
   * are no-ops unless the matching strategy is active.
   */
  private async runLoop(
    opts: SkillExecutorOptions,
    mode: SkillExecutionMode,
    ctx: RolloutContext,
  ): Promise<SkillExecutionResult> {
    const startedAt = Date.now();
    const deadline = startedAt + opts.timeoutMs;
    const baseUrl = process.env.VLA_SERVER_URL ?? VLA_SERVER_URL_DEFAULT;
    // Resolved once per run in `run()`; read here so the rate a rollout paced
    // at is a property of the run, not of module load order.
    const loopPeriodMs = ctx.loopPeriodMs;

    // ── Discover vla-server capabilities (cameras + dims) ───────────
    let vlaConfig: VlaConfig;
    try {
      vlaConfig = await this.fetchVlaConfig(baseUrl);
    } catch (err) {
      return {
        status: 'failed',
        mode,
        steps: 0,
        durationMs: Date.now() - startedAt,
        error: `vla-server /config unreachable at ${baseUrl}: ${this.errMsg(err)}`,
      };
    }

    // Reset policy state once per run (best-effort).
    try {
      await this.fetchImpl(`${baseUrl}/reset`, { method: 'POST' });
    } catch {
      // ignore
    }

    // ── Seed delta clipping with the current joint state ───────────
    // The first VLA action should be rate-limited relative to where the
    // arm actually IS, not relative to zero (which would let it jump).
    let lastActionForClip: number[] | null = null;
    if (mode === 'hardware') {
      try {
        lastActionForClip = await hardwareClient.getStateNow();
      } catch (err) {
        return {
          status: 'failed',
          mode,
          steps: 0,
          durationMs: Date.now() - startedAt,
          error: `Failed to seed initial state: ${this.errMsg(err)}`,
        };
      }
      console.log(
        `[SkillExecutor] Seeded delta clip from arm pose: [${lastActionForClip.map((v) => v.toFixed(1)).join(', ')}]`,
      );
    }

    // ── Main loop ──────────────────────────────────────────────────
    let actionsQueue: number[][] = [];
    let lastApplied: number[] | undefined;
    let step = 0;
    let predictFailures = 0;
    // Real-Time Chunking (TASK-183). `null` when disabled, and every RTC
    // branch below is gated on it, so the off path is the pre-TASK-183 loop.
    const rtc = this.resolveRtc(opts, vlaConfig, ctx);
    // Wall clock at which the queue ran dry mid-run, or 0 while it has actions.
    // Held across the retry `continue` below so a stall that spans several
    // failed /predicts is counted once, in full.
    let stallStartedAt = 0;
    // Stall that ended just before the step about to be applied, for the event.
    let stepStallMs = 0;

    console.log(
      `[SkillExecutor] Running skill=${opts.skillId} mode=${mode} maxSteps=${opts.maxSteps} timeoutMs=${opts.timeoutMs}` +
        (rtc
          ? ` rtc=on(overlap=${rtc.overlap} blendSteps=${rtc.blendSteps})`
          : ''),
    );

    while (step < opts.maxSteps) {
      if (rtc) {
        // A dry queue is not yet a stall. `rtcDrain` below waits only when a
        // prefetch is still in the air with nothing delivered — every other dry
        // queue is either a chunk already sitting in `rtc.pending`, merged in
        // microseconds, or a boundary the serial refill owns, which starts its
        // own clock. Timing the first case as a stall recorded a ~0 ms wait AND
        // incremented the counter, so a run that removed every stall reported
        // `stalls=2/2 total=0 max=0` — the one number TASK-183 asks for,
        // contradicting itself. Only the wait is counted here.
        if (
          actionsQueue.length === 0 &&
          step > 0 &&
          stallStartedAt === 0 &&
          rtc.pending === null &&
          rtc.inflight !== null
        ) {
          stallStartedAt = Date.now();
        }
        // Adopt a resolved prefetch before deciding whether we have to stall —
        // and if the queue ran dry with one still in flight, wait for THAT
        // rather than issuing a second /predict for the same boundary.
        actionsQueue = await this.rtcDrain(rtc, ctx, actionsQueue, step);
      }
      if (this.aborted) {
        return this.abortedResult(mode, step, startedAt, lastApplied);
      }
      if (Date.now() > deadline) {
        return {
          status: 'timeout',
          mode,
          steps: step,
          durationMs: Date.now() - startedAt,
          lastAction: lastApplied,
          message: `Timeout after ${opts.timeoutMs}ms`,
        };
      }

      // ── Refill action queue if empty ─────────────────────────────
      if (actionsQueue.length === 0) {
        // Two Date.now()s and a counter — the loop still does exactly what it
        // did, it now just says how long it spent doing nothing.
        if (step > 0 && stallStartedAt === 0) stallStartedAt = Date.now();
        // Start of the round trip RTC's payoff policy weighs against the lead
        // the queue can buy: capture AND predict, because a prefetch spends its
        // lead on both. On hardware the capture is a real sidecar leg.
        const roundTripStartedAt = Date.now();
        let images: Record<string, string>;
        let state: number[];

        try {
          ({ images, state } = await this.captureObservation(ctx, mode, vlaConfig));
        } catch (err) {
          return {
            status: 'failed',
            mode,
            steps: step,
            durationMs: Date.now() - startedAt,
            error: `Capture failed: ${this.errMsg(err)}`,
          };
        }

        // Call vla-server /predict with a hard timeout.
        const predictResult = await this.predict(baseUrl, images, state, opts.taskPrompt);
        if (!predictResult.ok) {
          // Client errors (4xx) are deterministic — fail immediately.
          if (!predictResult.retryable) {
            return {
              status: 'failed',
              mode,
              steps: step,
              durationMs: Date.now() - startedAt,
              error: predictResult.error,
            };
          }
          // Transient failure: retry up to MAX_PREDICT_FAILURES times.
          predictFailures += 1;
          if (predictFailures >= MAX_PREDICT_FAILURES) {
            return {
              status: 'failed',
              mode,
              steps: step,
              durationMs: Date.now() - startedAt,
              error: `vla-server /predict failed ${predictFailures}x: ${predictResult.error}`,
            };
          }
          await sleep(loopPeriodMs);
          continue;
        }
        predictFailures = 0;
        actionsQueue = predictResult.actions;
        if (actionsQueue.length === 0) {
          return {
            status: 'failed',
            mode,
            steps: step,
            durationMs: Date.now() - startedAt,
            error: 'vla-server returned empty action chunk',
          };
        }
        if (rtc) {
          // The serial round trip is the same measurement a prefetch makes, and
          // on a boundary RTC declined it is the ONLY one it gets — without it
          // a run that skipped once would never learn that inference had got
          // fast again.
          this.noteLatency(rtc, Date.now() - roundTripStartedAt);
          rtc.backendChunkLen = actionsQueue.length;
          // A fresh chunk is a fresh boundary: it gets its own attempt.
          rtc.attempted = false;
        }
        if (step > 0) ctx.rtcMetrics.chunkTransitions += 1;
      }

      // The queue is non-empty from here on, by either route. If it had run
      // dry, this is where the robot stopped waiting.
      if (stallStartedAt > 0) {
        stepStallMs = Date.now() - stallStartedAt;
        stallStartedAt = 0;
        ctx.rtcMetrics.stalledTransitions += 1;
        ctx.rtcMetrics.totalStallMs += stepStallMs;
        ctx.rtcMetrics.maxStallMs = Math.max(ctx.rtcMetrics.maxStallMs, stepStallMs);
      }

      // ── Pop next action, clip, apply ─────────────────────────────
      const raw = actionsQueue.shift()!;
      // Whether the action just popped is a crossfade. Consumed here because
      // the pop consumes it; whether it is what the robot ends up doing is
      // decided below, by the dagger branch.
      const poppedBlend = rtc !== null && rtc.blendedAhead > 0;
      if (rtc && rtc.blendedAhead > 0) rtc.blendedAhead -= 1;

      // dagger: while the sim teleop override is active, the human joint
      // targets pre-empt the VLA action for this step (tagged 'human').
      // Sim-mode only — see the hardware-dagger scope note in run().
      let source: 'human' | 'policy' = 'policy';
      let chosen = raw;
      if (ctx.strategy === 'dagger' && mode === 'sim' && this.robotStateManager.isTeleopActive()) {
        chosen = this.teleopActionVector(raw.length);
        source = 'human';
        // RTC: the human has the arm. A chunk predicted before they took it —
        // or one being predicted right now, from an observation they are
        // actively invalidating — would land as policy actions spliced in
        // behind their back. Drop both; the next prefetch fires once they let
        // go, from an observation that includes what they did.
        if (rtc) this.cancelPrefetch(rtc);
      }
      // A pre-empted step carries the human's vector verbatim, so it is not a
      // crossfade however the queue was built (TASK-183).
      const blended = poppedBlend && source === 'policy';
      if (blended) ctx.rtcMetrics.blendedSteps += 1;

      const safe =
        mode === 'hardware'
          ? this.clipAction(chosen, lastActionForClip!)
          : chosen;

      if (mode === 'hardware') {
        // Re-check abort right before commanding hardware: a protective stop
        // (e.g. fall detection via the safety loop's abortAll) can fire during
        // the VLA predict await above, after the top-of-loop check.
        if (this.aborted) {
          return this.abortedResult(mode, step, startedAt, lastApplied);
        }
        try {
          await hardwareClient.sendActionVector(safe);
        } catch (err) {
          return {
            status: 'failed',
            mode,
            steps: step,
            durationMs: Date.now() - startedAt,
            error: `Send action failed: ${this.errMsg(err)}`,
          };
        }
        lastActionForClip = safe;
      }

      lastApplied = safe;
      step += 1;

      // dagger: collect the applied step, tagged by its source.
      if (ctx.strategy === 'dagger') {
        if (source === 'human') ctx.humanSteps += 1;
        if (ctx.interventionSteps.length < DAGGER_MAX_STEPS) {
          ctx.interventionSteps.push({ t: Date.now() - startedAt, source, action: safe });
        }
      }
      // highlight (sim): no frames to buffer — keep a lightweight step log.
      if (ctx.strategy === 'highlight' && mode === 'sim') {
        ctx.simStepLog.push({ t: Date.now() - startedAt, action: safe });
        if (ctx.simStepLog.length > HIGHLIGHT_MAX_FRAMES) ctx.simStepLog.shift();
      }

      opts.emitter?.emit('skill:step', {
        skillId: opts.skillId,
        step,
        mode,
        action: safe,
        ts: Date.now(),
        ...(ctx.strategy !== 'default' ? { strategy: ctx.strategy } : {}),
        ...(ctx.strategy === 'dagger' ? { source } : {}),
        // Appended last, and only with RTC on, so the disabled payload keeps
        // the exact keys and order it had — same discipline as `strategy`.
        ...(rtc ? { stallMs: stepStallMs, blended } : {}),
      });
      stepStallMs = 0;

      // In sim mode we cap at 2 chunks to keep dev runs bounded; hardware
      // mode runs the full maxSteps so real-arm executions aren't cut short.
      if (mode === 'sim' && step >= Math.min(opts.maxSteps, vlaConfig.chunkSize * 2)) {
        break;
      }

      // Issued here rather than before the send so the `/predict` flies during
      // the sleep below — the idle window RTC exists to spend.
      //
      // Awaited, and it returns the milliseconds it spent doing so: the
      // prefetch's OBSERVATION is captured here, on the loop's own thread,
      // rather than inside the background promise (TASK-183). See
      // `maybePrefetch` for why the sidecar is not allowed a second caller.
      let prefetchCaptureMs = 0;
      if (rtc) {
        prefetchCaptureMs = await this.maybePrefetch(
          rtc, ctx, opts, mode, vlaConfig, baseUrl, actionsQueue.length, step,
        );
      }

      // The capture is paid OUT OF this step's sleep rather than on top of it,
      // so the next `/action` is not pushed late — the one thing g1_sidecar.py's
      // ramp asks of this loop is a steady ~G1_CONTROL_HZ cadence. In sim
      // `prefetchCaptureMs` is 0 and this is the old `sleep`.
      //
      // That holds only WHILE THE CAPTURE FITS IN THE PERIOD. The subtraction
      // clamps at zero, so a sidecar capture slower than the loop period has
      // nothing left to be paid out of and stretches this one step by the
      // overrun — the jitter is moved out of the DDS lock and into the cadence,
      // not removed. It is a real regime: `getCameras` + one `snapshot` +
      // `getStateNow` at 100 ms each already exceeds a 200 ms period. Nothing
      // here can buy the time back, so the breach is logged rather than hidden;
      // `rtcPrefetchPaysOff` weighs round trip against queue, not capture
      // against period, so it will not decline on this ground.
      if (prefetchCaptureMs > loopPeriodMs) {
        console.warn(
          `[SkillExecutor] RTC prefetch capture ${prefetchCaptureMs}ms exceeded the ` +
            `${loopPeriodMs}ms loop period — this step's /action cadence stretched by ` +
            `${prefetchCaptureMs - loopPeriodMs}ms`,
        );
      }
      await sleep(Math.max(0, loopPeriodMs - prefetchCaptureMs));
    }

    return {
      status: 'completed',
      mode,
      steps: step,
      durationMs: Date.now() - startedAt,
      lastAction: lastApplied,
      message: mode === 'hardware' ? 'Hardware execution completed' : 'Simulated execution completed',
    };
  }

  // ── Rollout strategy helpers (TASK-179) ───────────────────────

  /** NeoDEM server base URL for best-effort reporting POSTs. */
  private serverBaseUrl(opts: SkillExecutorOptions): string {
    return opts.serverBaseUrl ?? process.env.NEODEM_SERVER_URL ?? config.serverUrl;
  }

  /**
   * sentry: start a sidecar `lerobot-record` session covering the rollout.
   * Never fails the rollout — an unavailable/read-only sidecar (G1 stage-1)
   * just logs a warning and the rollout continues un-recorded.
   *
   * Known sidecar-level limitation (SO-101): lerobot-record takes exclusive
   * ownership of the cameras and follower serial port, so the sidecar
   * re-opens them on demand for the loop's snapshot/state/action calls.
   * Resolving that contention lives in the sidecar, not here.
   */
  private async startSentryRecording(ctx: RolloutContext, opts: SkillExecutorOptions): Promise<void> {
    if (ctx.strategy !== 'sentry') return;
    if (ctx.mode !== 'hardware') {
      ctx.notes.push('sentry: sim mode — sidecar dataset recording skipped (no-op)');
      return;
    }
    const repoId = `sentry/${opts.skillId}-${Date.now()}`;
    const res = await hardwareClient.startRecording({
      repoId,
      task: opts.taskPrompt,
      numEpisodes: 1,
      // One long episode covering the whole rollout budget.
      episodeTimeS: Math.max(30, Math.ceil(opts.timeoutMs / 1000)),
      fps: 30,
      resetTimeS: 1,
    });
    if (res.ok) {
      ctx.recording = { repoId, status: 'recording' };
      console.log(`[SkillExecutor] sentry: sidecar recording started (repo_id=${repoId})`);
    } else {
      ctx.recording = { repoId, status: res.readOnly ? 'skipped' : 'failed' };
      ctx.notes.push(
        `sentry: sidecar recording unavailable (${res.error ?? 'unknown'}) — rollout continues un-recorded`,
      );
      console.warn(`[SkillExecutor] sentry: recording start failed: ${res.error ?? 'unknown'}`);
    }
  }

  /** sentry: stop the sidecar recorder (finally-safe, never throws). */
  private async stopSentryRecording(ctx: RolloutContext): Promise<void> {
    if (ctx.recording?.status !== 'recording') return;
    try {
      const res = await hardwareClient.stopRecording();
      ctx.recording.status = res.ok ? 'recorded' : 'failed';
      if (res.ok) {
        console.log(
          `[SkillExecutor] sentry: recording stopped (episodes=${res.episodesRecorded ?? 0}, path=${res.datasetPath ?? 'n/a'})`,
        );
      } else {
        ctx.notes.push(`sentry: recording stop failed (${res.error ?? 'unknown'})`);
        console.warn(`[SkillExecutor] sentry: recording stop failed: ${res.error ?? 'unknown'}`);
      }
    } catch (err) {
      ctx.recording.status = 'failed';
      ctx.notes.push(`sentry: recording stop failed (${this.errMsg(err)})`);
    }
  }

  /**
   * Post-rollout strategy work: attach rollout metadata to the result and run
   * the best-effort server reports (highlight incident + clip, dagger
   * intervention episode). Never throws — reporting failures are logged and
   * noted, the rollout result is returned regardless.
   */
  private async finalizeRollout(
    ctx: RolloutContext,
    opts: SkillExecutorOptions,
    result: SkillExecutionResult,
  ): Promise<void> {
    if (ctx.strategy === 'default') return;

    const meta: RolloutMetadata = { strategy: ctx.strategy };
    if (ctx.recording) meta.recording = ctx.recording;

    if (
      ctx.strategy === 'highlight' &&
      (result.status === 'failed' || result.status === 'aborted' || result.status === 'timeout')
    ) {
      const incidentId = await this.reportHighlightIncident(ctx, opts, result);
      if (incidentId) meta.incidentId = incidentId;
    }

    if (ctx.strategy === 'dagger') {
      meta.interventionSteps = ctx.humanSteps;
      await this.postInterventionEpisode(ctx, opts);
    }

    if (ctx.notes.length > 0) meta.notes = ctx.notes;
    result.rollout = meta;
  }

  /**
   * highlight: create an incident on the NeoDEM server (contract §6) and, when
   * hardware frames were buffered, PUT the clip as raw-body JSON. Sim rollouts
   * create the incident without a clip. Returns the incident id or null.
   */
  private async reportHighlightIncident(
    ctx: RolloutContext,
    opts: SkillExecutorOptions,
    result: SkillExecutionResult,
  ): Promise<string | null> {
    const base = this.serverBaseUrl(opts);
    const robotId = opts.robotId ?? config.robotId;
    let incidentId: string | null = null;
    try {
      const resp = await this.fetchImpl(`${base}/api/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ai_malfunction',
          severity: 'medium',
          title: `VLA rollout ${result.status}: ${opts.skillId}`,
          description:
            `VLA skill rollout ${result.status} after ${result.steps} steps ` +
            `(${result.durationMs}ms, ${ctx.mode} mode, strategy=highlight). ` +
            `Task: "${opts.taskPrompt}".` +
            (result.error ? ` Error: ${result.error}` : '') +
            (ctx.mode === 'sim' ? ` Sim step log: ${ctx.simStepLog.length} steps (no frames).` : ''),
          robotId,
          detectedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) {
        ctx.notes.push(`highlight: incident POST failed (HTTP ${resp.status})`);
        console.warn(`[SkillExecutor] highlight: incident POST failed: HTTP ${resp.status}`);
        return null;
      }
      const body = (await resp.json()) as { id?: string };
      if (!body.id) {
        ctx.notes.push('highlight: incident POST returned no id');
        return null;
      }
      incidentId = body.id;
      console.log(`[SkillExecutor] highlight: incident created (${incidentId})`);
    } catch (err) {
      ctx.notes.push(`highlight: incident POST failed (${this.errMsg(err)})`);
      console.warn(`[SkillExecutor] highlight: incident POST failed: ${this.errMsg(err)}`);
      return null;
    }

    if (ctx.highlight.size > 0) {
      await this.uploadIncidentClip(base, incidentId, ctx);
    } else {
      ctx.notes.push('highlight: no hardware frames buffered — incident created without clip');
    }
    return incidentId;
  }

  /** highlight: PUT the frame ring as raw-body JSON to /api/incidents/:id/clip. */
  private async uploadIncidentClip(base: string, incidentId: string, ctx: RolloutContext): Promise<void> {
    const frames = ctx.highlight.frames;
    const payload = {
      format: 'jpeg-frames' as const,
      fps: this.estimateClipFps(frames, ctx.loopPeriodMs),
      capturedAt: new Date(frames[0].t).toISOString(),
      frames: frames.map((f) => f.jpegB64),
    };
    try {
      const resp = await this.fetchImpl(`${base}/api/incidents/${incidentId}/clip`, {
        method: 'PUT',
        // Raw-body upload (server reads the bytes, not express.json) — the
        // bytes are UTF-8 JSON per contract §6. MUST be octet-stream: an
        // application/json body would be consumed by the server's global
        // express.json parser, whose 10mb limit rejects large clips before
        // the route's raw 32MB path can run.
        headers: { 'Content-Type': 'application/octet-stream' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        ctx.notes.push(`highlight: clip upload failed (HTTP ${resp.status})`);
        console.warn(`[SkillExecutor] highlight: clip upload failed: HTTP ${resp.status}`);
      } else {
        console.log(`[SkillExecutor] highlight: clip uploaded (${frames.length} frames)`);
      }
    } catch (err) {
      ctx.notes.push(`highlight: clip upload failed (${this.errMsg(err)})`);
      console.warn(`[SkillExecutor] highlight: clip upload failed: ${this.errMsg(err)}`);
    }
  }

  /**
   * Effective capture rate of the buffered frames; the run's nominal loop rate
   * (5 Hz at the default period) when there is no span to measure one from.
   */
  private estimateClipFps(frames: readonly HighlightFrame[], loopPeriodMs: number): number {
    if (frames.length >= 2) {
      const spanS = (frames[frames.length - 1].t - frames[0].t) / 1000;
      if (spanS > 0) return Math.round(((frames.length - 1) / spanS) * 100) / 100;
    }
    return 1000 / loopPeriodMs;
  }

  /** dagger: POST the human/policy step trace as an InterventionEpisode (contract §7). */
  private async postInterventionEpisode(ctx: RolloutContext, opts: SkillExecutorOptions): Promise<void> {
    if (ctx.interventionSteps.length === 0) return;
    const base = this.serverBaseUrl(opts);
    try {
      const resp = await this.fetchImpl(`${base}/api/datasets/interventions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          robotId: opts.robotId ?? config.robotId,
          skillId: opts.skillId,
          taskPrompt: opts.taskPrompt,
          strategy: 'dagger',
          startedAt: ctx.startedAtIso,
          endedAt: new Date().toISOString(),
          steps: ctx.interventionSteps,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        ctx.notes.push(`dagger: intervention POST failed (HTTP ${resp.status})`);
        console.warn(`[SkillExecutor] dagger: intervention POST failed: HTTP ${resp.status}`);
      } else {
        console.log(
          `[SkillExecutor] dagger: intervention episode posted (${ctx.interventionSteps.length} steps, ${ctx.humanSteps} human)`,
        );
      }
    } catch (err) {
      ctx.notes.push(`dagger: intervention POST failed (${this.errMsg(err)})`);
      console.warn(`[SkillExecutor] dagger: intervention POST failed: ${this.errMsg(err)}`);
    }
  }

  /**
   * dagger: current sim-teleop joint targets as an action vector in the active
   * embodiment's joint-config order, padded/truncated to the policy's action
   * dim (mirrors buildSimState's convention).
   */
  private teleopActionVector(dim: number): number[] {
    const positions = this.robotStateManager.getTeleopPositions();
    const joints = this.robotStateManager.getActiveJointConfig();
    const vec = joints.map((j) => positions[j.name] ?? j.defaultPosition);
    const out = vec.slice(0, dim);
    while (out.length < dim) out.push(0);
    return out;
  }

  // ── Real-Time Chunking (TASK-183) ─────────────────────────────

  /**
   * Build the per-run RTC state, or `null` when RTC is off.
   *
   * `null` is load-bearing: every RTC branch in `runLoop` is `if (rtc)`, so a
   * disabled run executes the same statements, in the same order, issuing the
   * same HTTP calls, as it did before TASK-183.
   */
  private resolveRtc(
    opts: SkillExecutorOptions,
    vlaConfig: VlaConfig,
    ctx: RolloutContext,
  ): RtcState | null {
    const cfg = { ...config.vla.rtc, ...(opts.rtc ?? {}) };
    if (!cfg.enabled) return null;
    const rtc: RtcState = {
      overlap: cfg.overlap,
      blendSteps: cfg.blendSteps,
      backendChunkLen: vlaConfig.chunkSize,
      inflight: null,
      cancel: null,
      gen: 0,
      issuedAtStep: 0,
      pending: null,
      blendedAhead: 0,
      attempted: false,
      latencyMs: 0,
    };
    ctx.rtc = rtc;
    return rtc;
  }

  /**
   * Fold one observed refill round trip into the estimate RTC decides on.
   *
   * Only successful refills are sampled. A 503 that comes back in 20 ms is not
   * evidence that inference is fast, and a `PREDICT_TIMEOUT_MS` abort is not
   * evidence that it takes exactly three seconds; feeding either in would move
   * the prefetch decision on the strength of a number that measured the wrong
   * thing.
   */
  private noteLatency(rtc: RtcState, ms: number): void {
    rtc.latencyMs =
      rtc.latencyMs === 0
        ? ms
        : Math.max(ms, rtc.latencyMs * RTC_LATENCY_DECAY + ms * (1 - RTC_LATENCY_DECAY));
  }

  /**
   * Take delivery of a prefetched chunk, at the one point in the iteration
   * where the queue is not half-consumed: the top, before the refill check.
   *
   * The resolve handler only parks its chunk in `rtc.pending`; the splice
   * happens here, synchronously with the loop, so a chunk can never land
   * between the pop and the send.
   *
   * If the queue has run dry while a prefetch is still in flight, this waits
   * for it instead of letting the serial path fire a second `/predict` for the
   * same boundary. That wait is a real stall — RTC bought a head start, not
   * necessarily enough of one — and it is the ONLY wait this method can do, so
   * it is exactly the case `runLoop` starts `stallStartedAt` for. A dry queue
   * whose chunk is already in `rtc.pending` returns from here in microseconds
   * and is not a stall at all.
   */
  private async rtcDrain(
    rtc: RtcState,
    ctx: RolloutContext,
    queue: number[][],
    step: number,
  ): Promise<number[][]> {
    if (queue.length === 0 && rtc.inflight) {
      await rtc.inflight;
    }
    const incoming = rtc.pending;
    if (!incoming) return queue;
    rtc.pending = null;

    const consumed = step - rtc.issuedAtStep;
    if (consumed >= incoming.length) {
      // Every action in it described a timestep already lived through. Keep
      // what we have and let the boundary fall to the serial refill.
      ctx.rtcMetrics.prefetchStale += 1;
      console.warn(
        `[SkillExecutor] RTC prefetch landed ${consumed} steps late — whole ${incoming.length}-action chunk stale, discarded`,
      );
      return queue;
    }
    const merged = blendChunks(queue, incoming, consumed, rtc.blendSteps);

    ctx.rtcMetrics.prefetchMerged += 1;
    ctx.rtcMetrics.chunkTransitions += 1;
    // `blendedSteps` is NOT incremented here: `merged.blended` is how many
    // crossfades were scheduled, and the run loop counts them as it plays them.
    rtc.blendedAhead = merged.blended;
    // What the backend answers with, NOT the shortened merge — see
    // `backendChunkLen`. A fresh chunk is a fresh boundary, so it also gets its
    // own prefetch attempt.
    rtc.backendChunkLen = incoming.length;
    rtc.attempted = false;
    return merged.queue;
  }

  /**
   * Fire the next `/predict` without awaiting it, if the queue has drained to
   * the overlap threshold, nothing is already in flight, this boundary has not
   * had its attempt yet, and the round trip is short enough for the attempt to
   * be worth making.
   *
   * Exactly one prefetch exists at a time: a second would double the load on
   * the inference server to buy a lead the loop has no way to spend, and its
   * chunk would be aligned against a queue the first one had already replaced.
   *
   * And exactly one per boundary, in flight or not — `rtc.attempted` is what
   * stops a prefetch that fails fast from being retried on the next step, and
   * the next, for as long as the queue lasts (TASK-183).
   *
   * ## Why the observation is captured HERE, inline, and awaited
   *
   * RTC is the rollout loop's first concurrent caller of anything. The
   * `/predict` it overlaps with execution belongs to vla-server, a separate
   * process on (usually) a separate machine, and overlapping it is the whole
   * point. The OBSERVATION is a different animal: on hardware
   * `captureHardware` is getCameras, one snapshot per camera and getStateNow —
   * three calls to the robot's own sidecar with a single camera, N + 2 with N —
   * and the loop's `sendActionVector` is one more, to the same process. Running
   * the capture inside the background promise put the capture and the send in
   * flight together. The shipped test for this is "serialises the prefetch
   * capture against the loop action send", which requires the recorded overlap
   * list to stay empty; reproducing the overlap needs the capture moved back
   * inside the background promise by hand.
   *
   * That is not a benign overlap:
   *
   * - `g1_sidecar.py` serialises every DDS touch on a single `robot_lock`, and
   *   its `/action` ramp is only physically correct "when the caller drives
   *   /action at ~G1_CONTROL_HZ" (its own words). A state read that takes the
   *   lock in between jitters exactly that cadence.
   * - On SO-101 with the `sentry` strategy it is worse: lerobot-record owns
   *   the cameras and the follower serial port, and the sidecar re-opens them
   *   on demand — see `startSentryRecording`.
   * - TASK-169 landed one commit before this one, on this same read path,
   *   because a concurrent read raced cyclonedds into a half-built IDL type.
   *
   * So the capture is taken on the loop's thread, between the send and the
   * sleep, and only the `/predict` is left in the air. The executor therefore
   * issues at most ONE sidecar request at a time, in the loop's own order,
   * with RTC on or off. (The agent's 2 s telemetry poll in `HardwareClient` is
   * a separate, pre-existing caller and is untouched by this.)
   *
   * This costs the prefetch nothing it was there to buy. The lead RTC spends
   * is the inference round trip, which is the part that stays concurrent; the
   * capture was never overlapped with anything but the loop's own sleep, and
   * the returned duration is subtracted from that sleep by the caller, so the
   * step it happens on keeps its period.
   *
   * @returns milliseconds spent blocking the loop on the capture — 0 when no
   * prefetch was issued, and 0 in sim, where the "capture" is a constant.
   */
  private async maybePrefetch(
    rtc: RtcState,
    ctx: RolloutContext,
    opts: SkillExecutorOptions,
    mode: SkillExecutionMode,
    vlaConfig: VlaConfig,
    baseUrl: string,
    queueLen: number,
    step: number,
  ): Promise<number> {
    if (rtc.inflight || rtc.pending || rtc.attempted || this.aborted) return 0;
    // At 0 the serial refill owns the boundary and starting a prefetch here
    // would only race it. Above the threshold there is still enough queued
    // that a prefetch would be predicted from an older observation than it
    // needs to be, and its chunk more stale on arrival.
    if (queueLen === 0 || queueLen > rtcThreshold(rtc)) return 0;
    // dagger: don't start one while a human is driving — see the cancel in the
    // pop path for why the policy's opinion is worthless right now. NOT an
    // attempt: the boundary is still owed one for when they let go.
    if (
      ctx.strategy === 'dagger' &&
      mode === 'sim' &&
      this.robotStateManager.isTeleopActive()
    ) {
      return 0;
    }
    // Inference has got slow enough that prefetching would cost the robot more
    // dead time than the serial refill. Decline, and burn the boundary's one
    // attempt doing so: the queue only shrinks from here, so the same answer is
    // waiting at every remaining step of it.
    if (
      !rtcPrefetchPaysOff({
        latencyMs: rtc.latencyMs,
        queueLen,
        backendChunkLen: rtc.backendChunkLen,
        loopPeriodMs: ctx.loopPeriodMs,
      })
    ) {
      rtc.attempted = true;
      ctx.rtcMetrics.prefetchSkipped += 1;
      console.warn(
        `[SkillExecutor] RTC skipping prefetch at step ${step}: /predict is running ~${Math.round(rtc.latencyMs)}ms ` +
          `against ${(queueLen + 1) * ctx.loopPeriodMs}ms of queued lead — the serial refill is the cheaper boundary here`,
      );
      return 0;
    }

    const ctrl = new AbortController();
    rtc.cancel = ctrl;
    rtc.gen += 1;
    const gen = rtc.gen;
    rtc.attempted = true;

    // The lead this prefetch spends runs from here until its chunk is usable —
    // capture included, so that `latencyMs` measures the same quantity the
    // serial refill measures and the two are comparable in
    // `rtcPrefetchPaysOff`. That now makes the policy slightly CONSERVATIVE:
    // the capture is paid before the lead starts running down, so the residual
    // the policy weighs is larger than the one the loop will actually see. It
    // errs toward the serial boundary, which is the safe direction, and it
    // errs by the capture latency, which is the small term.
    const roundTripStartedAt = Date.now();
    let obs: { images: Record<string, string>; state: number[] };
    try {
      obs = await this.captureObservation(ctx, mode, vlaConfig);
    } catch (err) {
      // A speculative observation that could not be taken is not a failed run:
      // the boundary drops back to the serial refill, which will try the same
      // sidecar again and report properly if it is really down.
      if (rtc.gen === gen) {
        rtc.cancel = null;
        ctx.rtcMetrics.prefetchFailed += 1;
        console.warn(
          `[SkillExecutor] RTC prefetch capture failed, falling back to serial refill: ${this.errMsg(err)}`,
        );
      }
      return Date.now() - roundTripStartedAt;
    }
    const captureMs = Date.now() - roundTripStartedAt;
    // Nothing can have superseded this while the loop was blocked on the
    // capture above — `cancelPrefetch` is only ever called from the loop — but
    // `abort()` is not the loop and can land here.
    if (rtc.gen !== gen || ctrl.signal.aborted || this.aborted) {
      if (rtc.gen === gen) rtc.cancel = null;
      return captureMs;
    }
    // The chunk's t=0 is the observation just taken, and the loop has not
    // moved since. See `RtcState.issuedAtStep`.
    rtc.issuedAtStep = step;
    // Counted HERE, not at the top of the attempt: a capture that throws, or a
    // generation bumped while the loop was blocked on it, returns above without
    // a `/predict` ever reaching vla-server. Counting those made
    // `prefetchIssued` disagree with the request count an operator can see on
    // the server, and read as "a prefetch landed and was discarded".
    ctx.rtcMetrics.prefetchIssued += 1;
    rtc.inflight = this.runPrefetch(rtc, ctx, opts, baseUrl, ctrl, gen, obs, roundTripStartedAt);
    return captureMs;
  }

  /**
   * The concurrent half of one prefetch: the `/predict`, and parking its chunk
   * for the loop to merge. The observation was captured by `maybePrefetch` on
   * the loop's thread — see there for why this holds no sidecar call.
   *
   * Resolves, never rejects, so `rtcDrain` can await it at a dry queue and
   * `maybePrefetch` can leave it unhandled without risking an unhandled
   * rejection. Nothing in here fails a run: a prefetch is speculative, so a
   * failure just leaves `pending` null and drops the boundary back onto the
   * serial refill with its existing retry counting.
   *
   * Deliberately does NOT touch `predictFailures`. That counter gates
   * "vla-server is unreachable, stop the run", and it is counted against the
   * predicts that actually block the robot. If the server really is down the
   * following serial refill hits the same failure and counts it there; making
   * a boundary burn two slots would bail the run after three failures that
   * were really one and a half boundaries' worth.
   */
  private async runPrefetch(
    rtc: RtcState,
    ctx: RolloutContext,
    opts: SkillExecutorOptions,
    baseUrl: string,
    ctrl: AbortController,
    gen: number,
    obs: { images: Record<string, string>; state: number[] },
    roundTripStartedAt: number,
  ): Promise<void> {
    try {
      const result = await this.predict(baseUrl, obs.images, obs.state, opts.taskPrompt, ctrl.signal);
      // Superseded, cancelled, or the run ended while this was in the air.
      if (rtc.gen !== gen || ctrl.signal.aborted) return;
      if (!result.ok || result.actions.length === 0) {
        ctx.rtcMetrics.prefetchFailed += 1;
        console.warn(
          `[SkillExecutor] RTC prefetch failed, falling back to serial refill: ${
            result.ok ? 'empty action chunk' : result.error
          }`,
        );
        return;
      }
      this.noteLatency(rtc, Date.now() - roundTripStartedAt);
      rtc.pending = result.actions;
    } catch (err) {
      // predict() swallows its own errors; this is belt and braces, because an
      // unexpected throw here would reach the loop through `rtcDrain`'s await.
      if (rtc.gen !== gen) return;
      ctx.rtcMetrics.prefetchFailed += 1;
      console.warn(
        `[SkillExecutor] RTC prefetch failed, falling back to serial refill: ${this.errMsg(err)}`,
      );
    } finally {
      // Only if we are still the current prefetch: a cancel bumps the
      // generation and may have started a replacement already, and clearing
      // its slots from here would let a third one fire alongside it.
      if (rtc.gen === gen) {
        rtc.inflight = null;
        rtc.cancel = null;
      }
    }
  }

  /**
   * Abandon the in-flight prefetch and any chunk it already delivered.
   *
   * Aborts the HTTP request so a dead run isn't still holding a socket, and
   * bumps the generation so the promise — which may already be past its abort
   * check — writes nothing when it lands.
   *
   * Clears `attempted` too: the boundary still has a chunk executing and still
   * wants prefetching, it just cannot be prefetched from an observation the
   * human is in the middle of invalidating. The teleop gate in `maybePrefetch`
   * holds it off until they let go; leaving it marked attempted would keep it
   * off for the rest of the chunk, silently.
   */
  private cancelPrefetch(rtc: RtcState): void {
    rtc.cancel?.abort();
    rtc.cancel = null;
    rtc.inflight = null;
    rtc.pending = null;
    rtc.blendedAhead = 0;
    rtc.attempted = false;
    rtc.gen += 1;
  }

  // ── Helpers ────────────────────────────────────────────────────

  private async fetchVlaConfig(baseUrl: string): Promise<VlaConfig> {
    const resp = await this.fetchImpl(`${baseUrl}/config`, { method: 'GET' });
    if (!resp.ok) {
      throw new Error(`/config returned HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as {
      cameras?: string[];
      state_dim?: number;
      chunk_size?: number;
    };
    return {
      cameras: data.cameras ?? ['front'],
      stateDim: data.state_dim ?? 6,
      chunkSize: data.chunk_size ?? 50,
    };
  }

  /**
   * One observation for `/predict`, from wherever this run's frames and joint
   * state come from. The serial refill and the RTC prefetch share it so there
   * is exactly one description of what an observation is — including the
   * highlight ring push, which with RTC on is where nearly every buffered
   * frame comes from (TASK-183); a prefetch that skipped it would quietly
   * empty the ring on the strategy that exists to fill it.
   *
   * Throws on a hardware capture failure. Both callers catch, and they do
   * different things with it: the serial refill ends the run, the prefetch
   * shrugs and lets the serial refill have the boundary.
   */
  private async captureObservation(
    ctx: RolloutContext,
    mode: SkillExecutionMode,
    vlaConfig: VlaConfig,
  ): Promise<{ images: Record<string, string>; state: number[] }> {
    if (mode !== 'hardware') {
      return {
        images: this.buildSyntheticFrames(vlaConfig.cameras),
        state: this.buildSimState(vlaConfig.stateDim),
      };
    }
    const [images, state] = await this.captureHardware(vlaConfig);
    // highlight: buffer the first camera's frame (one camera only, to bound
    // memory). Frames arrive at capture rate; the ring caps at
    // HIGHLIGHT_MAX_FRAMES regardless.
    if (ctx.strategy === 'highlight') {
      const cam = vlaConfig.cameras[0];
      const jpeg = cam ? images[cam] : undefined;
      if (cam && jpeg) {
        ctx.highlight.push({ t: Date.now(), camera: cam, jpegB64: jpeg });
      }
    }
    return { images, state };
  }

  /**
   * Hardware capture: fetch joint state + one snapshot per expected camera,
   * map the sidecar's physical cameras onto the names vla-server expects.
   *
   * vla-server's /config returns the camera names the model was trained
   * on (e.g. ['up', 'side'] for SmolVLA). The sidecar exposes physical
   * cameras by their local names (e.g. ['wrist', 'top']). We map by
   * position: the k-th vla-server camera gets filled with the k-th
   * sidecar camera's snapshot. Matches the sim path's behavior.
   */
  private async captureHardware(
    vlaConfig: VlaConfig,
  ): Promise<[Record<string, string>, number[]]> {
    const sidecarCameras = await hardwareClient.getCameras();
    const physicalCount = sidecarCameras.length;

    // Parallel fetch all snapshots + joint state.
    const needed = vlaConfig.cameras.length;
    const physicalToUse = sidecarCameras.slice(0, Math.max(needed, 1));

    const [snapshots, state] = await Promise.all([
      Promise.all(
        physicalToUse.map((name) =>
          hardwareClient.snapshot(name).then((b64) => ({ name, b64 })),
        ),
      ),
      hardwareClient.getStateNow(),
    ]);

    // Map snapshots onto the vla-server camera names by position. If there
    // are more expected cameras than physical cameras, reuse the last
    // physical frame so the model still gets a valid JPEG for every name.
    const images: Record<string, string> = {};
    for (let i = 0; i < vlaConfig.cameras.length; i++) {
      const vlaName = vlaConfig.cameras[i];
      const snap = snapshots[Math.min(i, snapshots.length - 1)];
      images[vlaName] = snap ? snap.b64 : SYNTHETIC_GRAY_JPEG_B64;
    }

    // Pad/truncate state to vla-server's expected dim.
    const padded = state.slice(0, vlaConfig.stateDim);
    while (padded.length < vlaConfig.stateDim) padded.push(0);

    void physicalCount;
    return [images, padded];
  }

  private buildSyntheticFrames(cameras: string[]): Record<string, string> {
    const images: Record<string, string> = {};
    for (const cam of cameras) {
      images[cam] = SYNTHETIC_GRAY_JPEG_B64;
    }
    return images;
  }

  private buildSimState(stateDim: number): number[] {
    const telemetry = this.robotStateManager.getTelemetry();
    const joints = (telemetry.jointStates ?? []).map((j) => j.position);
    while (joints.length < stateDim) joints.push(0);
    return joints.slice(0, stateDim);
  }

  /**
   * `external` (TASK-183) lets an RTC prefetch cancel its own request when the
   * run ends or a human pre-empts it. Omitted everywhere else, and when it is
   * omitted this behaves exactly as it did before.
   */
  private async predict(
    baseUrl: string,
    images: Record<string, string>,
    state: number[],
    task: string,
    external?: AbortSignal,
  ): Promise<
    | { ok: true; actions: number[][] }
    | { ok: false; error: string; retryable: boolean }
  > {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PREDICT_TIMEOUT_MS);
    const onExternalAbort = () => ctrl.abort();
    if (external) {
      if (external.aborted) ctrl.abort();
      else external.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      const resp = await this.fetchImpl(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, state, task }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`;
        try {
          const body = (await resp.json()) as { detail?: string };
          if (body.detail) detail = body.detail;
        } catch {
          /* ignore */
        }
        // 4xx are client-side / deterministic — don't retry.
        // 5xx / other are likely transient — allow retry.
        const retryable = resp.status >= 500;
        return { ok: false, error: `vla-server /predict rejected: ${detail}`, retryable };
      }
      const body = (await resp.json()) as { actions?: number[][] };
      return { ok: true, actions: body.actions ?? [] };
    } catch (err) {
      // Network errors and AbortController timeouts are transient.
      return {
        ok: false,
        error: `vla-server /predict failed: ${this.errMsg(err)}`,
        retryable: true,
      };
    } finally {
      clearTimeout(t);
      external?.removeEventListener('abort', onExternalAbort);
    }
  }

  /**
   * Delta-clip an action so no joint moves more than MAX_DELTA_DEGREES
   * from its last applied value. Prevents servo stalls from bad VLA
   * predictions.
   */
  private clipAction(action: number[], last: number[]): number[] {
    const clipped = new Array(action.length);
    for (let i = 0; i < action.length; i++) {
      const lastVal = last[i] ?? 0;
      const delta = action[i] - lastVal;
      const limited = Math.max(-MAX_DELTA_DEGREES, Math.min(MAX_DELTA_DEGREES, delta));
      clipped[i] = lastVal + limited;
    }
    return clipped;
  }

  private abortedResult(
    mode: SkillExecutionMode,
    step: number,
    startedAt: number,
    lastAction?: number[],
  ): SkillExecutionResult {
    return {
      status: 'aborted',
      mode,
      steps: step,
      durationMs: Date.now() - startedAt,
      lastAction,
      message: 'Aborted by user',
    };
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Registry ────────────────────────────────────────────────────

/**
 * Tracks active executors so the abort route can find them by skillId.
 * One executor per (robotId, skillId) — there's only one robot per agent
 * process, so skillId alone is sufficient.
 */
class SkillExecutorRegistry {
  private active = new Map<string, SkillExecutor>();

  register(skillId: string, exec: SkillExecutor): void {
    this.active.set(skillId, exec);
  }

  get(skillId: string): SkillExecutor | undefined {
    return this.active.get(skillId);
  }

  unregister(skillId: string): void {
    this.active.delete(skillId);
  }

  abort(skillId: string): boolean {
    const exec = this.active.get(skillId);
    if (!exec) return false;
    exec.abort();
    return true;
  }

  /**
   * Abort every active executor. Called by the safety loop on a protective stop
   * so a detected fall actually halts the VLA command path. Returns the count.
   */
  abortAll(): number {
    let n = 0;
    for (const exec of this.active.values()) {
      exec.abort();
      n += 1;
    }
    return n;
  }
}

export const skillExecutorRegistry = new SkillExecutorRegistry();
