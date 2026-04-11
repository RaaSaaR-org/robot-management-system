/**
 * @file LocalTrainer.test.ts
 * @description Unit tests for the LocalTrainer training bridge client
 * @feature Federated Learning
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalTrainer } from '../../federated/LocalTrainer.js';
import type { LoRAConfig, TrainingEpisode } from '../../federated/types.js';

function createMockEpisode(overrides: Partial<TrainingEpisode> = {}): TrainingEpisode {
  return {
    id: `ep-${Math.random().toString(36).slice(2, 8)}`,
    instruction: 'Pick up the red block',
    observations: ['frame001.jpg', 'frame002.jpg'],
    actions: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
    reward: 1.0,
    timestamp: '2026-02-26T10:00:00Z',
    ...overrides,
  };
}

const defaultLoRAConfig: LoRAConfig = {
  rank: 8,
  alpha: 16,
  targetModules: ['q_proj', 'v_proj'],
  epochs: 3,
  learningRate: 1e-4,
};

describe('LocalTrainer', () => {
  let trainer: LocalTrainer;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    trainer = new LocalTrainer(8766, 5000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('train', () => {
    it('sends correct request to training bridge', async () => {
      const episodes = [createMockEpisode()];
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          gradients: [[0.01, 0.02]],
          loss: 0.5,
          steps: 3,
          duration_ms: 1000,
        }),
      });

      await trainer.train(episodes, defaultLoRAConfig);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8766/train',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      // Verify the body was serialized correctly
      const callArgs = fetchMock.mock.calls[0][1] as { body: string };
      const body = JSON.parse(callArgs.body);
      expect(body.episodes).toHaveLength(1);
      expect(body.lora_config.rank).toBe(8);
      expect(body.lora_config.alpha).toBe(16);
      expect(body.lora_config.target_modules).toEqual(['q_proj', 'v_proj']);
      expect(body.lora_config.epochs).toBe(3);
      expect(body.lora_config.learning_rate).toBe(1e-4);
    });

    it('returns training result from bridge', async () => {
      const expected = {
        gradients: [[0.01, 0.02], [0.03, 0.04]],
        loss: 0.35,
        steps: 15,
        duration_ms: 2500,
      };
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => expected,
      });

      const result = await trainer.train([createMockEpisode()], defaultLoRAConfig);

      expect(result.gradients).toEqual(expected.gradients);
      expect(result.loss).toBe(0.35);
      expect(result.steps).toBe(15);
      expect(result.duration_ms).toBe(2500);
    });

    it('throws on empty dataset', async () => {
      await expect(trainer.train([], defaultLoRAConfig)).rejects.toThrow(
        'Dataset must contain at least one episode',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws on bridge error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Training failed: OOM',
      });

      await expect(
        trainer.train([createMockEpisode()], defaultLoRAConfig),
      ).rejects.toThrow('Training bridge error: 500');
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

      const fastTrainer = new LocalTrainer(8766, 50);
      await expect(
        fastTrainer.train([createMockEpisode()], defaultLoRAConfig),
      ).rejects.toThrow('Training bridge timeout');
    });
  });

  describe('isAvailable', () => {
    it('returns true when bridge responds', async () => {
      fetchMock.mockResolvedValue({ ok: true });

      const available = await trainer.isAvailable();

      expect(available).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8766/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns false when bridge is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const available = await trainer.isAvailable();
      expect(available).toBe(false);
    });

    it('returns false on non-OK response', async () => {
      fetchMock.mockResolvedValue({ ok: false });

      const available = await trainer.isAvailable();
      expect(available).toBe(false);
    });
  });
});
