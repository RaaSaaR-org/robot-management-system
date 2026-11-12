/**
 * @file datasetMeta.test.ts
 * @description Aggregating `meta/episodes_stats.jsonl` the way LeRobot does, and
 *              reading joint groups out of a GR00T `meta/modality.json`.
 * @feature training
 *
 * The fixture is nvidia/GR00T-N1.7-AppleToPlate's own meta directory, trimmed:
 * `info.json` and `modality.json` whole, `episodes_stats.jsonl` cut to its
 * first three episodes and four features.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { aggregateEpisodeStats, parseModality } from '../datasetMeta.js';

const FIXTURES = join(__dirname, 'fixtures', 'gr00t-apple-to-plate');
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const line = (stats: Record<string, unknown>) => JSON.stringify({ episode_index: 0, stats });

describe('aggregateEpisodeStats', () => {
  it('weights the mean by frame count and pools the std through total variance', () => {
    // Episode A: the values 0, 2 (mean 1, std 1, n 2).
    // Episode B: the values 4, 4, 4, 4, 4, 4 (mean 4, std 0, n 6).
    // Together: eight values, mean 26/8 = 3.25, population variance
    // (3.25² + 1.25² + 6·0.75²) / 8 = 1.9375.
    const { stats, episodes } = aggregateEpisodeStats([
      line({ x: { min: [0], max: [2], mean: [1], std: [1], count: [2] } }),
      line({ x: { min: [4], max: [4], mean: [4], std: [0], count: [6] } }),
    ].join('\n'));
    expect(episodes).toBe(2);
    expect(stats.x).toEqual({ min: [0], max: [4], mean: [3.25], std: [Math.sqrt(1.9375)], count: [8] });
  });

  it('aggregates the real GR00T file: 43-wide vectors, min of mins, max of maxes', () => {
    const { stats, episodes, skippedLines } = aggregateEpisodeStats(read('episodes_stats.jsonl'));
    expect(episodes).toBe(3);
    expect(skippedLines).toBe(0);

    // Reference values computed independently from the same three lines.
    const state = stats['observation.state'] as unknown as Record<string, number[]>;
    expect(state.mean).toHaveLength(43);
    expect(state.count).toEqual([590 + 535 + 478]);
    expect(state.min![0]).toBe(-0.5850111246109009);
    expect(state.max![0]).toBe(-0.5734404921531677);
    expect(state.mean![0]).toBeCloseTo(-0.5811261375918659, 12);
    expect(state.std![0]).toBeCloseTo(0.002087443823598397, 12);
    expect(state.mean![42]).toBeCloseTo(0.07042395244500671, 12);

    const action = stats.action as unknown as Record<string, number[]>;
    expect(action.min![15]).toBe(-0.9758977890014648);
    expect(action.max![18]).toBe(1.207809567451477);
    expect(action.mean![15]).toBeCloseTo(-0.5243984794363854, 12);
    expect(action.std![18]).toBeCloseTo(0.31797822615266863, 12);
  });

  it('keeps the nesting of image statistics and their own sample count', () => {
    const { stats } = aggregateEpisodeStats(read('episodes_stats.jsonl'));
    const image = stats['observation.images.ego_view'] as unknown as { mean: number[][][]; std: number[][][]; count: number[] };
    // Images are sampled, so their count is not the episode length.
    expect(image.count).toEqual([119 + 111 + 102]);
    expect(image.mean).toHaveLength(3);
    expect(image.mean[0]![0]![0]).toBeCloseTo(0.40644424204169616, 12);
    expect(image.std[2]![0]![0]).toBeCloseTo(0.2042726732390433, 12);
  });

  it('skips a broken line and an episode whose vector has a different width', () => {
    const { stats, episodes, skippedLines } = aggregateEpisodeStats([
      line({ x: { min: [0, 0], max: [1, 1], mean: [0.5, 0.5], std: [0, 0], count: [1] } }),
      '{ not json',
      line({ x: { min: [9], max: [9], mean: [9], std: [0], count: [1] } }),
      line({ x: { min: [0, -1], max: [3, 1], mean: [1.5, 0.5], std: [0, 0], count: [1] } }),
      '',
    ].join('\n'));
    expect(episodes).toBe(3);
    expect(skippedLines).toBe(1);
    expect(stats.x!.min).toEqual([0, -1]);
    expect(stats.x!.max).toEqual([3, 1]);
    expect(stats.x!.count).toEqual([2]);
  });

  it('answers with no features for an empty file', () => {
    expect(aggregateEpisodeStats('').stats).toEqual({});
  });
});

describe('parseModality', () => {
  const info = JSON.parse(read('info.json'));
  const modality = JSON.parse(read('modality.json'));

  it('reads the seven joint groups of the G1 state vector, in channel order', () => {
    expect(parseModality(modality, info)!.state).toEqual([
      { name: 'left_leg', start: 0, end: 6 },
      { name: 'right_leg', start: 6, end: 12 },
      { name: 'waist', start: 12, end: 15 },
      { name: 'left_arm', start: 15, end: 22 },
      { name: 'right_arm', start: 22, end: 29 },
      { name: 'left_hand', start: 29, end: 36 },
      { name: 'right_hand', start: 36, end: 43 },
    ]);
  });

  it('leaves out action entries that index another column (original_key)', () => {
    // `effort_left_leg` is 0..6 of `action.effort_left_leg`, not of `action`.
    const names = parseModality(modality, info)!.action.map((g) => g.name);
    expect(names).toEqual(['left_leg', 'right_leg', 'waist', 'left_arm', 'right_arm', 'left_hand', 'right_hand']);
  });

  it('drops a group that reaches past the declared width, and overlapping ones', () => {
    const parsed = parseModality(
      { state: { a: { start: 0, end: 3 }, overlap: { start: 2, end: 4 }, b: { start: 3, end: 6 }, far: { start: 6, end: 9 } } },
      { features: { 'observation.state': { shape: [6] } } },
    );
    expect(parsed!.state.map((g) => g.name)).toEqual(['a', 'b']);
  });

  it('answers null when nothing usable is named', () => {
    expect(parseModality(null)).toBeNull();
    expect(parseModality([])).toBeNull();
    expect(parseModality({ video: { ego_view: { original_key: 'observation.images.ego_view' } } })).toBeNull();
    expect(parseModality({ state: { bad: { start: 3, end: 3 }, worse: { start: 'a', end: 2 } } })).toBeNull();
  });
});
