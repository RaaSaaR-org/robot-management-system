/**
 * @file scene-memory.ts
 * @description In-memory scene store for Agent Mode. Merges VLM observations by
 *              label and converts the VLM's *relative* (image-centre) bearings
 *              into *world* bearings using the robot's yaw, so a `scan_room`
 *              yields a consistent 360° map. No DB, no image retention.
 * @feature agentmode
 * @status live
 */

import { normalizeDeg, type SceneEntity, type SceneMemory } from './types.js';
import type { VisionObservation } from './vision.js';

/** Entities not re-observed for this long are dropped from the store. */
const STALE_MS = 15 * 60_000;

/** Where the yaw used for the relative→world conversion came from. */
export type YawSource = 'odometry' | 'dead-reckoning';

export class SceneMemoryStore {
  private readonly robotId: string;
  private entities = new Map<string, SceneEntity>();
  private currentView = '';
  private personVisible = false;
  private updatedAt: string | null = null;
  /** Robot yaw in degrees, world frame, CCW positive. */
  private yawDeg = 0;
  private yawSource: YawSource = 'dead-reckoning';

  constructor(robotId: string) {
    this.robotId = robotId;
  }

  /**
   * Set the robot's world yaw. `source` is recorded verbatim so
   * {@link toMarkdown} can state whether bearings rest on real odometry or on
   * integrated turn commands — never presented as measured when they are not.
   */
  setYawDeg(deg: number, source: YawSource): void {
    this.yawDeg = normalizeDeg(deg);
    this.yawSource = source;
  }

  /** Advance the dead-reckoned yaw by a commanded turn (degrees, + = CCW). */
  advanceYawDeg(deltaDeg: number): void {
    this.yawDeg = normalizeDeg(this.yawDeg + deltaDeg);
  }

  getYawDeg(): number {
    return this.yawDeg;
  }

  getYawSource(): YawSource {
    return this.yawSource;
  }

  /**
   * Merge one VLM observation.
   *
   * `observation.entities[].bearingDeg` is RELATIVE to the image centre with
   * "+ = to the robot's left / CCW" (see prompts.ts). The stored bearing is
   * WORLD: `normalizeDeg(yawDeg + relativeBearingDeg)`. Entities are keyed by
   * their lower-cased label, so re-seeing "table" updates the existing row
   * rather than appending a duplicate.
   *
   * @param yawDegOverride Yaw to use for this observation; defaults to the
   *        store's current yaw. Passed explicitly by `scan_room`, which reads a
   *        fresh yaw per step.
   */
  merge(observation: VisionObservation, yawDegOverride?: number): SceneMemory {
    const yaw = yawDegOverride === undefined ? this.yawDeg : normalizeDeg(yawDegOverride);
    const now = new Date().toISOString();

    for (const seen of observation.entities) {
      const label = seen.label.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const previous = this.entities.get(key);
      const entity: SceneEntity = {
        label: previous?.label ?? label,
        bearingDeg: normalizeDeg(yaw + seen.bearingDeg),
        distanceEstM: seen.distanceEstM,
        confidence: seen.confidence,
        lastSeen: now,
        observedSeq: (previous?.observedSeq ?? 0) + 1,
      };
      // Keep the previous note when this observation carries none — a note is
      // extra colour, not something to lose on a terser second look.
      const note = seen.note ?? previous?.note;
      if (note) entity.note = note;
      this.entities.set(key, entity);
    }

    this.currentView = observation.currentView;
    this.personVisible = observation.personVisible;
    this.updatedAt = now;
    this.prune(Date.parse(now));
    // Non-null by construction: `updatedAt` was just set.
    return this.snapshot() as SceneMemory;
  }

