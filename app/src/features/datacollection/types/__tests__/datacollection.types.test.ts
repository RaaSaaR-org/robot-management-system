/**
 * @file datacollection.types.test.ts
 * @description Tests for the per-episode statistic formatter the completed-session
 *              review table renders its Dropped and fps columns with.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { formatEpisodeStat } from '../datacollection.types';

// The review table itself lives inside `SessionDetailPage`, which has no render
// harness in this repo — it wants a router, two Zustand stores, a telemetry
// socket and a lazily-loaded three.js viewer. The decision those two new columns
// make is entirely in this formatter, so that is where it is pinned.
describe('formatEpisodeStat', () => {
  it('renders a drop count as a whole number', () => {
    expect(formatEpisodeStat(0)).toBe('0');
    expect(formatEpisodeStat(143)).toBe('143');
    expect(formatEpisodeStat(12.7)).toBe('13');
  });

  it('renders achieved fps to one decimal', () => {
    expect(formatEpisodeStat(29.94, 1)).toBe('29.9');
    expect(formatEpisodeStat(30, 1)).toBe('30.0');
  });

  it('renders an em-dash for a session recorded before the fields existed', () => {
    // NOT '0'. An episode that never counted its drops has not claimed the
    // recorder kept up, and a zero would make exactly that claim on every
    // session predating TASK-215.
    expect(formatEpisodeStat(undefined)).toBe('—');
    expect(formatEpisodeStat(undefined, 1)).toBe('—');
  });

  it('renders an em-dash rather than NaN or Infinity', () => {
    // `fpsActual` is frames over elapsed time, and a zero-length episode divides
    // by zero somewhere upstream.
    expect(formatEpisodeStat(Number.NaN, 1)).toBe('—');
    expect(formatEpisodeStat(Infinity, 1)).toBe('—');
  });

  it('distinguishes a real zero from an absent value', () => {
    expect(formatEpisodeStat(0)).not.toBe(formatEpisodeStat(undefined));
  });
});
