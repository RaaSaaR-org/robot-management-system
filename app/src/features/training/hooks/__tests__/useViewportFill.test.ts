/**
 * @file useViewportFill.test.ts
 * @description The height that takes the episode stage to the bottom of the
 *              window (TASK-484): what is left under its top, less a gap,
 *              between a floor and a cap.
 * @feature training
 */

import { describe, it, expect } from 'vitest';
import { fillHeight } from '../useViewportFill';

const STAGE = { min: 320, max: 900, gap: 16 };

describe('fillHeight', () => {
  it('ends the element one gap above the bottom of the window', () => {
    expect(fillHeight(720, 304, STAGE)).toBe(400);
    expect(fillHeight(900, 304, STAGE)).toBe(580);
  });

  it('shrinks when something above pushes the element down (a view banner, a wrapped title)', () => {
    // 1280x720 with the view banner above the stage: still inside the window.
    expect(fillHeight(720, 366, STAGE)).toBe(338);
    expect(366 + fillHeight(720, 366, STAGE)).toBeLessThanOrEqual(720);
  });

  it('never goes below the floor: a short window scrolls instead', () => {
    expect(fillHeight(560, 304, STAGE)).toBe(320);
  });

  it('never goes above the cap', () => {
    expect(fillHeight(1600, 280, STAGE)).toBe(900);
  });

  it('rounds to whole pixels', () => {
    expect(fillHeight(720.5, 303.8, STAGE)).toBe(401);
  });
});
