/**
 * @file PatrolPhotoStore.ts
 * @description Where patrol photos live on the server (TASK-212). S3 bucket
 *              `patrol-photos` when object storage is configured, otherwise
 *              a local directory (`PATROL_PHOTO_DIR`, default
 *              `./data/patrol-photos`) — RustFS is not on the dev box, so the
 *              disk path is what runs there. Every photo carries a `kind`
 *              (control | baseline | finding) which drives retention: control
 *              photos go after `PATROL_PHOTO_RETENTION_H` (72 h), baseline
 *              and finding photos after `PATROL_PHOTO_RETENTION_DAYS` (30 d,
 *              the platform default).
 * @feature patrol
 */

import { promises as fs } from 'fs';
import path from 'path';
import { BUCKETS } from '../storage/model-storage.js';
import { getRustFSClient, isRustFSInitialized } from '../storage/rustfs-client.js';

// ============================================================================
// TYPES
// ============================================================================

export const PatrolPhotoKinds = ['control', 'baseline', 'finding'] as const;
export type PatrolPhotoKind = (typeof PatrolPhotoKinds)[number];

export interface PatrolPhotoMeta {
  robotId: string;
  runId: string;
  key: string;
  kind: PatrolPhotoKind;
  contentType: string;
  checkpointId?: string | null;
  routeId?: string | null;
  /** When the robot took it, ISO. */
  capturedAt?: string | null;
  /** When the server stored it, ISO. */
  uploadedAt: string;
  size: number;
}

export interface StoredPatrolPhoto {
  data: Buffer;
  meta: PatrolPhotoMeta;
}

export interface PatrolPhotoSweepResult {
  scanned: number;
  deleted: number;
  errors: string[];
}

export interface PatrolPhotoRetention {
  /** Control photos, hours (default 72). */
  controlHours: number;
  /** Baseline + finding photos, days (default 30). */
  keepDays: number;
}

// ============================================================================
// CONFIG
// ============================================================================

const DEFAULT_CONTROL_RETENTION_H = 72;
const DEFAULT_KEEP_DAYS = 30;

/** `key` is a single path segment: `<checkpointId>.jpg` and friends. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafePhotoKey(key: unknown): key is string {
  return typeof key === 'string' && SAFE_SEGMENT.test(key) && !key.includes('..');
}

export function isSafeIdSegment(id: unknown): id is string {
  return typeof id === 'string' && SAFE_SEGMENT.test(id) && !id.includes('..');
}

export function photoRetentionFromEnv(env: NodeJS.ProcessEnv = process.env): PatrolPhotoRetention {
  const h = Number(env.PATROL_PHOTO_RETENTION_H);
  const d = Number(env.PATROL_PHOTO_RETENTION_DAYS);
  return {
    controlHours: Number.isFinite(h) && h > 0 ? h : DEFAULT_CONTROL_RETENTION_H,
    keepDays: Number.isFinite(d) && d > 0 ? d : DEFAULT_KEEP_DAYS,
  };
}

function defaultLocalDir(): string {
  return path.resolve(process.cwd(), process.env.PATROL_PHOTO_DIR ?? path.join('data', 'patrol-photos'));
}

// ============================================================================
// STORE
// ============================================================================

export interface PatrolPhotoStoreOptions {
  /** Local root; default `PATROL_PHOTO_DIR` / `./data/patrol-photos`. */
  localDir?: string;
  /** Force local disk even when RustFS is initialised (tests). */
  forceLocal?: boolean;
  now?: () => number;
}

/**
 * The store. Object keys are `<robotId>/<runId>/<key>`; the sidecar
 * `<key>.json` (local) / object metadata (S3) carries {@link PatrolPhotoMeta}.
 */
export class PatrolPhotoStore {
  private readonly localDir: string | undefined;
  private readonly forceLocal: boolean;
  private readonly now: () => number;

  constructor(opts: PatrolPhotoStoreOptions = {}) {
    this.localDir = opts.localDir;
    this.forceLocal = opts.forceLocal ?? false;
    this.now = opts.now ?? (() => Date.now());
  }

  /** True when photos go to the S3 bucket rather than local disk. */
  usesObjectStorage(): boolean {
    return !this.forceLocal && isRustFSInitialized();
  }

  /** The local root, resolved per call so a test can point `PATROL_PHOTO_DIR` elsewhere. */
  rootDir(): string {
    return this.localDir ?? defaultLocalDir();
  }

