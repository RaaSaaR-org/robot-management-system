/**
 * @file ModelUploadRepository.ts
 * @description The session row of a direct model checkpoint upload (TASK-498):
 *              what the client declared, where it goes, which state it is in,
 *              and — once it completed — which ModelVersion it became.
 * @feature deployment
 *
 * `ModelUpload` carries a `tenantId` and is tenant-scoped by the Prisma
 * extension, so a lookup from a request only ever finds the caller's own
 * uploads. The interface is what the service depends on, so its tests run
 * against a Map.
 */

import { prisma } from '../database/index.js';
import type { UploadFileEntry } from '../services/datasetUpload/uploadManifest.js';
import type { UploadState } from '../services/datasetUpload/uploadSession.js';

/** What the ModelVersion is registered with when the upload completes. */
export interface ModelUploadMetadata {
  name: string;
  version: string;
  modelType: string;
  baseModel: string | null;
  datasetId: string | null;
  trainingMetrics: Record<string, unknown>;
  validationMetrics: Record<string, unknown>;
  notes: string | null;
}

export interface ModelUploadSession {
  id: string;
  state: UploadState;
  sink: 'local' | 'rustfs';
  storagePath: string;
  chunkSize: number;
  files: UploadFileEntry[];
  totalBytes: number;
  metadata: ModelUploadMetadata;
  error: string | null;
  modelVersionId: string | null;
  filesRemovedAt: Date | null;
  tenantId: string | null;
  lastActivityAt: Date;
  createdAt: Date;
}

export type NewModelUpload = Pick<
  ModelUploadSession,
  'id' | 'state' | 'sink' | 'storagePath' | 'chunkSize' | 'files' | 'totalBytes' | 'metadata'
>;

export interface ModelUploadStore {
  create(session: NewModelUpload): Promise<ModelUploadSession>;
  find(id: string): Promise<ModelUploadSession | null>;
  findByModelVersion(modelVersionId: string): Promise<ModelUploadSession | null>;
  /** Move `from` → `to` atomically; false when the row was not in one of `from`. */
  transition(
    id: string, from: UploadState[], to: UploadState,
    patch?: { error?: string | null; modelVersionId?: string },
  ): Promise<boolean>;
  touch(id: string, at: Date): Promise<void>;
  markFilesRemoved(id: string, at: Date): Promise<void>;
  delete(id: string): Promise<void>;
  /** Sessions in `states` whose last activity is before `before` (all of them when omitted), oldest first. */
  list(states: UploadState[], before?: Date): Promise<ModelUploadSession[]>;
}

interface Row {
  id: string;
  state: string;
  sink: string;
  storagePath: string;
  chunkSize: number;
  filesJson: string;
  totalBytes: bigint;
  metadataJson: string;
  error: string | null;
  modelVersionId: string | null;
  filesRemovedAt: Date | null;
  tenantId: string | null;
  lastActivityAt: Date;
  createdAt: Date;
}

function toDomain(row: Row): ModelUploadSession {
  return {
    id: row.id,
    state: row.state as UploadState,
    sink: row.sink === 'rustfs' ? 'rustfs' : 'local',
    storagePath: row.storagePath,
    chunkSize: row.chunkSize,
    files: JSON.parse(row.filesJson) as UploadFileEntry[],
    totalBytes: Number(row.totalBytes),
    metadata: JSON.parse(row.metadataJson) as ModelUploadMetadata,
    error: row.error,
    modelVersionId: row.modelVersionId,
    filesRemovedAt: row.filesRemovedAt,
    tenantId: row.tenantId,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
  };
}

export class ModelUploadRepository implements ModelUploadStore {
  async create(session: NewModelUpload): Promise<ModelUploadSession> {
    const row = await prisma.modelUpload.create({
      data: {
        id: session.id,
        state: session.state,
        sink: session.sink,
        storagePath: session.storagePath,
        chunkSize: session.chunkSize,
        filesJson: JSON.stringify(session.files),
        totalBytes: BigInt(session.totalBytes),
        metadataJson: JSON.stringify(session.metadata),
      },
    });
    return toDomain(row);
  }

  async find(id: string): Promise<ModelUploadSession | null> {
    const row = await prisma.modelUpload.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByModelVersion(modelVersionId: string): Promise<ModelUploadSession | null> {
    const row = await prisma.modelUpload.findUnique({ where: { modelVersionId } });
    return row ? toDomain(row) : null;
  }

  async transition(
    id: string, from: UploadState[], to: UploadState,
    patch: { error?: string | null; modelVersionId?: string } = {},
  ): Promise<boolean> {
    const { count } = await prisma.modelUpload.updateMany({
      where: { id, state: { in: from } },
      data: { state: to, lastActivityAt: new Date(), ...patch },
    });
    return count > 0;
  }

  async touch(id: string, at: Date): Promise<void> {
    await prisma.modelUpload.updateMany({ where: { id }, data: { lastActivityAt: at } });
  }

  async markFilesRemoved(id: string, at: Date): Promise<void> {
    await prisma.modelUpload.updateMany({ where: { id }, data: { filesRemovedAt: at } });
  }

  async delete(id: string): Promise<void> {
    await prisma.modelUpload.deleteMany({ where: { id } });
  }

  async list(states: UploadState[], before?: Date): Promise<ModelUploadSession[]> {
    const rows = await prisma.modelUpload.findMany({
      where: { state: { in: states }, ...(before ? { lastActivityAt: { lt: before } } : {}) },
      orderBy: { lastActivityAt: 'asc' },
    });
    return rows.map(toDomain);
  }
}

export const modelUploadRepository = new ModelUploadRepository();
