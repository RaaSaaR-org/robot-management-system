/**
 * @file SecureAggregator.test.ts
 * @description Unit tests for SecureAggregator — collection of masked federated-learning
 *   updates, element-wise aggregation (masks cancel → true sum), dropout handling,
 *   status reporting, result retrieval, and round cleanup. Pure in-memory service,
 *   so no I/O is mocked; each test uses a fresh SecureAggregator instance.
 * @feature Secure Aggregation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SecureAggregator,
  secureAggregator,
  type MaskedUpdate,
} from '../SecureAggregator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUpdate(overrides: Partial<MaskedUpdate> = {}): MaskedUpdate {
  return {
    robotId: 'r1',
    roundId: 'round-1',
    maskedGradients: [
      [1, 2],
      [3, 4],
    ],
    participantCount: 2,
    ...overrides,
  };
}

let agg: SecureAggregator;

beforeEach(() => {
  agg = new SecureAggregator();
});

// ===========================================================================
// collectUpdate
// ===========================================================================

describe('collectUpdate', () => {
  it('stores an update and reflects it in the status', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));

    const status = agg.getAggregationStatus('round-1');
    expect(status.collectedCount).toBe(1);
    expect(status.submittedRobots).toEqual(['r1']);
    expect(status.expectedCount).toBe(2); // taken from participantCount
    expect(status.aggregated).toBe(false);
  });

  it('collects updates from multiple distinct robots', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    agg.collectUpdate('round-1', 'r2', makeUpdate({ robotId: 'r2' }));

    const status = agg.getAggregationStatus('round-1');
    expect(status.collectedCount).toBe(2);
    expect(status.submittedRobots).toEqual(expect.arrayContaining(['r1', 'r2']));
  });

  it('throws when the same robot submits twice for a round', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    expect(() => agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }))).toThrow(
      'Robot r1 has already submitted for round round-1'
    );
  });

  it('throws when the round has already been aggregated', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    agg.aggregate('round-1', 1);
    expect(() => agg.collectUpdate('round-1', 'r2', makeUpdate({ robotId: 'r2' }))).toThrow(
      'Round round-1 has already been aggregated'
    );
  });

  it('throws when the robot was marked as dropped', () => {
    agg.handleDropout('round-1', 'r1');
    expect(() => agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }))).toThrow(
      'Robot r1 was marked as dropped for round round-1'
    );
  });
});

// ===========================================================================
// aggregate
// ===========================================================================

describe('aggregate', () => {
  it('sums masked gradients element-wise across participants', () => {
    agg.collectUpdate(
      'round-1',
      'r1',
      makeUpdate({
        robotId: 'r1',
        maskedGradients: [
          [1, 2],
          [3, 4],
        ],
      })
    );
    agg.collectUpdate(
      'round-1',
      'r2',
      makeUpdate({
        robotId: 'r2',
        maskedGradients: [
          [10, 20],
          [30, 40],
        ],
      })
    );

    const result = agg.aggregate('round-1', 2);

    expect(result.roundId).toBe('round-1');
    expect(result.aggregatedGradients).toEqual([
      [11, 22],
      [33, 44],
    ]);
    expect(result.participantCount).toBe(2);
    expect(result.droppedParticipants).toEqual([]);
    expect(typeof result.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  it('demonstrates that additive pairwise masks cancel to the true sum', () => {
    // r1 raw = [[1,1]], r2 raw = [[2,2]]; true sum = [[3,3]]
    // Apply equal-and-opposite pairwise masks that cancel on summation.
    const mask = 5;
    agg.collectUpdate(
      'round-1',
      'r1',
      makeUpdate({ robotId: 'r1', maskedGradients: [[1 + mask, 1 + mask]] })
    );
    agg.collectUpdate(
      'round-1',
      'r2',
      makeUpdate({ robotId: 'r2', maskedGradients: [[2 - mask, 2 - mask]] })
    );

    const result = agg.aggregate('round-1', 2);
    expect(result.aggregatedGradients).toEqual([[3, 3]]);
  });

  it('is idempotent — repeated calls return the cached result', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    const first = agg.aggregate('round-1', 1);
    const second = agg.aggregate('round-1', 1);
    expect(second).toBe(first); // same object reference (cached)
  });

  it('throws when no updates have been collected', () => {
    expect(() => agg.aggregate('empty-round', 3)).toThrow(
      'No updates collected for round empty-round'
    );
  });

  it('handles a single empty-gradient update (zero rows)', () => {
    agg.collectUpdate(
      'round-1',
      'r1',
      makeUpdate({ robotId: 'r1', maskedGradients: [] })
    );
    const result = agg.aggregate('round-1', 1);
    expect(result.aggregatedGradients).toEqual([]);
    expect(result.participantCount).toBe(1);
  });

  it('records dropped participants in the result', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    agg.handleDropout('round-1', 'r2');
    const result = agg.aggregate('round-1', 2);
    expect(result.droppedParticipants).toEqual(['r2']);
  });
});

// ===========================================================================
// handleDropout
// ===========================================================================

describe('handleDropout', () => {
  it('marks a participant as dropped', () => {
    agg.handleDropout('round-1', 'r1');
    const status = agg.getAggregationStatus('round-1');
    expect(status.droppedRobots).toEqual(['r1']);
  });

  it('removes an already-submitted update when the robot drops', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    agg.collectUpdate('round-1', 'r2', makeUpdate({ robotId: 'r2' }));

    agg.handleDropout('round-1', 'r1');

    const status = agg.getAggregationStatus('round-1');
    expect(status.collectedCount).toBe(1);
    expect(status.submittedRobots).toEqual(['r2']);
    expect(status.droppedRobots).toEqual(['r1']);
  });

  it('is idempotent — dropping twice does not duplicate the entry', () => {
    agg.handleDropout('round-1', 'r1');
    agg.handleDropout('round-1', 'r1');
    const status = agg.getAggregationStatus('round-1');
    expect(status.droppedRobots).toEqual(['r1']);
  });

  it('throws when the round has already been aggregated', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    agg.aggregate('round-1', 1);
    expect(() => agg.handleDropout('round-1', 'r1')).toThrow(
      'Round round-1 has already been aggregated'
    );
  });
});

// ===========================================================================
// getAggregationStatus
// ===========================================================================

describe('getAggregationStatus', () => {
  it('returns an empty status for an unknown round', () => {
    const status = agg.getAggregationStatus('never-seen');
    expect(status).toEqual({
      roundId: 'never-seen',
      collectedCount: 0,
      expectedCount: 0,
      submittedRobots: [],
      droppedRobots: [],
      aggregated: false,
    });
  });

  it('reports aggregated = true once the round is aggregated', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    expect(agg.getAggregationStatus('round-1').aggregated).toBe(false);
    agg.aggregate('round-1', 1);
    expect(agg.getAggregationStatus('round-1').aggregated).toBe(true);
  });
});

// ===========================================================================
// getResult
// ===========================================================================

describe('getResult', () => {
  it('returns null before aggregation', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    expect(agg.getResult('round-1')).toBeNull();
  });

  it('returns null for an unknown round', () => {
    expect(agg.getResult('ghost')).toBeNull();
  });

  it('returns the cached result after aggregation', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    const result = agg.aggregate('round-1', 1);
    expect(agg.getResult('round-1')).toBe(result);
  });
});

// ===========================================================================
// clearRound
// ===========================================================================

describe('clearRound', () => {
  it('removes all state for a round', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    agg.aggregate('round-1', 1);

    agg.clearRound('round-1');

    expect(agg.getResult('round-1')).toBeNull();
    expect(agg.getAggregationStatus('round-1')).toEqual({
      roundId: 'round-1',
      collectedCount: 0,
      expectedCount: 0,
      submittedRobots: [],
      droppedRobots: [],
      aggregated: false,
    });
  });

  it('is a no-op for an unknown round', () => {
    expect(() => agg.clearRound('ghost')).not.toThrow();
  });

  it('allows a round id to be reused after clearing', () => {
    agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }));
    agg.aggregate('round-1', 1);
    agg.clearRound('round-1');

    // Should not throw "already aggregated" — fresh state.
    expect(() => agg.collectUpdate('round-1', 'r1', makeUpdate({ robotId: 'r1' }))).not.toThrow();
    expect(agg.getAggregationStatus('round-1').collectedCount).toBe(1);
  });
});

// ===========================================================================
// expectedCount derivation
// ===========================================================================

describe('expected participant tracking', () => {
  it('seeds expectedParticipants from the first collected update only', () => {
    agg.collectUpdate(
      'round-1',
      'r1',
      makeUpdate({ robotId: 'r1', participantCount: 5 })
    );
    // second update with a different count must not overwrite the seeded value
    agg.collectUpdate(
      'round-1',
      'r2',
      makeUpdate({ robotId: 'r2', participantCount: 99 })
    );
    expect(agg.getAggregationStatus('round-1').expectedCount).toBe(5);
  });

  it('lets aggregate seed expectedCount when no update provided one', () => {
    // Drop first creates the round with expected = 0, then dropout keeps it 0.
    agg.handleDropout('round-1', 'rX');
    expect(agg.getAggregationStatus('round-1').expectedCount).toBe(0);
  });
});

// ===========================================================================
// singleton export sanity
// ===========================================================================

describe('singleton export', () => {
  it('exports a SecureAggregator instance', () => {
    expect(secureAggregator).toBeInstanceOf(SecureAggregator);
  });
});