  private objectKey(robotId: string, runId: string, key: string): string {
    return `${robotId}/${runId}/${key}`;
  }

  private localPath(robotId: string, runId: string, key: string): string {
    return path.join(this.rootDir(), robotId, runId, key);
  }

  /**
   * Store a photo. Returns the stored meta (its `key` is what the GET route
   * takes). Overwrites silently — the robot's re-push tick may retry.
   */
  async put(
    input: {
      robotId: string;
      runId: string;
      key: string;
      data: Buffer;
      kind: PatrolPhotoKind;
      contentType?: string;
      checkpointId?: string | null;
      routeId?: string | null;
      capturedAt?: string | null;
    },
  ): Promise<PatrolPhotoMeta> {
    if (!isSafeIdSegment(input.robotId) || !isSafeIdSegment(input.runId) || !isSafePhotoKey(input.key)) {
      throw new Error('invalid photo path segment');
    }
    const meta: PatrolPhotoMeta = {
      robotId: input.robotId,
      runId: input.runId,
      key: input.key,
      kind: input.kind,
      contentType: input.contentType ?? 'image/jpeg',
      checkpointId: input.checkpointId ?? null,
      routeId: input.routeId ?? null,
      capturedAt: input.capturedAt ?? null,
      uploadedAt: new Date(this.now()).toISOString(),
      size: input.data.length,
    };

    if (this.usesObjectStorage()) {
      const client = getRustFSClient();
      await client.upload(BUCKETS.PATROL_PHOTOS, this.objectKey(meta.robotId, meta.runId, meta.key), input.data, {
        contentType: meta.contentType,
        metadata: {
          kind: meta.kind,
          robotid: meta.robotId,
          runid: meta.runId,
          checkpointid: meta.checkpointId ?? '',
          routeid: meta.routeId ?? '',
          capturedat: meta.capturedAt ?? '',
          uploadedat: meta.uploadedAt,
        },
      });
      return meta;
    }

    const file = this.localPath(meta.robotId, meta.runId, meta.key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, input.data);
    await fs.writeFile(`${file}.json`, JSON.stringify(meta));
    return meta;
  }

  /** Read a photo, or null when it does not exist. */
  async get(robotId: string, runId: string, key: string): Promise<StoredPatrolPhoto | null> {
    if (!isSafeIdSegment(robotId) || !isSafeIdSegment(runId) || !isSafePhotoKey(key)) return null;

    if (this.usesObjectStorage()) {
      const client = getRustFSClient();
      const objectKey = this.objectKey(robotId, runId, key);
      try {
        const [data, head] = await Promise.all([
          client.download(BUCKETS.PATROL_PHOTOS, objectKey),
          client.getMetadata(BUCKETS.PATROL_PHOTOS, objectKey),
        ]);
        const m = head.metadata ?? {};
        return {
          data,
          meta: {
            robotId,
            runId,
            key,
            kind: (PatrolPhotoKinds as readonly string[]).includes(m.kind ?? '') ? (m.kind as PatrolPhotoKind) : 'control',
            contentType: head.contentType ?? 'image/jpeg',
            checkpointId: m.checkpointid || null,
            routeId: m.routeid || null,
            capturedAt: m.capturedat || null,
            uploadedAt: m.uploadedat || head.lastModified?.toISOString() || new Date(0).toISOString(),
            size: data.length,
          },
        };
      } catch {
        return null;
      }
    }

    const file = this.localPath(robotId, runId, key);
    try {
      const data = await fs.readFile(file);
      let meta: PatrolPhotoMeta | null = null;
      try {
        meta = JSON.parse(await fs.readFile(`${file}.json`, 'utf-8')) as PatrolPhotoMeta;
      } catch {
        meta = null;
      }
      const stat = await fs.stat(file);
      return {
        data,
        meta: meta ?? {
          robotId,
          runId,
          key,
          kind: 'control',
          contentType: 'image/jpeg',
          uploadedAt: stat.mtime.toISOString(),
          size: data.length,
        },
      };
    } catch {
      return null;
    }
  }

  /** Delete one photo (and its sidecar). Missing is not an error. */
  async delete(robotId: string, runId: string, key: string): Promise<void> {
    if (!isSafeIdSegment(robotId) || !isSafeIdSegment(runId) || !isSafePhotoKey(key)) return;
    if (this.usesObjectStorage()) {
      await getRustFSClient().delete(BUCKETS.PATROL_PHOTOS, this.objectKey(robotId, runId, key)).catch(() => {});
      return;
    }
    const file = this.localPath(robotId, runId, key);
    await fs.unlink(file).catch(() => {});
    await fs.unlink(`${file}.json`).catch(() => {});
  }

