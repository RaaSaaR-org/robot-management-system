/**
 * @file initiative.test.ts
 * @description The initiative gate. The load-bearing asymmetry: an operator is
 *              never blocked by crash-unacknowledged (their presence IS the
 *              acknowledgement), and the robot always is.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import {
  mayInitiate,
  SELF_INITIATIVE_MIN_BATTERY,
  type InitiativeContext,
} from '../initiative.js';
import { PLACE_STALE_MS } from '../../robot/StatePersistence.js';

/** A robot with nothing wrong with it: every refusal below is opt-in. */
function healthy(overrides: Partial<InitiativeContext> = {}): InitiativeContext {
  return {
    estopLatched: false,
    crashAcknowledged: true,
    batteryPercent: 90,
    place: 'AISLE-3',
    placeAgeMs: 1000,
    damped: false,
    ...overrides,
  };
}

describe('mayInitiate — origin', () => {
  it('never blocks an operator, whatever the robot has been through', () => {
    const wrecked: InitiativeContext = {
      estopLatched: true,
      crashAcknowledged: false,
      batteryPercent: 2,
      place: null,
      placeAgeMs: null,
      damped: true,
    };

    for (const kind of ['walk', 'goto', 'posture', 'look', 'speak'] as const) {
      const verdict = mayInitiate(kind, 'operator', wrecked);
      expect(verdict.ok).toBe(true);
    }
  });

  it('lets the robot act on its own when nothing is unresolved', () => {
    expect(mayInitiate('look', 'self', healthy()).ok).toBe(true);
    expect(mayInitiate('goto', 'self', healthy()).ok).toBe(true);
  });
});

describe('mayInitiate — crash recovery', () => {
  it('refuses SELF-initiated work while the crash is unacknowledged', () => {
    const verdict = mayInitiate('look', 'self', healthy({ crashAcknowledged: false }));

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/did not shut down cleanly/i);
  });

  it('does not refuse the same action to an operator', () => {
    expect(mayInitiate('look', 'operator', healthy({ crashAcknowledged: false })).ok).toBe(true);
  });
});

describe('mayInitiate — E-Stop', () => {
  it('refuses everything self-initiated while a latch is held', () => {
    const verdict = mayInitiate('speak', 'self', healthy({ estopLatched: true }));

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/E-Stop/);
  });
});

describe('mayInitiate — allowed kinds', () => {
  it('never stands itself back up on its own', () => {
    const verdict = mayInitiate('posture', 'self', healthy());

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/back on my feet/i);
  });
});

describe('mayInitiate — battery', () => {
  it('stops volunteering below the floor', () => {
    const verdict = mayInitiate('look', 'self', healthy({ batteryPercent: 5 }));

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('5%');
  });

  it('treats an unknown battery as a reason to sit still, not as a full one', () => {
    expect(mayInitiate('look', 'self', healthy({ batteryPercent: null })).ok).toBe(false);
  });

  it('still lets it speak — talking costs nothing', () => {
    expect(mayInitiate('speak', 'self', healthy({ batteryPercent: 1 })).ok).toBe(true);
    expect(mayInitiate('wait', 'self', healthy({ batteryPercent: null })).ok).toBe(true);
  });

  it('allows exactly the floor value', () => {
    expect(
      mayInitiate('look', 'self', healthy({ batteryPercent: SELF_INITIATIVE_MIN_BATTERY })).ok
    ).toBe(true);
  });
});

describe('mayInitiate — knowing where it is', () => {
  it('does not go and look when it does not know where it is', () => {
    const verdict = mayInitiate('goto', 'self', healthy({ place: null, placeAgeMs: null }));

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('I did not go and look because I do not know where I am.');
  });

  it('does not trust a place it learned too long ago', () => {
    const verdict = mayInitiate('walk', 'self', healthy({ placeAgeMs: PLACE_STALE_MS + 1 }));

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/too old to trust/);
  });

  it('does not move a damped base and pretend it went somewhere', () => {
    const verdict = mayInitiate('walk', 'self', healthy({ damped: true }));

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/damped/);
  });

  it('still looks around when the place is unknown — looking does not move it', () => {
    expect(mayInitiate('look', 'self', healthy({ place: null, placeAgeMs: null })).ok).toBe(true);
    expect(mayInitiate('scan_room', 'self', healthy({ damped: true })).ok).toBe(true);
  });
});

describe('mayInitiate — purity', () => {
  it('does not mutate the context it was handed', () => {
    const context = healthy({ estopLatched: true });
    const snapshot = { ...context };

    mayInitiate('walk', 'self', context);

    expect(context).toEqual(snapshot);
  });

  it('always answers with a reason, refusal or not', () => {
    expect(mayInitiate('look', 'self', healthy()).reason).not.toBe('');
    expect(mayInitiate('look', 'operator', healthy()).reason).not.toBe('');
  });
});
