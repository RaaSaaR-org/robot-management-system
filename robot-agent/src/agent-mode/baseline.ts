/**
 * @file baseline.ts
 * @description What "normal" looks like on a patrol route (TASK-212): per route ×
 *              time window, the control photo + checklist answers of every
 *              checkpoint, the entity label set of every leg, the occupancy-map
 *              snapshot at the end of the baseline run, and the operator's
 *              "this is normal" amendments. Lives under
 *              `workspace-<robotId>/patrol/<routeId>/baseline/<window>/`, written
 *              with the workspace's atomic writes, erased with the workspace.
 * @feature agentmode
 * @status live-conditional
 */

import fs from 'node:fs';
import path from 'node:path';
import type { OccupancyMapSnapshot } from './occupancy-map.js';
import type { ChecklistAnswers } from './inspector.js';
import type { PatrolFinding } from './types.js';
import type { Workspace } from './workspace.js';

/** Window id used when the route has no time windows. */
export const DEFAULT_WINDOW = 'default';

/** Only ids that are safe as path segments reach the disk. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function safeSegment(id: string): string | null {
  return SAFE_SEGMENT.test(id) ? id : null;
}

/** One checkpoint's recorded normal. */
export interface BaselineCheckpoint {
  checkpointId: string;
  /** Run that recorded (or was promoted into) this baseline. */
  runId: string;
  recordedAt: string;
  /** Storage key `<runId>/<checkpointId>.jpg` when a photo was kept, else null. */
  photoKey: string | null;
  answers: ChecklistAnswers | null;
  model: string | null;
  /**
   * Answers an operator accepted as normal after the fact, per checklist item
   * ("this is normal" on a finding): `{ objectOnFloor: ['box'], lightsOn: ['yes'] }`.
   */
  acceptedAnswers: Record<string, string[]>;
}

/** The whole baseline of one route × window, as read from disk. */
export interface BaselineData {
  routeId: string;
  window: string;
  /** Run the bulk of this baseline came from (last recorded/promoted). */
  runId: string | null;
  updatedAt: string | null;
  checkpoints: Record<string, BaselineCheckpoint>;
  /** Entity labels seen per leg index (`"0"`, `"1"`, …), the union over the leg's looks. */
  legs: Record<string, string[]>;
  map: OccupancyMapSnapshot | null;
  /** Blobs an operator accepted as normal — the map diff ignores these. */
  acceptedBlobs: Array<{ x: number; y: number; radiusM: number; place: string | null; at: string }>;
}

export interface BaselineStoreDeps {
  workspace: Workspace;
  now?: () => Date;
}

/**
 * Per route × window baseline files. Every method is synchronous — the callers
 * are block handlers and REST routes, and an unawaited promise there is a
 * baseline that never lands.
 */
export class BaselineStore {
  private readonly ws: Workspace;
  private readonly now: () => Date;

  constructor(deps: BaselineStoreDeps) {
    this.ws = deps.workspace;
    this.now = deps.now ?? (() => new Date());
  }

  // ── paths ─────────────────────────────────────────────────────────────────

  routeDir(routeId: string): string {
    const r = safeSegment(routeId);
    if (!r) throw new Error(`patrol: route id ${JSON.stringify(routeId)} is not usable as a path segment`);
    return path.join(this.ws.patrolDir, r);
  }

  dir(routeId: string, window: string | null): string {
    const w = safeSegment(window ?? DEFAULT_WINDOW);
    if (!w) throw new Error(`patrol: window ${JSON.stringify(window)} is not usable as a path segment`);
    return path.join(this.routeDir(routeId), 'baseline', w);
  }

  private file(routeId: string, window: string | null, name: string): string {
    return path.join(this.dir(routeId, window), name);
  }

  photoFile(routeId: string, window: string | null, checkpointId: string): string | null {
    const c = safeSegment(checkpointId);
    if (!c) return null;
    return this.file(routeId, window, `${c}.jpg`);
  }

  // ── read ──────────────────────────────────────────────────────────────────

