/**
 * @file humanize.test.ts
 * @description Tests for turning machine-written incident text into one readable line
 * @feature incidents
 */

import { describe, expect, it } from 'vitest';
import { humanizeMachineText } from '../humanize';

describe('humanizeMachineText', () => {
  it('passes prose through unchanged', () => {
    expect(humanizeMachineText('Robot bumped a shelf.')).toEqual({ summary: 'Robot bumped a shelf.', raw: null });
  });

  it('drops markdown emphasis that server-written descriptions carry', () => {
    const { summary } = humanizeMachineText(
      'An emergency stop event was detected.\n\n**Reason:** Fleet-wide stop',
    );
    expect(summary).toBe('An emergency stop event was detected. Reason: Fleet-wide stop');
  });

  it('turns route/place/type pairs into a sentence and keeps the raw string', () => {
    const raw = 'route: House round · place: HALLWAY · type: unexpected_object';
    expect(humanizeMachineText(raw)).toEqual({
      summary: 'Unexpected object in Hallway, on route House round',
      raw,
    });
  });

  it('returns an empty summary for missing text', () => {
    expect(humanizeMachineText(null)).toEqual({ summary: '', raw: null });
  });
});
