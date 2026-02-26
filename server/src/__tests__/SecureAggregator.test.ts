/**
 * @file SecureAggregator.test.ts
 * @description Tests for the server-side secure aggregation service and API routes.
 * @feature Secure Aggregation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { SecureAggregator } from '../services/SecureAggregator.js';
import { createApp } from '../app.js';
import type { MaskedUpdate, AggregationResult, AggregationStatus } from '../services/SecureAggregator.js';

// ════════════════════════════════════════════════════════════════════════════
// Unit Tests — SecureAggregator class
// ════════════════════════════════════════════════════════════════════════════

describe('SecureAggregator', () => {
  let aggregator: SecureAggregator;

  beforeEach(() => {
    aggregator = new SecureAggregator();
  });

  // ─── collectUpdate ──────────────────────────────────────────────────

  describe('collectUpdate', () => {
    it('stores a masked update', () => {
      const update: MaskedUpdate = {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1, 2], [3, 4]],
        participantCount: 3,
      };

      aggregator.collectUpdate('round-1', 'r1', update);
      const status = aggregator.getAggregationStatus('round-1');
      expect(status.collectedCount).toBe(1);
      expect(status.submittedRobots).toContain('r1');
    });

    it('stores multiple updates from different robots', () => {
      for (let i = 1; i <= 3; i++) {
        aggregator.collectUpdate('round-1', `r${i}`, {
          robotId: `r${i}`,
          roundId: 'round-1',
          maskedGradients: [[i]],
          participantCount: 3,
        });
      }

      const status = aggregator.getAggregationStatus('round-1');
      expect(status.collectedCount).toBe(3);
    });

    it('rejects duplicate submission from same robot', () => {
      const update: MaskedUpdate = {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1]],
        participantCount: 2,
      };

      aggregator.collectUpdate('round-1', 'r1', update);
      expect(() => aggregator.collectUpdate('round-1', 'r1', update)).toThrow(
        'already submitted',
      );
    });

    it('rejects submission after aggregation', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1, 2]],
        participantCount: 1,
      });

      aggregator.aggregate('round-1', 1);

      expect(() =>
        aggregator.collectUpdate('round-1', 'r2', {
          robotId: 'r2',
          roundId: 'round-1',
          maskedGradients: [[3, 4]],
          participantCount: 2,
        }),
      ).toThrow('already been aggregated');
    });

    it('rejects submission from a dropped robot', () => {
      aggregator.handleDropout('round-1', 'r1');

      expect(() =>
        aggregator.collectUpdate('round-1', 'r1', {
          robotId: 'r1',
          roundId: 'round-1',
          maskedGradients: [[1]],
          participantCount: 2,
        }),
      ).toThrow('marked as dropped');
    });
  });

  // ─── aggregate ──────────────────────────────────────────────────────

  describe('aggregate', () => {
    it('sums masked gradients element-wise', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1, 2], [3, 4]],
        participantCount: 2,
      });

      aggregator.collectUpdate('round-1', 'r2', {
        robotId: 'r2',
        roundId: 'round-1',
        maskedGradients: [[10, 20], [30, 40]],
        participantCount: 2,
      });

      const result = aggregator.aggregate('round-1', 2);
      expect(result.aggregatedGradients).toEqual([[11, 22], [33, 44]]);
    });

    it('returns correct participant count', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1]],
        participantCount: 3,
      });

      aggregator.collectUpdate('round-1', 'r2', {
        robotId: 'r2',
        roundId: 'round-1',
        maskedGradients: [[2]],
        participantCount: 3,
      });

      const result = aggregator.aggregate('round-1', 3);
      expect(result.participantCount).toBe(2);
    });

    it('returns the same result on repeated calls (idempotent)', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[5]],
        participantCount: 1,
      });

      const r1 = aggregator.aggregate('round-1', 1);
      const r2 = aggregator.aggregate('round-1', 1);
      expect(r1).toEqual(r2);
    });

    it('throws when no updates collected', () => {
      expect(() => aggregator.aggregate('empty-round', 3)).toThrow('No updates collected');
    });

    it('includes dropped participants in result', () => {
      aggregator.handleDropout('round-1', 'r3');
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1]],
        participantCount: 3,
      });

      const result = aggregator.aggregate('round-1', 3);
      expect(result.droppedParticipants).toContain('r3');
    });

    it('has valid ISO timestamp', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1]],
        participantCount: 1,
      });

      const result = aggregator.aggregate('round-1', 1);
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('handles single-element gradients', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[42]],
        participantCount: 1,
      });

      const result = aggregator.aggregate('round-1', 1);
      expect(result.aggregatedGradients).toEqual([[42]]);
    });
  });

  // ─── handleDropout ──────────────────────────────────────────────────

  describe('handleDropout', () => {
    it('marks a robot as dropped', () => {
      aggregator.handleDropout('round-1', 'r1');
      const status = aggregator.getAggregationStatus('round-1');
      expect(status.droppedRobots).toContain('r1');
    });

    it('removes previously submitted update of dropped robot', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1]],
        participantCount: 2,
      });

      expect(aggregator.getAggregationStatus('round-1').collectedCount).toBe(1);

      aggregator.handleDropout('round-1', 'r1');

      expect(aggregator.getAggregationStatus('round-1').collectedCount).toBe(0);
      expect(aggregator.getAggregationStatus('round-1').droppedRobots).toContain('r1');
    });

    it('is idempotent for same robot', () => {
      aggregator.handleDropout('round-1', 'r1');
      aggregator.handleDropout('round-1', 'r1');
      const status = aggregator.getAggregationStatus('round-1');
      expect(status.droppedRobots.filter((id) => id === 'r1')).toHaveLength(1);
    });

    it('throws if round is already aggregated', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1]],
        participantCount: 1,
      });

      aggregator.aggregate('round-1', 1);

      expect(() => aggregator.handleDropout('round-1', 'r2')).toThrow(
        'already been aggregated',
      );
    });
  });

  // ─── getAggregationStatus ──────────────────────────────────────────

  describe('getAggregationStatus', () => {
    it('returns zero counts for unknown round', () => {
      const status = aggregator.getAggregationStatus('unknown');
      expect(status.collectedCount).toBe(0);
      expect(status.expectedCount).toBe(0);
      expect(status.submittedRobots).toEqual([]);
      expect(status.droppedRobots).toEqual([]);
      expect(status.aggregated).toBe(false);
    });

    it('tracks expected participant count from first update', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1]],
        participantCount: 5,
      });

      const status = aggregator.getAggregationStatus('round-1');
      expect(status.expectedCount).toBe(5);
    });

    it('reports aggregated=true after aggregation', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1]],
        participantCount: 1,
      });

      aggregator.aggregate('round-1', 1);

      expect(aggregator.getAggregationStatus('round-1').aggregated).toBe(true);
    });
  });

  // ─── getResult ──────────────────────────────────────────────────────

  describe('getResult', () => {
    it('returns null before aggregation', () => {
      expect(aggregator.getResult('round-1')).toBeNull();
    });

    it('returns result after aggregation', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1, 2]],
        participantCount: 1,
      });

      aggregator.aggregate('round-1', 1);
      const result = aggregator.getResult('round-1');
      expect(result).not.toBeNull();
      expect(result!.roundId).toBe('round-1');
    });
  });

  // ─── clearRound ─────────────────────────────────────────────────────

  describe('clearRound', () => {
    it('removes all state for a round', () => {
      aggregator.collectUpdate('round-1', 'r1', {
        robotId: 'r1',
        roundId: 'round-1',
        maskedGradients: [[1]],
        participantCount: 1,
      });

      aggregator.clearRound('round-1');

      const status = aggregator.getAggregationStatus('round-1');
      expect(status.collectedCount).toBe(0);
    });

    it('is safe to call on unknown round', () => {
      expect(() => aggregator.clearRound('nonexistent')).not.toThrow();
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// API Route Tests
// ════════════════════════════════════════════════════════════════════════════

describe('Aggregation Routes', () => {
  const app = createApp();

  describe('POST /api/federated/rounds/:roundId/submit', () => {
    it('accepts a valid masked update (201)', async () => {
      const res = await request(app)
        .post('/api/federated/rounds/test-round/submit')
        .send({
          robotId: 'route-test-r1',
          maskedGradients: [[1, 2], [3, 4]],
          participantCount: 2,
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('successfully');
    });

    it('rejects missing robotId (400)', async () => {
      const res = await request(app)
        .post('/api/federated/rounds/test-round/submit')
        .send({
          maskedGradients: [[1]],
          participantCount: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('robotId');
    });

    it('rejects missing maskedGradients (400)', async () => {
      const res = await request(app)
        .post('/api/federated/rounds/test-round/submit')
        .send({
          robotId: 'r1',
          participantCount: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('maskedGradients');
    });

    it('rejects invalid participantCount (400)', async () => {
      const res = await request(app)
        .post('/api/federated/rounds/test-round/submit')
        .send({
          robotId: 'r1',
          maskedGradients: [[1]],
          participantCount: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('participantCount');
    });
  });

  describe('GET /api/federated/rounds/:roundId/aggregation', () => {
    it('returns status for a round (200)', async () => {
      const res = await request(app)
        .get('/api/federated/rounds/status-round/aggregation');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('roundId', 'status-round');
      expect(res.body).toHaveProperty('collectedCount');
      expect(res.body).toHaveProperty('aggregated');
    });
  });

  describe('POST /api/federated/rounds/:roundId/aggregate', () => {
    it('rejects missing expectedParticipants (400)', async () => {
      const res = await request(app)
        .post('/api/federated/rounds/agg-round/aggregate')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('expectedParticipants');
    });

    it('rejects when no updates collected (400)', async () => {
      const res = await request(app)
        .post('/api/federated/rounds/empty-agg/aggregate')
        .send({ expectedParticipants: 3 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No updates');
    });
  });
});