  /** Every photo of one run (metadata only). */
  async listRun(robotId: string, runId: string): Promise<PatrolPhotoMeta[]> {
    if (!isSafeIdSegment(robotId) || !isSafeIdSegment(runId)) return [];
    const out: PatrolPhotoMeta[] = [];
    if (this.usesObjectStorage()) {
      const client = getRustFSClient();
      for await (const obj of client.listAll(BUCKETS.PATROL_PHOTOS, `${robotId}/${runId}/`)) {
        const key = obj.key.split('/').pop() ?? '';
        const stored = await this.get(robotId, runId, key);
        if (stored) out.push(stored.meta);
      }
      return out;
    }
    const dir = path.join(this.rootDir(), robotId, runId);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    for (const name of names) {
      if (name.endsWith('.json')) continue;
      const stored = await this.get(robotId, runId, name);
      if (stored) out.push(stored.meta);
    }
    return out;
  }

  /**
   * Retention sweep: delete control photos older than `controlHours` and
   * every other kind older than `keepDays`. Age is measured from the upload
   * instant (server clock), so a backlog the robot re-pushed late is not
   * deleted the moment it lands.
   */
  async sweep(retention: PatrolPhotoRetention = photoRetentionFromEnv()): Promise<PatrolPhotoSweepResult> {
    const result: PatrolPhotoSweepResult = { scanned: 0, deleted: 0, errors: [] };
    const now = this.now();
    const controlCutoff = now - retention.controlHours * 3600_000;
    const keepCutoff = now - retention.keepDays * 86400_000;

    const expired = (meta: PatrolPhotoMeta): boolean => {
      const t = Date.parse(meta.uploadedAt);
      if (!Number.isFinite(t)) return false;
      return meta.kind === 'control' ? t < controlCutoff : t < keepCutoff;
    };

    if (this.usesObjectStorage()) {
      const client = getRustFSClient();
      try {
        for await (const obj of client.listAll(BUCKETS.PATROL_PHOTOS)) {
          const [robotId, runId, key] = obj.key.split('/');
          if (!robotId || !runId || !key) continue;
          result.scanned++;
          try {
            const head = await client.getMetadata(BUCKETS.PATROL_PHOTOS, obj.key);
            const m = head.metadata ?? {};
            const meta: PatrolPhotoMeta = {
              robotId,
              runId,
              key,
              kind: (PatrolPhotoKinds as readonly string[]).includes(m.kind ?? '') ? (m.kind as PatrolPhotoKind) : 'control',
              contentType: head.contentType ?? 'image/jpeg',
              uploadedAt: m.uploadedat || obj.lastModified.toISOString(),
              size: obj.size,
            };
            if (expired(meta)) {
              await client.delete(BUCKETS.PATROL_PHOTOS, obj.key);
              result.deleted++;
            }
          } catch (err) {
            result.errors.push(`${obj.key}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : String(err));
      }
      return result;
    }

    const root = this.rootDir();
    let robots: string[] = [];
    try {
      robots = await fs.readdir(root);
    } catch {
      return result; // nothing stored yet
    }
    for (const robotId of robots) {
      let runs: string[] = [];
      try {
        runs = await fs.readdir(path.join(root, robotId));
      } catch {
        continue;
      }
      for (const runId of runs) {
        const dir = path.join(root, robotId, runId);
        let names: string[] = [];
        try {
          names = await fs.readdir(dir);
        } catch {
          continue;
        }
        for (const name of names) {
          if (name.endsWith('.json')) continue;
          result.scanned++;
          try {
            const stored = await this.get(robotId, runId, name);
            if (stored && expired(stored.meta)) {
              await this.delete(robotId, runId, name);
              result.deleted++;
            }
          } catch (err) {
            result.errors.push(`${robotId}/${runId}/${name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // Drop empty run dirs so the tree does not grow forever.
        try {
          const left = await fs.readdir(dir);
          if (left.length === 0) await fs.rmdir(dir);
        } catch {
          /* ignore */
        }
      }
    }
    return result;
  }
}

export const patrolPhotoStore = new PatrolPhotoStore();
