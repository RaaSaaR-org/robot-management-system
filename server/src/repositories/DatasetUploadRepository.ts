/**
 * @file DatasetUploadRepository.ts
 * @description The session row of a direct dataset upload (TASK-480): what the
 *              client declared, where it goes, and which state it is in.
 * @feature datasets
 *
 * Reached only through a Dataset the caller has already looked up — that
 * lookup is tenant-scoped, this table is not. The interface is what the
 * service depends on, so its tests run against a Map.
 */

import { prisma } from '../database/index.js';
import type { UploadFileEntry } from '../services/datasetUpload/uploadManifest.js';
import type { UploadState } from '../services/datasetUpload/uploadSession.js';

/** The states of an upload session — shared with the model upload (TASK-498). */
export type DatasetUploadState = UploadState;

export interface DatasetUploadSession {
  datasetId: string;
  state: DatasetUploadState;
  sink: 'local' | 'rustfs';
  storagePath: string;
  chunkSize: number;
  files: UploadFileEntry[];
  lastActivityAt: Date;
  createdAt: Date;
}

export interface DatasetUploadStore {
  create(session: Omit<DatasetUploadSession, 'lastActivityAt' | 'createdAt'>): Promise<DatasetUploadSession>;
  find(datasetId: string): Promise<DatasetUploadSession | null>;
  /** Move `from` → `to` atomically; false when the row was not in one of `from`. */
  transition(datasetId: string, from: DatasetUploadState[], to: DatasetUploadState): Promise<boolean>;
  touch(datasetId: string, at: Date): Promise<void>;
  delete(datasetId: string): Promise<void>;
  /** Sessions in `states` whose last activity is before `before` (all of them when omitted). */
  list(states: DatasetUploadState[], before?: Date): Promise<DatasetUploadSession[]>;
}

interface Row {
  datasetId: string;
  state: string;
  sink: string;
  storagePath: string;
  chunkSize: number;
  filesJson: string;
  lastActivityAt: Date;
  createdAt: Date;
}

function toDomain(row: Row): DatasetUploadSession {
  return {
    datasetId: row.datasetId,
    state: row.state as DatasetUploadState,
    sink: row.sink === 'rustfs' ? 'rustfs' : 'local',
    storagePath: row.storagePath,
    chunkSize: row.chunkSize,
    files: JSON.parse(row.filesJson) as UploadFileEntry[],
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
  };
}

export class DatasetUploadRepository implements DatasetUploadStore {
  async create(session: Omit<DatasetUploadSession, 'lastActivityAt' | 'createdAt'>): Promise<DatasetUploadSession> {
    const row = await prisma.datasetUpload.create({
      data: {
        datasetId: session.datasetId,
        state: session.state,
        sink: session.sink,
        storagePath: session.storagePath,
        chunkSize: session.chunkSize,
        filesJson: JSON.stringify(session.files),
      },
    });
    return toDomain(row);
  }

  async find(datasetId: string): Promise<DatasetUploadSession | null> {
    const row = await prisma.datasetUpload.findUnique({ where: { datasetId } });
    return row ? toDomain(row) : null;
  }

  async transition(datasetId: string, from: DatasetUploadState[], to: DatasetUploadState): Promise<boolean> {
    const { count } = await prisma.datasetUpload.updateMany({
      where: { datasetId, state: { in: from } },
      data: { state: to, lastActivityAt: new Date() },
    });
    return count > 0;
  }

  async touch(datasetId: string, at: Date): Promise<void> {
    await prisma.datasetUpload.updateMany({ where: { datasetId }, data: { lastActivityAt: at } });
  }

  async delete(datasetId: string): Promise<void> {
    await prisma.datasetUpload.deleteMany({ where: { datasetId } });
  }

  async list(states: DatasetUploadState[], before?: Date): Promise<DatasetUploadSession[]> {
    const rows = await prisma.datasetUpload.findMany({
      where: { state: { in: states }, ...(before ? { lastActivityAt: { lt: before } } : {}) },
      orderBy: { lastActivityAt: 'asc' },
    });
    return rows.map(toDomain);
  }
}

export const datasetUploadRepository = new DatasetUploadRepository();
