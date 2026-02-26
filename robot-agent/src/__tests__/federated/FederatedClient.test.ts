/**
 * @file FederatedClient.test.ts
 * @description Unit tests for the FederatedClient HTTP client
 * @feature Federated Learning
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FederatedClient } from '../../federated/FederatedClient.js';
import type { FederatedRound } from '../../federated/types.js';

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

describe('FederatedClient', () => {
  let client: FederatedClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new FederatedClient('http://localhost:3001', 'robot-001', 5000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getOpenRounds', () => {
    it('fetches open rounds from the server', async () => {
      const rounds = [createMockRound()];
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ rounds }),
      });

      const result = await client.getOpenRounds();

      expect(result).toEqual(rounds);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3001/api/federated/rounds?status=open',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-Robot-Id': 'robot-001',
          }),
        }),
      );
    });

    it('returns empty array when no rounds available', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ rounds: [] }),
      });

      const result = await client.getOpenRounds();
      expect(result).toEqual([]);
    });
  });

  describe('joinRound', () => {
    it('posts join request with robot ID', async () => {
      const response = { success: true, participantId: 'p-001', message: 'Joined' };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => response,
      });

      const result = await client.joinRound('round-001');

      expect(result).toEqual(response);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3001/api/federated/rounds/round-001/join',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ robotId: 'robot-001' }),
        }),
      );
    });
  });

  describe('uploadGradients', () => {
    it('uploads gradients with metadata', async () => {
      const response = { success: true, message: 'Received', receivedAt: '2026-02-26T10:05:00Z' };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => response,
      });

      const gradients = [[0.1, 0.2], [0.3, 0.4]];
      const metadata = { loss: 0.5, steps: 100, duration_ms: 5000 };

      const result = await client.uploadGradients('round-001', gradients, metadata);

      expect(result).toEqual(response);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3001/api/federated/rounds/round-001/gradients',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            robotId: 'robot-001',
            gradients,
            metadata,
          }),
        }),
      );
    });
  });

  describe('downloadGlobalModel', () => {
    it('fetches the aggregated model URI', async () => {
      const response = {
        success: true,
        modelUri: 's3://models/global-v1.bin',
        roundNumber: 1,
        aggregatedFrom: 5,
      };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => response,
      });

      const result = await client.downloadGlobalModel('round-001');

      expect(result).toEqual(response);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3001/api/federated/rounds/round-001/model',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('getRoundStatus', () => {
    it('returns round metadata', async () => {
      const round = createMockRound({ status: 'training' });
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => round,
      });

      const result = await client.getRoundStatus('round-001');

      expect(result.status).toBe('training');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3001/api/federated/rounds/round-001',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('error handling', () => {
    it('throws on non-OK response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Round not found',
      });

      await expect(client.getRoundStatus('nonexistent')).rejects.toThrow(
        'Federated API error: 404 Not Found',
      );
    });

    it('throws on timeout', async () => {
      fetchMock.mockImplementation(
        (_url: string, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      );

      // Client was created with 5000ms timeout — use a shorter one for test
      const fastClient = new FederatedClient('http://localhost:3001', 'robot-001', 50);
      await expect(fastClient.getOpenRounds()).rejects.toThrow('Federated API timeout');
    });
  });
});
