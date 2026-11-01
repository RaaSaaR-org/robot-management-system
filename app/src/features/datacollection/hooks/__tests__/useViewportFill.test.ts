/**
 * @file useViewportFill.test.ts
 * @description The Record console's height (TASK-428): the viewport below the
 *              console's top, less the shell's 24 px, never below 520 px.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { CONSOLE_BOTTOM_GAP, CONSOLE_MIN_H, consoleHeight } from '../useViewportFill';

describe('consoleHeight', () => {
  it('fills the viewport below the console, less the shell padding', () => {
    expect(consoleHeight(945, 216)).toBe(945 - 216 - CONSOLE_BOTTOM_GAP);
  });

  it('shrinks when something above pushes the console down (the alarm banner)', () => {
    expect(consoleHeight(945, 216 + 78)).toBe(consoleHeight(945, 216) - 78);
  });

  it('never goes below the minimum', () => {
    expect(consoleHeight(600, 300)).toBe(CONSOLE_MIN_H);
  });
});
