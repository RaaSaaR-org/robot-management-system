/**
 * @file parquetEpisodeRows.ts
 * @description Streams selected columns of selected rows out of a parquet file, a page at a time
 * @feature datasets
 *
 * A LeRobot v3.0 data file holds many episodes — the G1 Dex3 dataset keeps
 * 281,196 rows in one 63 MB row group. `ParquetReader.getCursor()` decodes a
 * whole row group, every column, into row objects before handing out the
 * first row, which needs far more heap than a 512Mi server pod has
 * (TASK-355). This reader instead:
 *
 * - fetches only the footer and the byte ranges of the columns it needs,
 * - skips row groups whose statistics exclude the filter value,
 * - decodes one page at a time and keeps only the matching rows,
 * - stops reading a column once it is past the last matching row.
 *
 * Heap use is bounded by one page plus the rows returned, not by the file.
 */

import { ParquetEnvelopeReader, ParquetReader } from '@dsnp/parquetjs';
import { NewPageHeader } from '@dsnp/parquetjs/dist/lib/declare.js';
import { decodeThrift } from '@dsnp/parquetjs/dist/lib/util.js';

/** Random access to one object's bytes. */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

/** A {@link ByteSource} over bytes already in memory. */
export function bufferSource(buffer: Buffer): ByteSource {
  return {
    size: buffer.length,
    async read(offset, length) {
      return buffer.subarray(offset, offset + length);
    },
  };
}

export type ParquetRow = Record<string, unknown>;

export interface ReadRowsOptions {
  /**
   * Top-level column names to return, or a pick from the file's column names.
   * Columns the file lacks are left out of the rows.
   */
  columns: string[] | ((available: string[]) => string[]);
  /** Keep only rows whose (scalar) `column` equals `equals`. Without it every row is kept. */
  filter?: { column: string; equals: number };
}

export interface ReadRowsResult {
  rows: ParquetRow[];
  /** Row groups whose column data was read / skipped on statistics alone. */
  rowGroupsRead: number;
  rowGroupsSkipped: number;
}

/** Parquet CompressionCodec enum, by thrift value. */
const CODECS = ['UNCOMPRESSED', 'SNAPPY', 'GZIP', 'LZO', 'BROTLI', 'LZ4', 'ZSTD', 'LZ4_RAW'];

/** Bytes fetched per ranged read; pages are ~1 MB, so a window holds a few. */
const WINDOW_BYTES = 4 * 1024 * 1024;
/** Upper bound for a page header (statistics included). */
const MAX_HEADER_BYTES = 64 * 1024;

/** Thrift-decoded pieces of the footer this reader touches. */
interface ColumnMeta {
  path_in_schema: string[];
  codec: number;
  num_values: unknown;
  data_page_offset: unknown;
  dictionary_page_offset?: unknown;
  total_compressed_size: unknown;
  statistics?: { min_value?: unknown; max_value?: unknown; min?: unknown; max?: unknown } | null;
}
interface RowGroupMeta {
  num_rows: unknown;
  columns: Array<{ meta_data: ColumnMeta }>;
}
interface FieldMeta {
  primitiveType?: string;
  rLevelMax: number;
  dLevelMax: number;
}
interface DecodedPages {
  rlevels: number[];
  dlevels: number[];
  values: unknown[];
}

/** Sequential reads within [start, end) of the source, served from one moving window. */
class ByteWindow {
  private buf: Buffer = Buffer.alloc(0);
  private bufStart = 0;

  constructor(
    private readonly source: ByteSource,
    private readonly end: number,
  ) {}

