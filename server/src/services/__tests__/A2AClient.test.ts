/**
 * @file A2AClient.test.ts
 * @description Unit tests for A2AClient + AgentCardResolver — request construction,
 *              JSON-RPC handling, agent-card discovery, caching, error handling
 * @feature services
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosError } from 'axios';
import type { A2AAgentCard, A2AMessage } from '../../types/index.js';

// The A2AClient instance uses axios.create(); AgentCardResolver uses axios.get
// directly. Mock both, plus isAxiosError for error classification.
const mockInstance = {
  post: vi.fn(),
};
const directGet = vi.fn();
const isAxiosError = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockInstance),
    get: (...args: unknown[]) => directGet(...args),
    isAxiosError: (e: unknown) => isAxiosError(e),
  },
}));

import axios from 'axios';
import {
  A2AClient,
  AgentCardResolver,
  createA2AClient,
} from '../A2AClient.js';

const validCard: A2AAgentCard = {
  name: 'Robot Agent',
  description: 'A test agent',
  url: 'http://agent.local',
};

const sampleMessage: A2AMessage = {
  messageId: 'm-1',
  role: 'user',
  parts: [{ kind: 'text', text: 'hello' }],
};

function makeAxiosError(status?: number, message = 'fail'): AxiosError {
  return {
    message,
    response: status ? ({ status } as AxiosError['response']) : undefined,
  } as AxiosError;
}

describe('A2AClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAxiosError.mockReturnValue(false);
  });

  it('creates an axios instance with the card url, timeout and JSON header', () => {
    new A2AClient(validCard);
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: validCard.url,
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('getAgentCard returns the card it was constructed with', () => {
    const client = new A2AClient(validCard);
    expect(client.getAgentCard()).toBe(validCard);
  });

  describe('sendMessage', () => {
    it('posts a JSON-RPC 2.0 message/send envelope and returns the result', async () => {
      const taskResult = { id: 't-1', status: { state: 'completed' } };
      mockInstance.post.mockResolvedValue({ data: { jsonrpc: '2.0', id: 'x', result: taskResult } });

      const client = new A2AClient(validCard);
      const result = await client.sendMessage(sampleMessage);

      expect(result).toEqual(taskResult);
      expect(mockInstance.post).toHaveBeenCalledTimes(1);
      const [path, body] = mockInstance.post.mock.calls[0];
      expect(path).toBe('/');
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        method: 'message/send',
        params: sampleMessage,
      });
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
    });

    it('throws an Agent error when the response carries a JSON-RPC error', async () => {
      mockInstance.post.mockResolvedValue({
        data: { jsonrpc: '2.0', id: 'x', error: { code: -1, message: 'boom' } },
      });
      const client = new A2AClient(validCard);
      await expect(client.sendMessage(sampleMessage)).rejects.toThrow('Agent error: boom');
    });

    it('wraps axios errors with a "Failed to send message" prefix', async () => {
      isAxiosError.mockReturnValue(true);
      mockInstance.post.mockRejectedValue(makeAxiosError(undefined, 'network down'));
      const client = new A2AClient(validCard);
      await expect(client.sendMessage(sampleMessage)).rejects.toThrow(
        'Failed to send message: network down'
      );
    });

    it('re-throws non-axios errors unchanged', async () => {
      isAxiosError.mockReturnValue(false);
      mockInstance.post.mockRejectedValue(new Error('Agent error: passthrough'));
      const client = new A2AClient(validCard);
      await expect(client.sendMessage(sampleMessage)).rejects.toThrow('Agent error: passthrough');
    });
  });

  describe('sendMessageStreaming', () => {
    it('yields the task when the result looks like a task', async () => {
      const task = { id: 't-9', status: { state: 'working' } };
      mockInstance.post.mockResolvedValue({ data: { jsonrpc: '2.0', id: 'x', result: task } });
      const client = new A2AClient(validCard);

      const yielded: unknown[] = [];
      for await (const t of client.sendMessageStreaming(sampleMessage)) {
        yielded.push(t);
      }
      expect(yielded).toEqual([task]);
    });

    it('yields nothing when the result is not a task (no id/status)', async () => {
      const msg = { messageId: 'm-2', role: 'agent', parts: [] };
      mockInstance.post.mockResolvedValue({ data: { jsonrpc: '2.0', id: 'x', result: msg } });
      const client = new A2AClient(validCard);

      const yielded: unknown[] = [];
      for await (const t of client.sendMessageStreaming(sampleMessage)) {
        yielded.push(t);
      }
      expect(yielded).toEqual([]);
    });
  });
});

describe('AgentCardResolver', () => {
  let resolver: AgentCardResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    isAxiosError.mockReturnValue(false);
    resolver = new AgentCardResolver();
  });

  it('fetches the card from the first well-known path and normalizes trailing slash', async () => {
    directGet.mockResolvedValue({ data: validCard });
    const card = await resolver.fetchAgentCard('http://agent.local/');
    expect(card).toEqual(validCard);
    expect(directGet).toHaveBeenCalledTimes(1);
    expect(directGet).toHaveBeenCalledWith(
      'http://agent.local/.well-known/agent-card.json',
      { timeout: 10000 }
    );
  });

  it('falls through to the next path on 404 and succeeds there', async () => {
    isAxiosError.mockReturnValue(true);
    directGet
      .mockRejectedValueOnce(makeAxiosError(404))
      .mockResolvedValueOnce({ data: validCard });

    const card = await resolver.fetchAgentCard('http://agent.local');
    expect(card).toEqual(validCard);
    expect(directGet).toHaveBeenCalledTimes(2);
    expect(directGet.mock.calls[1][0]).toBe(
      'http://agent.local/.well-known/a2a/agent_card.json'
    );
  });

  it('rejects when the fetched card is missing required fields', async () => {
    // A card missing url -> validation throws -> recorded as lastError; the
    // same invalid body is returned for every path, so all 3 fail.
    directGet.mockResolvedValue({ data: { name: 'x', description: 'y' } });
    await expect(resolver.fetchAgentCard('http://bad.local')).rejects.toThrow(
      'Invalid agent card: missing required fields'
    );
    expect(directGet).toHaveBeenCalledTimes(3);
  });

  it('throws the last error when every path fails with a non-404 error', async () => {
    isAxiosError.mockReturnValue(true);
    directGet.mockRejectedValue(makeAxiosError(500, 'server error'));
    await expect(resolver.fetchAgentCard('http://down.local')).rejects.toThrow();
    expect(directGet).toHaveBeenCalledTimes(3);
  });

  it('caches the card and avoids a second network call', async () => {
    directGet.mockResolvedValue({ data: validCard });
    const url = 'http://agent.local';
    const first = await resolver.fetchAgentCard(url);
    const second = await resolver.fetchAgentCard(url);
    expect(first).toBe(second);
    expect(directGet).toHaveBeenCalledTimes(1);
  });

  it('clearCache(url) forces a refetch for that url only', async () => {
    directGet.mockResolvedValue({ data: validCard });
    await resolver.fetchAgentCard('http://a.local');
    resolver.clearCache('http://a.local');
    await resolver.fetchAgentCard('http://a.local');
    expect(directGet).toHaveBeenCalledTimes(2);
  });

  it('clearCache() with no arg clears all cached cards', async () => {
    directGet.mockResolvedValue({ data: validCard });
    await resolver.fetchAgentCard('http://a.local');
    await resolver.fetchAgentCard('http://b.local');
    resolver.clearCache();
    await resolver.fetchAgentCard('http://a.local');
    // a.local: 2 (before+after clear), b.local: 1 => 3 total
    expect(directGet).toHaveBeenCalledTimes(3);
  });
});

describe('createA2AClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAxiosError.mockReturnValue(false);
  });

  it('resolves the card and returns a configured A2AClient', async () => {
    directGet.mockResolvedValue({ data: validCard });
    const client = await createA2AClient('http://agent.local');
    expect(client).toBeInstanceOf(A2AClient);
    expect(client.getAgentCard()).toEqual(validCard);
  });
});
