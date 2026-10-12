/**
 * @file parquetEpisodeRows.test.ts
 * @description The streaming parquet reader reads only the columns, row groups and rows it is asked for (TASK-355)
 * @feature datasets
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ParquetReader } from '@dsnp/parquetjs';
import { readParquetRows, type ByteSource } from '../parquetEpisodeRows.js';
import { FRAME_FIELDS, frameRows, parquetBuffer } from './parquetFixtures.js';

const FRAME_COLUMNS = ['episode_index', 'frame_index', 'timestamp', 'observation.state', 'action'];

/** A ByteSource over `buf` that records every range it serves. */
function countingSource(buf: Buffer): ByteSource & { ranges: Array<[number, number]>; bytes: () => number } {
  const ranges: Array<[number, number]> = [];
  return {
    size: buf.length,
    ranges,
    bytes: () => ranges.reduce((n, [, len]) => n + len, 0),
    async read(offset, length) {
      ranges.push([offset, length]);
      return buf.subarray(offset, offset + length);
    },
  };
}

/** Byte range [start, end) of each column chunk, per row group. */
async function chunkRanges(buf: Buffer): Promise<Array<Record<string, [number, number]>>> {
  const reader = await ParquetReader.openBuffer(buf);
  const groups = (reader.metadata?.row_groups ?? []).map((rg) => {
    const out: Record<string, [number, number]> = {};
    for (const c of rg.columns) {
      const md = c.meta_data!;
      const dict = Number(md.dictionary_page_offset ?? 0);
      const start = dict > 0 && dict < Number(md.data_page_offset) ? dict : Number(md.data_page_offset);
      out[md.path_in_schema[0]] = [start, start + Number(md.total_compressed_size)];
    }
    return out;
  });
  await reader.close();
  return groups;
}

function overlaps(ranges: Array<[number, number]>, [start, end]: [number, number]): boolean {
  return ranges.some(([offset, length]) => offset < end && offset + length > start);
}

/** Five episodes of 40 frames, 12 wide; extra unrequested column; 50-row groups, 7-row pages. */
async function multiEpisodeFile(dataPageV1 = false): Promise<Buffer> {
  const rows = [0, 1, 2, 3, 4].flatMap((ep) =>
    frameRows(ep, 40, 12).map((r, i) => ({ ...r, extra: Array.from({ length: 200 }, (_, j) => ep * 1e6 + i * 1e3 + j) })),
  );
  return parquetBuffer({ ...FRAME_FIELDS, extra: { type: 'DOUBLE', repeated: true } }, rows, {
    rowGroupSize: 50,
    pageSize: 7,
    dataPageV1,
  });
}

