/**
 * @file parquetFixtures.ts
 * @description Tiny LeRobot parquet files and an in-memory object store for reader tests
 * @feature datasets
 */

import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DatasetObjectStore } from '../RemoteDatasetReader.js';

type Field = { type: 'INT64' | 'DOUBLE'; repeated?: boolean; optional?: boolean };

/** Write `rows` with `fields` to a parquet buffer. */
export async function parquetBuffer(
  fields: Record<string, Field>,
  rows: Array<Record<string, unknown>>,
  layout: { rowGroupSize?: number; pageSize?: number; dataPageV1?: boolean } = {},
): Promise<Buffer> {
  const { ParquetSchema, ParquetWriter } = await import('@dsnp/parquetjs');
  const dir = await mkdtemp(join(tmpdir(), 'lerobot-fixture-'));
  const file = join(dir, 'f.parquet');
  try {
    const writer = await ParquetWriter.openFile(new ParquetSchema(fields), file, {
      ...(layout.pageSize ? { pageSize: layout.pageSize } : {}),
      // pyarrow writes v1 data pages; parquetjs defaults to v2.
      ...(layout.dataPageV1 ? { useDataPageV2: false } : {}),
    });
    if (layout.rowGroupSize) writer.setRowGroupSize(layout.rowGroupSize);
    for (const row of rows) await writer.appendRow(row);
    await writer.close();
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Frame rows of one episode: state/action `width` wide, values tagged by episode and frame. */
export function frameRows(episodeIndex: number, length: number, width: number): Array<Record<string, unknown>> {
  return Array.from({ length }, (_, f) => ({
    episode_index: episodeIndex,
    frame_index: f,
    timestamp: f / 30,
    'observation.state': Array.from({ length: width }, (_, j) => episodeIndex * 1000 + f + j / 100),
    action: Array.from({ length: width }, (_, j) => -(episodeIndex * 1000 + f + j / 100)),
  }));
}

export const FRAME_FIELDS: Record<string, Field> = {
  episode_index: { type: 'INT64' },
  frame_index: { type: 'INT64' },
  timestamp: { type: 'DOUBLE' },
  'observation.state': { type: 'DOUBLE', repeated: true },
  action: { type: 'DOUBLE', repeated: true },
};

/** An object store over a path → bytes map; `failing` paths throw on read. */
export function memoryStore(files: Record<string, Buffer | string>, failing: string[] = []): DatasetObjectStore {
  return {
    async read(path) {
      if (failing.includes(path)) throw new Error('connection reset');
      const v = files[path];
      if (v === undefined) return null;
      return typeof v === 'string' ? Buffer.from(v) : v;
    },
    async list(prefix) {
      return Object.keys(files).filter((p) => p.startsWith(prefix));
    },
  };
}
