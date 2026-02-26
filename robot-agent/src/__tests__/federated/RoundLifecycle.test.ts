/**
 * @file RoundLifecycle.test.ts
 * @description Unit tests for the federated learning round lifecycle orchestrator
 * @feature Federated Learning
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RoundLifecycle } from '../../federated/RoundLifecycle.js';
import type { FederatedRound, TrainingEpisode, FederatedEvent } from '../../federated/types.js';

function createMockRound(overrides: Partial<FederatedRound> = {}): FederatedRound {
  return {
    id: 'round-001',
    roundNumber: 1,
    status: 'open',
    loraConfig: {
      rank: 8,
      alpha: 16,
      targetModules: ['q_proj', 'v_proj'],
      epochs: 3,
      learningRate: 1e-4,
    },
    minParticipants: 3,
    currentParticipants: 1,
    dpConfig: {
      maxNorm: 1.0,
      epsilon: 1.0,
      delta: 1e-5,
    },
    createdAt: '2026-02-26T10:00:00Z',
    ...overrides,
  };
}

function createMockEpisode(): TrainingEpisode {
  return {
    id: 'ep-001',
    instruction: 'Pick up block',
    observations: ['frame1.jpg'],
    actions: [[0.1, 0.2]],
    timestamp: '2026-02-26T10:00:00Z',
  };
}

// Mock fetch for all HTTP interactions
let fetchMock: ReturnType<typeof vi.fn>;

describe('RoundLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createLifecycle(
    getLocalEpisodes?: () => Promise<TrainingEpisode[]>,
  ): RoundLifecycle {
    return new RoundLifecycle({
      serverUrl: 'http://localhost:3001',
      robotId: 'robot-001',
      pollIntervalMs: 30000,
      trainingBridgePort: 8766,
      getLocalEpisodes: getLocalEpisodes ?? (async () => [createMockEpisode()]),
    });
  }

  function setupSuccessfulRound(): void {
    // Mock sequence: getOpenRounds → joinRound → train → uploadGradients → downloadModel
    fetchMock
      // getOpenRounds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rounds: [createMockRound()] }),
      })
      // joinRound
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, participantId: 'p-001', message: 'Joined' }),
      })
      // train (LocalTrainer calls the bridge)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gradients: [[0.01, 0.02], [0.03, 0.04]],
          loss: 0.35,
          steps: 3,
          duration_ms: 1000,
        }),
      })
      // uploadGradients
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Received', receivedAt: '2026-02-26T10:05:00Z' }),
      })
      // downloadGlobalModel
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          modelUri: 's3://models/global-v1.bin',
          roundNumber: 1,
          aggregatedFrom: 5,
        }),
      });
  }

  describe('getStatus', () => {
    it('returns idle status when not started', () => {
      const lifecycle = createLifecycle();
      const status = lifecycle.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.running).toBe(false);
      expect(status.phase).toBe('idle');
      expect(status.currentRoundId).toBeNull();
      expect(status.roundsParticipated).toBe(0);
    });

    it('returns waiting status after start', () => {
      const lifecycle = createLifecycle();

      // Mock initial poll returning no rounds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rounds: [] }),
      });

      lifecycle.start();
      const status = lifecycle.getStatus();

      expect(status.running).toBe(true);
      expect(status.phase).toBe('waiting');

      lifecycle.stop();
    });
  });

  describe('start/stop', () => {
    it('starts polling and stops cleanly', () => {
      const lifecycle = createLifecycle();

      // Mock the initial poll
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ rounds: [] }),
      });

      lifecycle.start();
      expect(lifecycle.getStatus().running).toBe(true);

      lifecycle.stop();
      expect(lifecycle.getStatus().running).toBe(false);
      expect(lifecycle.getStatus().phase).toBe('idle');
    });

    it('does not double-start', () => {
      const lifecycle = createLifecycle();

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ rounds: [] }),
      });

      lifecycle.start();
      lifecycle.start(); // Should be no-op

      lifecycle.stop();
    });
  });

  describe('onEvent', () => {
    it('emits round-started event when participating', async () => {
      setupSuccessfulRound();
      const lifecycle = createLifecycle();
      const events: FederatedEvent[] = [];

      lifecycle.onEvent((event) => events.push(event));
      lifecycle.start();

      // Wait for async operations to complete
      await vi.advanceTimersByTimeAsync(100);

      expect(events.some((e) => e.type === 'round-started')).toBe(true);

      lifecycle.stop();
    });

    it('emits all lifecycle events on successful round', async () => {
      setupSuccessfulRound();
      const lifecycle = createLifecycle();
      const eventTypes: string[] = [];

      lifecycle.onEvent((event) => eventTypes.push(event.type));
      lifecycle.start();

      await vi.advanceTimersByTimeAsync(500);

      expect(eventTypes).toContain('round-started');
      expect(eventTypes).toContain('training-complete');
      expect(eventTypes).toContain('gradients-uploaded');
      expect(eventTypes).toContain('model-updated');

      lifecycle.stop();
    });

    it('returns unsubscribe function', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ rounds: [] }),
      });

      const lifecycle = createLifecycle();
      const events: FederatedEvent[] = [];

      const unsubscribe = lifecycle.onEvent((event) => events.push(event));
      unsubscribe();

      lifecycle.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(events).toHaveLength(0);

      lifecycle.stop();
    });
  });

  describe('round participation', () => {
    it('skips round when no local episodes available', async () => {
      // getOpenRounds returns a round
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ rounds: [createMockRound()] }),
        })
        // joinRound
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, participantId: 'p-001', message: 'Joined' }),
        });

      const lifecycle = createLifecycle(async () => []);
      lifecycle.start();

      await vi.advanceTimersByTimeAsync(100);

      // Should go back to waiting (no training happened)
      expect(lifecycle.getStatus().phase).toBe('waiting');

      lifecycle.stop();
    });

    it('increments roundsParticipated on success', async () => {
      setupSuccessfulRound();
      const lifecycle = createLifecycle();

      lifecycle.start();
      await vi.advanceTimersByTimeAsync(500);

      expect(lifecycle.getStatus().roundsParticipated).toBe(1);
      expect(lifecycle.getStatus().lastParticipation).not.toBeNull();

      lifecycle.stop();
    });

    it('handles training bridge errors gracefully', async () => {
      // getOpenRounds
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ rounds: [createMockRound()] }),
        })
        // joinRound
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, participantId: 'p-001', message: 'Joined' }),
        })
        // train fails
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'OOM',
        });

      const lifecycle = createLifecycle();
      const errors: FederatedEvent[] = [];
      lifecycle.onEvent((e) => { if (e.type === 'round-error') errors.push(e); });

      lifecycle.start();
      await vi.advanceTimersByTimeAsync(500);

      expect(errors).toHaveLength(1);
      expect(lifecycle.getStatus().lastError).toBeTruthy();

      lifecycle.stop();
    });

    it('recovers from error state after timeout', async () => {
      // getOpenRounds
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ rounds: [createMockRound()] }),
        })
        // joinRound
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, participantId: 'p-001', message: 'Joined' }),
        })
        // train fails
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'OOM',
        });

      const lifecycle = createLifecycle();
      lifecycle.start();

      await vi.advanceTimersByTimeAsync(500);
      expect(lifecycle.getStatus().phase).toBe('error');

      // Wait for error recovery timeout (5s)
      await vi.advanceTimersByTimeAsync(6000);
      expect(lifecycle.getStatus().phase).toBe('waiting');

      lifecycle.stop();
    });
  });
});