  private readJson<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    } catch {
      return fallback;
    }
  }

  /** True when this route × window has any baseline at all. */
  exists(routeId: string, window: string | null): boolean {
    return fs.existsSync(this.file(routeId, window, 'checkpoints.json'));
  }

  load(routeId: string, window: string | null): BaselineData {
    const meta = this.readJson<{ runId?: string | null; updatedAt?: string | null }>(
      this.file(routeId, window, 'baseline.json'),
      {},
    );
    return {
      routeId,
      window: window ?? DEFAULT_WINDOW,
      runId: meta.runId ?? null,
      updatedAt: meta.updatedAt ?? null,
      checkpoints: this.readJson<Record<string, BaselineCheckpoint>>(this.file(routeId, window, 'checkpoints.json'), {}),
      legs: this.readJson<Record<string, string[]>>(this.file(routeId, window, 'legs.json'), {}),
      map: this.readJson<OccupancyMapSnapshot | null>(this.file(routeId, window, 'map.json'), null),
      acceptedBlobs: this.readJson<BaselineData['acceptedBlobs']>(this.file(routeId, window, 'accepted-blobs.json'), []),
    };
  }

  checkpoint(routeId: string, window: string | null, checkpointId: string): BaselineCheckpoint | null {
    return this.load(routeId, window).checkpoints[checkpointId] ?? null;
  }

  /** The baseline photo bytes, or null when none was kept. */
  readPhoto(routeId: string, window: string | null, checkpointId: string): Buffer | null {
    const file = this.photoFile(routeId, window, checkpointId);
    if (!file) return null;
    try {
      return fs.readFileSync(file);
    } catch {
      return null;
    }
  }

  legLabels(routeId: string, window: string | null, legIndex: number): string[] {
    return this.load(routeId, window).legs[String(legIndex)] ?? [];
  }

  // ── write ─────────────────────────────────────────────────────────────────

  private writeJson(file: string, value: unknown): void {
    this.ws.atomicWrite(file, JSON.stringify(value, null, 2));
  }

  private touch(routeId: string, window: string | null, runId: string | null): void {
    const prev = this.readJson<{ runId?: string | null }>(this.file(routeId, window, 'baseline.json'), {});
    this.writeJson(this.file(routeId, window, 'baseline.json'), {
      routeId,
      window: window ?? DEFAULT_WINDOW,
      runId: runId ?? prev.runId ?? null,
      updatedAt: this.now().toISOString(),
    });
  }

  /**
   * Record one checkpoint's normal (baseline run, or a promotion). A photo is
   * only written when one is passed; when none is, the stored one is KEPT by
   * default (see `keepPhoto`) and its key carried forward.
   */
  recordCheckpoint(
    routeId: string,
    window: string | null,
    input: {
      checkpointId: string;
      runId: string;
      photo: Buffer | null;
      answers: ChecklistAnswers | null;
      model: string | null;
      /**
       * What happens to the stored JPEG when `photo` is null. Defaults to
       * keeping it: a caller that only refreshes the checklist answers — or
       * whose capture simply failed — must not destroy a good picture. That is
       * exactly how one flaky frame used to wipe a checkpoint's baseline photo
       * (promoteRun read no photo, fell back to the previous answers, and the
       * write deleted the JPEG the baseline still needed). Pass `false` for an
       * explicit removal: the stored photo is no longer normal.
       */
      keepPhoto?: boolean;
    },
  ): BaselineCheckpoint {
    const all = this.readJson<Record<string, BaselineCheckpoint>>(this.file(routeId, window, 'checkpoints.json'), {});
    const prev = all[input.checkpointId];
    const photoFile = this.photoFile(routeId, window, input.checkpointId);
    let photoKey: string | null = null;
    if (photoFile) {
      if (input.photo) {
        this.ws.atomicWrite(photoFile, input.photo);
        photoKey = `${input.runId}/${input.checkpointId}.jpg`;
      } else if (input.keepPhoto === false) {
        if (fs.existsSync(photoFile)) fs.rmSync(photoFile, { force: true });
      } else if (fs.existsSync(photoFile)) {
        // Kept: the bytes still belong to the run that took them, so the key
        // must stay that run's — not this call's, which brought no photo.
        photoKey = prev?.photoKey ?? null;
      }
    }
    const rec: BaselineCheckpoint = {
      checkpointId: input.checkpointId,
      runId: input.runId,
      recordedAt: this.now().toISOString(),
      photoKey,
      answers: input.answers,
      model: input.model,
      acceptedAnswers: prev?.acceptedAnswers ?? {},
    };
    all[input.checkpointId] = rec;
    this.writeJson(this.file(routeId, window, 'checkpoints.json'), all);
    this.touch(routeId, window, input.runId);
    return rec;
  }

  /** Replace one leg's label set (union over the leg's looks). */
  recordLegLabels(routeId: string, window: string | null, legIndex: number, labels: readonly string[]): void {
    const legs = this.readJson<Record<string, string[]>>(this.file(routeId, window, 'legs.json'), {});
    legs[String(legIndex)] = [...new Set(labels.map((l) => l.trim().toLowerCase()).filter(Boolean))].sort();
    this.writeJson(this.file(routeId, window, 'legs.json'), legs);
    this.touch(routeId, window, null);
  }

  /** The map at the end of the baseline run. `null` clears it. */
  recordMap(routeId: string, window: string | null, snapshot: OccupancyMapSnapshot | null): void {
    this.writeJson(this.file(routeId, window, 'map.json'), snapshot);
    this.touch(routeId, window, null);
  }

  /**
   * "This is normal" (operator): fold the finding's observation into the
   * baseline so the same scene raises nothing next time.
   *  - checklist diff → the current answers become accepted answers per item;
   *  - label diff → the added labels join the leg's baseline label set;
   *  - map blob → an accepted blob the map diff ignores (radius from its area).
   * Returns what changed, for the route's reply and the log.
   */
  markNormal(
    finding: Pick<PatrolFinding, 'routeId' | 'checkpointId' | 'legIndex' | 'evidence' | 'place' | 'type'>,
    window: string | null,
  ): { ok: boolean; applied: string[]; message: string } {
    const applied: string[] = [];
    const routeId = finding.routeId;
    const diff = finding.evidence.checklistDiff ?? [];
    if (finding.checkpointId && diff.length > 0) {
      const all = this.readJson<Record<string, BaselineCheckpoint>>(this.file(routeId, window, 'checkpoints.json'), {});
      const rec = all[finding.checkpointId];
      if (rec) {
        for (const d of diff) {
          const values = new Set(rec.acceptedAnswers[d.item] ?? []);
          // "yes: box" accepts both the object and the bare yes.
          for (const v of d.current.split(':').map((s) => s.trim())) if (v) values.add(v);
          for (const v of d.current.split(',').map((s) => s.trim())) if (v) values.add(v);
          rec.acceptedAnswers[d.item] = [...values];
          applied.push(`checklist ${d.item} = ${d.current}`);
        }
        all[finding.checkpointId] = rec;
        this.writeJson(this.file(routeId, window, 'checkpoints.json'), all);
      }
    }
    const added = finding.evidence.labels?.added ?? [];
    if (added.length > 0) {
      const legs = this.readJson<Record<string, string[]>>(this.file(routeId, window, 'legs.json'), {});
      const key = String(finding.legIndex);
      legs[key] = [...new Set([...(legs[key] ?? []), ...added.map((l) => l.trim().toLowerCase())])].sort();
      this.writeJson(this.file(routeId, window, 'legs.json'), legs);
      applied.push(`labels ${added.join(', ')} → leg ${finding.legIndex}`);
    }
    const missing = finding.evidence.labels?.missing ?? [];
    if (finding.type === 'missing_object' && missing.length > 0) {
      const legs = this.readJson<Record<string, string[]>>(this.file(routeId, window, 'legs.json'), {});
      const key = String(finding.legIndex);
      const gone = new Set(missing.map((l) => l.trim().toLowerCase()));
      legs[key] = (legs[key] ?? []).filter((l) => !gone.has(l));
      this.writeJson(this.file(routeId, window, 'legs.json'), legs);
      applied.push(`labels ${missing.join(', ')} no longer expected on leg ${finding.legIndex}`);
    }
    const blob = finding.evidence.blob;
    if (blob) {
      const blobs = this.readJson<BaselineData['acceptedBlobs']>(this.file(routeId, window, 'accepted-blobs.json'), []);
      blobs.push({
        x: blob.x,
        y: blob.y,
        radiusM: Math.max(0.5, Math.sqrt(blob.areaM2 / Math.PI) + 0.3),
        place: finding.place,
        at: this.now().toISOString(),
      });
      this.writeJson(this.file(routeId, window, 'accepted-blobs.json'), blobs);
      applied.push(`blob at (${blob.x}, ${blob.y}) accepted`);
    }
    if (applied.length === 0) {
      return { ok: false, applied, message: 'nothing in this finding can be folded into the baseline' };
    }
    this.touch(routeId, window, null);
    return { ok: true, applied, message: `baseline updated: ${applied.join('; ')}` };
  }

  /** Windows that have a baseline for this route. */
  windows(routeId: string): string[] {
    const dir = path.join(this.routeDir(routeId), 'baseline');
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }
}