  async slice(offset: number, length: number): Promise<Buffer> {
    const want = Math.min(length, this.end - offset);
    if (offset < this.bufStart || offset + want > this.bufStart + this.buf.length) {
      const len = Math.min(Math.max(want, WINDOW_BYTES), this.end - offset);
      this.buf = await this.source.read(offset, len);
      this.bufStart = offset;
      if (this.buf.length < want) {
        throw new Error(`short read at byte ${offset}: wanted ${want}, got ${this.buf.length}`);
      }
    }
    return this.buf.subarray(offset - this.bufStart, offset - this.bufStart + want);
  }
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function columnOf(rowGroup: RowGroupMeta, name: string): ColumnMeta | undefined {
  return rowGroup.columns.find((c) => c.meta_data.path_in_schema[0] === name)?.meta_data;
}

/** True when the column's statistics prove no row of the group can equal `value`. */
function statsExclude(column: ColumnMeta, value: number): boolean {
  const stats = column.statistics;
  if (!stats) return false;
  const min = toNumber(stats.min_value ?? stats.min);
  const max = toNumber(stats.max_value ?? stats.max);
  return (min !== undefined && value < min) || (max !== undefined && value > max);
}

/**
 * Feed `visit` every level of one column chunk, page by page. `row` is the
 * row index within the row group; `value` is undefined for a null / empty
 * list. Stops once `visit` returns 'stop' or the chunk is exhausted.
 */
async function streamColumn(
  reader: ParquetReader,
  source: ByteSource,
  column: ColumnMeta,
  visit: (row: number, value: unknown, present: boolean, rowStart: boolean) => void | 'stop',
): Promise<void> {
  const field = reader.schema.findField(column.path_in_schema) as unknown as FieldMeta;
  const dataOffset = Number(column.data_page_offset);
  const dictOffset = toNumber(column.dictionary_page_offset);
  const start = dictOffset !== undefined && dictOffset > 0 && dictOffset < dataOffset ? dictOffset : dataOffset;
  const end = Math.min(source.size, start + Number(column.total_compressed_size));
  const totalValues = Number(column.num_values);
  const window = new ByteWindow(source, end);
  // decodePages keeps the dictionary on this object between calls.
  const opts: Record<string, unknown> = {
    type: field.primitiveType,
    rLevelMax: field.rLevelMax,
    dLevelMax: field.dLevelMax,
    compression: CODECS[column.codec] ?? 'UNCOMPRESSED',
    column: field,
  };

  let pos = start;
  let row = -1;
  let seen = 0;
  while (pos < end && seen < totalValues) {
    const header = new NewPageHeader();
    const headerSize = decodeThrift(header, await window.slice(pos, MAX_HEADER_BYTES));
    const pageSize = headerSize + Number(header.compressed_page_size);
    const page = (await reader.decodePages(
      await window.slice(pos, pageSize),
      opts as unknown as Parameters<ParquetReader['decodePages']>[1],
    )) as unknown as DecodedPages;
    pos += pageSize;
    let valueIndex = 0;
    for (let i = 0; i < page.rlevels.length; i++) {
      const rowStart = page.rlevels[i] === 0;
      if (rowStart) row++;
      const present = page.dlevels[i] === field.dLevelMax;
      const value = present ? page.values[valueIndex++] : undefined;
      if (visit(row, value, present, rowStart) === 'stop') return;
    }
    seen += page.rlevels.length;
  }
}

/**
 * Read `columns` of the rows matching `filter` (or of every row) from a
 * parquet file. A repeated column comes back as an array per row, a scalar
 * as its value.
 */
export async function readParquetRows(source: ByteSource, options: ReadRowsOptions): Promise<ReadRowsResult> {
  const envelope = new ParquetEnvelopeReader(
    (offset: number, length: number) => source.read(offset, length),
    () => undefined,
    source.size,
  );
  const reader = await ParquetReader.openEnvelopeReader(envelope);
  const rowGroups = (reader.metadata?.row_groups ?? []) as unknown as RowGroupMeta[];
  const { filter } = options;
  const columns =
    typeof options.columns === 'function' ? options.columns(Object.keys(reader.schema.fields)) : options.columns;
  const rows: ParquetRow[] = [];
  let rowGroupsRead = 0;
  let rowGroupsSkipped = 0;

  try {
    for (const rowGroup of rowGroups) {
      const numRows = Number(rowGroup.num_rows);
      if (numRows === 0) continue;

      // Which rows of this group match, as a mask over [first, last].
      let first = 0;
      let last = numRows - 1;
      let mask: Uint8Array | null = null;
      if (filter) {
        const filterColumn = columnOf(rowGroup, filter.column);
        if (!filterColumn) throw new Error(`column "${filter.column}" is missing`);
        if (statsExclude(filterColumn, filter.equals)) {
          rowGroupsSkipped++;
          continue;
        }
        const hits: number[] = [];
        await streamColumn(reader, source, filterColumn, (row, value) => {
          if (Number(value) === filter.equals) hits.push(row);
        });
        rowGroupsRead++;
        if (hits.length === 0) continue;
        first = hits[0];
        last = hits[hits.length - 1];
        mask = new Uint8Array(last - first + 1);
        for (const hit of hits) mask[hit - first] = 1;
      } else {
        rowGroupsRead++;
      }

      // Slot of each kept row in `rows`, by row offset from `first`.
      const slots = new Int32Array(last - first + 1).fill(-1);
      for (let r = first; r <= last; r++) {
        if (mask && !mask[r - first]) continue;
        slots[r - first] = rows.length;
        rows.push({});
      }

      for (const name of columns) {
        const column = columnOf(rowGroup, name);
        if (!column) continue;
        const repeated = (reader.schema.findField(column.path_in_schema) as unknown as FieldMeta).rLevelMax > 0;
        await streamColumn(reader, source, column, (row, value, present, rowStart) => {
          if (row > last) return 'stop';
          if (row < first) return;
          const slot = slots[row - first];
          if (slot < 0) return;
          const target = rows[slot];
          if (!repeated) {
            target[name] = present ? value : null;
            return;
          }
          if (rowStart) target[name] = [];
          if (present) (target[name] as unknown[]).push(value);
        });
      }
    }
  } finally {
    await reader.close();
  }
  return { rows, rowGroupsRead, rowGroupsSkipped };
}