  /**
   * Look an entity up by label. Exact (case-insensitive) match first, then a
   * substring match in either direction so "table with the hat" still finds
   * "table". Returns undefined when nothing matches — callers must NOT invent
   * a bearing for an entity that was never seen.
   */
  get(label: string): SceneEntity | undefined {
    const needle = label.trim().toLowerCase();
    if (!needle) return undefined;
    const exact = this.entities.get(needle);
    if (exact) return exact;

    // Most specific match wins, not the first one inserted. Returning whatever
    // the Map happened to yield first made the answer depend on the order the
    // vision model mentioned things: "table with the hat" contains BOTH "table"
    // and "hat", so the robot walked to whichever had been seen first. That is
    // a physical action chosen by iteration order.
    let best: SceneEntity | undefined;
    let bestKeyLength = -1;
    for (const [key, entity] of this.entities) {
      // A key contained in the needle ("tisch" in "tisch mit dem hut") is a
      // real narrowing; longer means more of the request was accounted for.
      if (needle.includes(key) && key.length > bestKeyLength) {
        best = entity;
        bestKeyLength = key.length;
      }
    }
    if (best) return best;

    // Otherwise fall back to keys the needle appears inside ("tisch" finding
    // "tischdecke"), preferring the shortest — the least extra it drags in.
    let widest: SceneEntity | undefined;
    let widestKeyLength = Infinity;
    for (const [key, entity] of this.entities) {
      if (key.includes(needle) && key.length < widestKeyLength) {
        widest = entity;
        widestKeyLength = key.length;
      }
    }
    return widest;
  }

  listEntities(): SceneEntity[] {
    return [...this.entities.values()].sort((a, b) => a.bearingDeg - b.bearingDeg);
  }

  isPersonVisible(): boolean {
    return this.personVisible;
  }

  /** Null until the first observation — "nothing seen yet" is not an empty scene. */
  snapshot(): SceneMemory | null {
    if (this.updatedAt === null) return null;
    return {
      robotId: this.robotId,
      currentView: this.currentView,
      entities: this.listEntities(),
      personVisible: this.personVisible,
      updatedAt: this.updatedAt,
    };
  }

  clear(): void {
    this.entities.clear();
    this.currentView = '';
    this.personVisible = false;
    this.updatedAt = null;
  }

  /**
   * Compact, token-cheap rendering handed to the planner. The planner never
   * sees pixels — only this.
   */
  summary(): string {
    if (this.updatedAt === null) return 'Scene memory is empty — nothing has been looked at yet.';
    const lines = this.listEntities().map((e) => {
      const dist = e.distanceEstM === null ? 'distance unknown' : `~${e.distanceEstM.toFixed(1)} m`;
      return `- ${e.label}: bearing ${Math.round(e.bearingDeg)}°, ${dist}, confidence ${e.confidence.toFixed(2)}`;
    });
    return [
      `Current view: ${this.currentView || '(nothing recorded)'}`,
      `Robot heading: ${Math.round(this.yawDeg)}° (${this.yawSource})`,
      `Person visible: ${this.personVisible ? 'yes' : 'no'}`,
      lines.length > 0 ? 'Known entities:' : 'Known entities: none',
      ...lines,
    ].join('\n');
  }

  /** The `current_view.md` dump served by `GET /agent-mode/scene.md`. */
  toMarkdown(): string {
    const header = [
      '# Current view',
      '',
      `- **Robot**: ${this.robotId}`,
      `- **Heading**: ${Math.round(this.yawDeg)}° (${this.yawSource})`,
      `- **Updated**: ${this.updatedAt ?? 'never'}`,
      `- **Person visible**: ${this.personVisible ? 'yes' : 'no'}`,
      '',
    ];
    if (this.updatedAt === null) {
      return [...header, '_No observation yet — the robot has not looked around._', ''].join('\n');
    }
    const rows = this.listEntities().map((e) => {
      const dist = e.distanceEstM === null ? '–' : `${e.distanceEstM.toFixed(1)} m`;
      return `| ${e.label} | ${Math.round(e.bearingDeg)}° | ${dist} | ${e.confidence.toFixed(2)} | ${e.lastSeen} | ${e.note ?? ''} |`;
    });
    return [
      ...header,
      '## What I see',
      '',
      this.currentView || '_(the vision model returned no description)_',
      '',
      '## Entities',
      '',
      '| Label | World bearing | Distance (est.) | Confidence | Last seen | Note |',
      '| --- | --- | --- | --- | --- | --- |',
      ...(rows.length > 0 ? rows : ['| _none_ | | | | | |']),
      '',
      `_Bearings are world-frame (+x = 0°, CCW positive) derived from the robot's ${this.yawSource} heading._`,
      '',
    ].join('\n');
  }

  private prune(nowMs: number): void {
    for (const [key, entity] of this.entities) {
      const seenMs = Date.parse(entity.lastSeen);
      if (Number.isFinite(seenMs) && nowMs - seenMs > STALE_MS) {
        this.entities.delete(key);
      }
    }
  }
}
