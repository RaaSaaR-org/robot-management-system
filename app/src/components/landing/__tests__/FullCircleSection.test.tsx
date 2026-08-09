/**
 * @file FullCircleSection.test.tsx
 * @description Guards the two claims the full-circle graphic makes structurally
 *              rather than in prose: the path visits the stages in lifecycle
 *              order, and each node's ping is timed to the segment travelling
 *              past it.
 * @feature landing
 */

import { describe, it, expect } from 'vitest';
import { STAGES, pingDelaySeconds } from '../FullCircleSection';

/** The loop duration the CSS variable is set to, mirrored for the bounds check. */
const LOOP_SECONDS = 11;

describe('full circle geometry', () => {
  it('visits the six stages in lifecycle order as the path is walked', () => {
    const walked = [...STAGES].sort((a, b) => a.t - b.t).map((s) => s.key);

    // The path starts at Train, so the lifecycle order is rotated by one — the
    // point is that it never doubles back. The previous layout walked
    // 1 → 3 → 2 on the build lobe, which is what this exists to prevent.
    expect(walked).toEqual(['train', 'deploy', 'evaluate', 'operate', 'comply', 'collect']);
  });

  it('numbers the stages in lifecycle order independently of the geometry', () => {
    expect([...STAGES].sort((a, b) => a.index - b.index).map((s) => s.key)).toEqual([
      'collect',
      'train',
      'deploy',
      'evaluate',
      'operate',
      'comply',
    ]);
  });

  it('places every node inside the path and none of them on top of each other', () => {
    const fractions = STAGES.map((s) => s.t);
    fractions.forEach((t) => {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
    });
    expect(new Set(fractions).size).toBe(STAGES.length);
  });

  it('seats the two junction nodes exactly on the path start and the crossover', () => {
    // Train is the path's `M`, Operate is where the second Bézier ends. Both are
    // exact, unlike the four mid-segment nodes, which need the arc-length
    // correction.
    expect(STAGES.find((s) => s.key === 'train')?.t).toBe(0);
    expect(STAGES.find((s) => s.key === 'operate')?.t).toBe(0.5);
  });
});

describe('pingDelaySeconds', () => {
  it('starts every node mid-cycle so none of them wait a lap to fire', () => {
    STAGES.forEach((stage) => {
      const delay = pingDelaySeconds(stage.t);
      expect(delay).toBeLessThanOrEqual(0);
      expect(delay).toBeGreaterThan(-LOOP_SECONDS);
    });
  });

  it('spaces consecutive pings by the distance between their nodes', () => {
    // This is the property that makes the effect read as one signal travelling
    // rather than six independent blinkers: the gap between two pings has to be
    // the gap along the path. Ordering is by fire time, not by `t`, because the
    // head starts NODE_LEAD along the curve — Train sits just behind that, so
    // its next ping is nearly a full lap away and it fires last.
    const byFireTime = [...STAGES].sort((a, b) => pingDelaySeconds(a.t) - pingDelaySeconds(b.t));

    for (let i = 1; i < byFireTime.length; i += 1) {
      const gapSeconds = pingDelaySeconds(byFireTime[i].t) - pingDelaySeconds(byFireTime[i - 1].t);
      const gapAlongPath = (((byFireTime[i].t - byFireTime[i - 1].t) % 1) + 1) % 1;
      expect(gapSeconds).toBeCloseTo(gapAlongPath * LOOP_SECONDS, 6);
    }

    expect(byFireTime.map((s) => s.key)).toEqual([
      'deploy',
      'evaluate',
      'operate',
      'comply',
      'collect',
      'train',
    ]);
  });

  it('fires immediately for the node the head starts on', () => {
    // The head's leading edge sits NODE_LEAD ahead of the animation's own
    // progress, so a node exactly that far along is lit at t=0.
    expect(pingDelaySeconds(0.044)).toBeCloseTo(0, 10);
  });
});
