/**
 * @file geofence-enforcement.test.ts
 * @description TASK-201: the derivation of the operator-facing "is the fence
 *   fencing?" label from a geofence verdict, and the warn-only advisory that
 *   goes with it.
 * @feature safety
 * @status test
 *
 * The defect this pins is that `clear` and `unknown` used to RENDER THE SAME —
 * as nothing — so a fence that had stopped fencing was indistinguishable from
 * one that had just answered "all clear". Every case below is therefore a claim
 * about which of two different answers a verdict produces, never about whether
 * it produces one.
 */

import { describe, expect, it } from 'vitest';
import {
  GEOFENCE_ADVISORY_PREFIX,
  ZONE_VIOLATION_REASON_PREFIX,
  geofenceAdvisory,
  geofenceEnforcement,
} from '../types.js';
import type { GeofenceStatus, GeofenceUnknownCause, ZoneViolation } from '../types.js';

const RACK: ZoneViolation = {
  placeId: 'RACK-A',
  placeName: 'Rack A',
  depthM: 0.49,
  poseM: { x: 5.01, y: -1.99 },
};

function unknown(cause: GeofenceUnknownCause, reason = 'because'): GeofenceStatus {
  return { kind: 'unknown', cause, reason };
}

describe('geofenceEnforcement — the seven verdict sites, one label each', () => {
  /**
   * The two halves of the whole bug, side by side. Before TASK-201 these two
   * produced the same (absent) operator-facing answer; the test exists to make
   * them produce different ones.
   */
  it('an unknown verdict from a spent drift budget says the fence is NOT enforcing', () => {
    expect(geofenceEnforcement(unknown('pose-drifted'))).toBe('not-enforcing');
  });

  it('a clear verdict does NOT — the fence answered, which is the fence working', () => {
    expect(geofenceEnforcement({ kind: 'clear' })).toBe('enforcing');
  });

  it('a violating verdict is enforcing too — an answer either way is the fence working', () => {
    expect(geofenceEnforcement({ kind: 'violating', violation: RACK })).toBe('enforcing');
  });

  it('no pose at all is not enforcing — there is a fence and it cannot fence', () => {
    expect(geofenceEnforcement(unknown('no-pose'))).toBe('not-enforcing');
  });

  /**
   * `no-map` is a THIRD answer and not a softer spelling of `not-enforcing`.
   * Every robot nobody has handed a survey to is in this state permanently, and
   * reporting a permanent lapse on all of them is how the new signal would
   * become wallpaper — the failure mode that makes the real lapse invisible
   * again.
   */
  it('a missing or unregistered map is `no-map`, not a lapse', () => {
    expect(geofenceEnforcement(unknown('no-map'))).toBe('no-map');
  });

  /**
   * The two withheld-RELEASE cases. Both are `unknown`, and mapping either to
   * `not-enforcing` would alarm at the exact moment the fence is holding
   * hardest: a `violating` verdict still passes through both and still stops
   * the robot.
   */
  it('the release hysteresis band is enforcing — a violation still fires from there', () => {
    expect(geofenceEnforcement(unknown('release-margin'))).toBe('enforcing');
  });

  it('a re-anchor hold is enforcing — it withholds a release, never a stop', () => {
    expect(geofenceEnforcement(unknown('reanchor-hold'))).toBe('enforcing');
  });
});

describe('the warn-only advisory', () => {
  it('is raised for a lapse and names the reason the evaluator gave', () => {
    const advisory = geofenceAdvisory(unknown('pose-drifted', 'the pose has drifted past its budget'));
    expect(advisory).toContain(GEOFENCE_ADVISORY_PREFIX);
    expect(advisory).toContain('the pose has drifted past its budget');
  });

  it('is silent while the fence is enforcing, and silent when there is no map', () => {
    expect(geofenceAdvisory({ kind: 'clear' })).toBeNull();
    expect(geofenceAdvisory({ kind: 'violating', violation: RACK })).toBeNull();
    expect(geofenceAdvisory(unknown('release-margin'))).toBeNull();
    expect(geofenceAdvisory(unknown('reanchor-hold'))).toBeNull();
    // A robot with no survey has no fence to lose. A warning on every one of
    // them would train operators to ignore this channel.
    expect(geofenceAdvisory(unknown('no-map'))).toBeNull();
  });

  /**
   * `SafetyMonitor` tells STOPS apart from everything else in `warnings` by
   * these three substrings — that is how `resetEmergencyStop` and
   * `clearZoneViolationStop` find the lines a reset is allowed to remove.
   *
   * To be precise about the mechanism, because the obvious reading is wrong:
   * this advisory is a private field spliced into a freshly built array in
   * `getStatus()`, NOT a member of `SimulatedRobotState.warnings`, so no reset
   * could delete it as things stand. The coupling is at the READ surface. The
   * advisory shares one `warnings` array with the latched-stop lines, and
   * anything that classifies those lines by substring — a matcher, a log
   * filter, an operator scanning `/safety` — would read a fence advisory as a
   * latched stop that `estop.status` says is not latched.
   *
   * Keeping the advisory outside those three substrings also keeps the door
   * shut on the version where the rationale WOULD be literal: route this
   * through `applyStopToState()` some day and a reset really could delete a
   * live safety warning.
   *
   * A string test on purpose: the coupling is a substring match in another
   * file, and nothing but a substring test can see it.
   */
  it('contains none of the three strings that existing warning matchers eat', () => {
    for (const cause of ['no-pose', 'pose-drifted'] as const) {
      const advisory = geofenceAdvisory(unknown(cause, 'some reason'));
      expect(advisory).not.toBeNull();
      expect(advisory).not.toContain('Protective stop');
      expect(advisory).not.toContain('Emergency stop');
      expect(advisory).not.toContain(ZONE_VIOLATION_REASON_PREFIX);
    }
  });
});
