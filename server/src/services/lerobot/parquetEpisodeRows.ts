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

  /** `length` bytes at `offset`; on a miss, fetches at least `prefetch` bytes from there. */
  async slice(offset: number, length: number, prefetch = WINDOW_BYTES): Promise<Buffer> {
    const want = Math.min(length, this.end - offset);
    if (offset < this.bufStart || offset + want > this.bufStart + this.buf.length) {
      const len = Math.min(Math.max(want, prefetch), this.end - offset);
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

/** Thrift PageType values. */
const DATA_PAGE = 0;
const DATA_PAGE_V2 = 3;

/** After a skip, the next decoded page did not start where the row count said it would. */
class MisalignedSkip extends Error {}

/** Levels (values, nulls and empty lists) in a data page, from its header; undefined for any other page. */
function pageLevels(header: NewPageHeader): number | undefined {
  const type = Number(header.type);
  if (type === DATA_PAGE) return toNumber(header.data_page_header?.num_values);
  if (type === DATA_PAGE_V2) return toNumber(header.data_page_header_v2?.num_values);
  return undefined;
}

/**
 * Feed `visit` every level of one column chunk, page by page. `row` is the
 * row index within the row group; `value` is undefined for a null / empty
 * list. Stops once `visit` returns 'stop' or the chunk is exhausted.
 *
 * Pages that lie wholly before row `skip.before` are stepped over on their
 * header — neither decompressed nor decoded. A flat column has one level
 * per row; a list column is skipped only when `skip.width` says every row
 * holds that many values, so row r starts at level r × width. Pages may end
 * mid-row (pyarrow's do), which is why the count is kept in levels. A late
 * episode of a large file otherwise costs decoding the whole column.
 * Returns whether any page was skipped.
 */
async function streamColumn(
  reader: ParquetReader,
  source: ByteSource,
  column: ColumnMeta,
  visit: (row: number, value: unknown, present: boolean, rowStart: boolean) => void | 'stop',
  skip: { before: number; width?: number } = { before: 0 },
): Promise<boolean> {
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

  const width = field.rLevelMax === 0 ? 1 : skip.width;
  let pos = start;
  let row = -1;
  let seen = 0;
  let skipped = false;
  let realign = false;
  while (pos < end && seen < totalValues) {
    const header = new NewPageHeader();
    // A header read that misses the window fetches only the header's bytes,
    // so the bodies of skipped pages are never downloaded.
    const headerSize = decodeThrift(header, await window.slice(pos, MAX_HEADER_BYTES, MAX_HEADER_BYTES));
    const pageSize = headerSize + Number(header.compressed_page_size);
    const levels = pageLevels(header);
    if (width && levels !== undefined && seen + levels <= skip.before * width) {
      seen += levels;
      pos += pageSize;
      skipped = realign = true;
      continue;
    }
    const page = (await reader.decodePages(
      await window.slice(pos, pageSize),
      opts as unknown as Parameters<ParquetReader['decodePages']>[1],
    )) as unknown as DecodedPages;
    pos += pageSize;
    if (realign && width) {
      // Rows 0..ceil(seen/width)-1 have started; the next starts here.
      const nextStart = (width - (seen % width)) % width;
      const firstStart = page.rlevels.indexOf(0);
      if (firstStart !== nextStart && !(firstStart === -1 && nextStart >= page.rlevels.length)) {
        throw new MisalignedSkip();
      }
      row = Math.ceil(seen / width) - 1;
      realign = false;
    }
    let valueIndex = 0;
    for (let i = 0; i < page.rlevels.length; i++) {
      const rowStart = page.rlevels[i] === 0;
      if (rowStart) row++;
      const present = page.dlevels[i] === field.dLevelMax;
      const value = present ? page.values[valueIndex++] : undefined;
      if (visit(row, value, present, rowStart) === 'stop') return skipped;
    }
    seen += page.rlevels.length;
  }
  return skipped;
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
      const groupStart = rows.length;
      const slots = new Int32Array(last - first + 1).fill(-1);
      for (let r = first; r <= last; r++) {
        if (mask && !mask[r - first]) continue;
        slots[r - first] = rows.length;
        rows.push({});
      }

      const groupRows = rows.slice(groupStart);
      for (const name of columns) {
        const column = columnOf(rowGroup, name);
        if (!column) continue;
        const repeated = (reader.schema.findField(column.path_in_schema) as unknown as FieldMeta).rLevelMax > 0;
        // A list column is skipped through only on the premise that every row
        // holds the same number of values (true of LeRobot's fixed-shape
        // features): the chunk's level count must divide evenly by its rows,
        // and every row read is checked against it below.
        const levels = Number(column.num_values);
        const width = repeated && levels % numRows === 0 ? levels / numRows : undefined;
        const visit = (row: number, value: unknown, present: boolean, rowStart: boolean): void | 'stop' => {
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
        };
        // Verify the premise on what was read: a skip that landed off a row
        // boundary, or a kept row of another width, means the rows were
        // miscounted — read the column again from its first page.
        let consistent: boolean;
        try {
          const skipped = await streamColumn(reader, source, column, visit, { before: first, width });
          consistent =
            !skipped ||
            !repeated ||
            groupRows.every((r) => Array.isArray(r[name]) && (r[name] as unknown[]).length === width);
        } catch (error) {
          if (!(error instanceof MisalignedSkip)) throw error;
          consistent = false;
        }
        if (!consistent) {
          for (const r of groupRows) delete r[name];
          await streamColumn(reader, source, column, visit);
        }
      }
    }
  } finally {
    await reader.close();
  }
  return { rows, rowGroupsRead, rowGroupsSkipped };
}