describe('readParquetRows', () => {
  for (const dataPageV1 of [false, true]) {
    it(`returns exactly one episode's rows across row groups and pages (data page ${dataPageV1 ? 'v1' : 'v2'})`, async () => {
      const buf = await multiEpisodeFile(dataPageV1);
      const { rows } = await readParquetRows(countingSource(buf), {
        columns: FRAME_COLUMNS,
        filter: { column: 'episode_index', equals: 3 },
      });
      const expected = frameRows(3, 40, 12);
      expect(rows).toHaveLength(40);
      expect(rows.map((r) => Number(r.frame_index))).toEqual(expected.map((r) => r.frame_index));
      expect(rows[17]['observation.state']).toEqual(expected[17]['observation.state']);
      expect(rows[39].action).toEqual(expected[39].action);
      expect(rows[5].timestamp).toBeCloseTo(5 / 30);
      expect(rows.every((r) => !('extra' in r))).toBe(true);
    });
  }

  it('never fetches an unrequested column or a row group the statistics exclude', async () => {
    const buf = await multiEpisodeFile();
    const groups = await chunkRanges(buf);
    expect(groups.length).toBe(4);
    const source = countingSource(buf);
    // Episode 4 is rows 160..199: only the last row group holds it.
    const result = await readParquetRows(source, { columns: FRAME_COLUMNS, filter: { column: 'episode_index', equals: 4 } });
    expect(result.rows).toHaveLength(40);
    expect(result.rowGroupsSkipped).toBe(3);
    expect(result.rowGroupsRead).toBe(1);
    for (const group of groups) expect(overlaps(source.ranges, group.extra)).toBe(false);
    for (const group of groups.slice(0, 3)) {
      for (const range of Object.values(group)) expect(overlaps(source.ranges, range)).toBe(false);
    }
    expect(source.bytes()).toBeLessThan(buf.length / 2);
  });

  it('returns every row when there is no filter, and nothing for an absent episode', async () => {
    const buf = await multiEpisodeFile();
    const all = await readParquetRows(countingSource(buf), { columns: ['frame_index'] });
    expect(all.rows).toHaveLength(200);
    const none = await readParquetRows(countingSource(buf), {
      columns: FRAME_COLUMNS,
      filter: { column: 'episode_index', equals: 9 },
    });
    expect(none.rows).toEqual([]);
    expect(none.rowGroupsRead).toBe(0);
  });

  it('keeps empty lists and nulls in their own rows', async () => {
    const buf = await parquetBuffer(
      { episode_index: { type: 'INT64' }, action: { type: 'DOUBLE', repeated: true }, timestamp: { type: 'DOUBLE', optional: true } },
      [
        { episode_index: 0, action: [1, 2], timestamp: 0 },
        { episode_index: 0, action: [], timestamp: null },
        { episode_index: 0, action: [3], timestamp: 0.2 },
      ],
    );
    const { rows } = await readParquetRows(countingSource(buf), {
      columns: ['action', 'timestamp'],
      filter: { column: 'episode_index', equals: 0 },
    });
    expect(rows.map((r) => r.action)).toEqual([[1, 2], [], [3]]);
    expect(rows.map((r) => r.timestamp)).toEqual([0, null, 0.2]);
  });

  it('takes the columns from a pick over the file\'s column names', async () => {
    const buf = await multiEpisodeFile();
    const { rows } = await readParquetRows(countingSource(buf), {
      columns: (names) => names.filter((n) => n !== 'extra' && n !== 'observation.state' && n !== 'action'),
      filter: { column: 'episode_index', equals: 0 },
    });
    expect(Object.keys(rows[0]).sort()).toEqual(['episode_index', 'frame_index', 'timestamp']);
  });

  describe('page skipping', () => {
    afterEach(() => vi.restoreAllMocks());

    /** Five episodes of 40 frames in ONE row group, as pyarrow writes a LeRobot file. */
    async function singleGroupFile(dataPageV1: boolean, width: (frame: number) => number = () => 12): Promise<Buffer> {
      const rows = [0, 1, 2, 3, 4].flatMap((ep) =>
        frameRows(ep, 40, 12).map((r, f) => ({
          ...r,
          action: Array.from({ length: width(ep * 40 + f) }, (_, j) => ep * 1000 + f + j / 100),
        })),
      );
      return parquetBuffer(FRAME_FIELDS, rows, { rowGroupSize: 1000, pageSize: 7, dataPageV1 });
    }

    for (const dataPageV1 of [false, true]) {
      it(`steps over the pages before a late episode without decoding them (data page ${dataPageV1 ? 'v1' : 'v2'})`, async () => {
        const buf = await singleGroupFile(dataPageV1);
        const decode = vi.spyOn(ParquetReader.prototype, 'decodePages');
        const { rows } = await readParquetRows(countingSource(buf), {
          columns: FRAME_COLUMNS,
          filter: { column: 'episode_index', equals: 4 },
        });
        expect(rows.map((r) => Number(r.frame_index))).toEqual(Array.from({ length: 40 }, (_, f) => f));
        expect(rows[0].action).toEqual(Array.from({ length: 12 }, (_, j) => 4000 + j / 100));
        expect(rows[39]['observation.state']).toEqual(frameRows(4, 40, 12)[39]['observation.state']);
        // 200 rows in 7-row pages is 29 pages per column; the filter column is
        // read whole, the four others only from row 160 on (~6 pages each).
        expect(decode.mock.calls.length).toBeLessThan(29 + 4 * 10);
      });
    }

    it('reads the column again when list widths vary and the skip miscounted', async () => {
      // Widths 1 and 3 alternate: the average (2) divides the level count evenly,
      // so the header-based skip runs and lands on the wrong rows.
      const buf = await singleGroupFile(true, (i) => (i % 2 === 0 ? 1 : 3));
      const { rows } = await readParquetRows(countingSource(buf), {
        columns: ['frame_index', 'action'],
        filter: { column: 'episode_index', equals: 3 },
      });
      expect(rows).toHaveLength(40);
      rows.forEach((r, f) => {
        const i = 3 * 40 + f;
        expect(r.action).toEqual(Array.from({ length: i % 2 === 0 ? 1 : 3 }, (_, j) => 3000 + f + j / 100));
      });
    });
  });
});
