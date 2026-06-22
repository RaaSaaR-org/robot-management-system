/**
 * @file HttpClient.test.ts
 * @description Unit tests for HttpClient — request construction, response parsing, error mapping
 * @feature services
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosError } from 'axios';

// Mock the axios module. HttpClient calls axios.create() once in the
// constructor AND module-load creates a singleton (httpClient), so the mock
// factory must be self-contained (no outer references — those aren't yet
// initialized at hoist time). We pull the spies back out after import.
vi.mock('axios', () => {
  const inst = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  const isAxiosErrorFn = vi.fn();
  return {
    default: {
      create: vi.fn(() => inst),
      isAxiosError: isAxiosErrorFn,
      // expose internals for the tests
      __inst: inst,
    },
  };
});

import axios from 'axios';
import { HttpClient, HttpClientError, HTTP_TIMEOUTS, createRobotHttpClient } from '../HttpClient.js';

const axiosMock = axios as unknown as {
  create: ReturnType<typeof vi.fn>;
  isAxiosError: ReturnType<typeof vi.fn>;
  __inst: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};
const mockInstance = axiosMock.__inst;
const isAxiosError = axiosMock.isAxiosError;

/** Build a minimal AxiosError-like object */
function makeAxiosError(opts: {
  code?: string;
  message?: string;
  status?: number;
  data?: unknown;
}): AxiosError {
  return {
    code: opts.code,
    message: opts.message ?? 'axios failure',
    response: opts.status
      ? ({ status: opts.status, data: opts.data } as AxiosError['response'])
      : undefined,
  } as AxiosError;
}

describe('HttpClient', () => {
  let client: HttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    isAxiosError.mockReturnValue(false);
    client = new HttpClient('http://robot.local', HTTP_TIMEOUTS.SHORT);
  });

  describe('construction', () => {
    it('creates an axios instance with baseURL, timeout and JSON header', () => {
      // The constructor in beforeEach already called create()
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://robot.local',
          timeout: HTTP_TIMEOUTS.SHORT,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });

  describe('get', () => {
    it('returns response.data and forwards default timeout + params', async () => {
      mockInstance.get.mockResolvedValue({ data: { ok: true } });
      const result = await client.get<{ ok: boolean }>('/status', {
        params: { id: 5 },
      });
      expect(result).toEqual({ ok: true });
      expect(mockInstance.get).toHaveBeenCalledWith('/status', {
        timeout: HTTP_TIMEOUTS.SHORT,
        params: { id: 5 },
      });
    });

    it('uses a per-request timeout override when provided', async () => {
      mockInstance.get.mockResolvedValue({ data: 'x' });
      await client.get('/slow', { timeout: 1234 });
      expect(mockInstance.get).toHaveBeenCalledWith(
        '/slow',
        expect.objectContaining({ timeout: 1234 })
      );
    });
  });

  describe('post / put / delete', () => {
    it('post sends body and returns data', async () => {
      mockInstance.post.mockResolvedValue({ data: { created: 1 } });
      const result = await client.post<{ created: number }>('/cmd', { a: 1 });
      expect(result).toEqual({ created: 1 });
      expect(mockInstance.post).toHaveBeenCalledWith(
        '/cmd',
        { a: 1 },
        { timeout: HTTP_TIMEOUTS.SHORT }
      );
    });

    it('put sends body and honors timeout override', async () => {
      mockInstance.put.mockResolvedValue({ data: 'done' });
      const result = await client.put('/res/1', { name: 'n' }, { timeout: 99 });
      expect(result).toBe('done');
      expect(mockInstance.put).toHaveBeenCalledWith(
        '/res/1',
        { name: 'n' },
        { timeout: 99 }
      );
    });

    it('delete returns data with default timeout', async () => {
      mockInstance.delete.mockResolvedValue({ data: { deleted: true } });
      const result = await client.delete<{ deleted: boolean }>('/res/1');
      expect(result).toEqual({ deleted: true });
      expect(mockInstance.delete).toHaveBeenCalledWith('/res/1', {
        timeout: HTTP_TIMEOUTS.SHORT,
      });
    });
  });

  describe('error mapping', () => {
    it('maps ECONNABORTED to a timeout HttpClientError', async () => {
      isAxiosError.mockReturnValue(true);
      mockInstance.get.mockRejectedValue(makeAxiosError({ code: 'ECONNABORTED' }));
      await expect(client.get('/x')).rejects.toMatchObject({
        name: 'HttpClientError',
        url: '/x',
      });
      try {
        await client.get('/x');
      } catch (e) {
        const err = e as HttpClientError;
        expect(err.isTimeout()).toBe(true);
        expect(err.message).toContain('Request timeout');
      }
    });

    it('maps ECONNREFUSED to a connection-refused HttpClientError', async () => {
      isAxiosError.mockReturnValue(true);
      mockInstance.post.mockRejectedValue(makeAxiosError({ code: 'ECONNREFUSED' }));
      try {
        await client.post('/x', {});
        throw new Error('should have thrown');
      } catch (e) {
        const err = e as HttpClientError;
        expect(err).toBeInstanceOf(HttpClientError);
        expect(err.message).toContain('Connection refused');
        expect(err.url).toBe('/x');
        expect(err.isConnectionRefused()).toBe(true);
        expect(err.isNetworkError()).toBe(true);
      }
    });

    it('maps an HTTP status response into statusCode and serialized data', async () => {
      isAxiosError.mockReturnValue(true);
      mockInstance.get.mockRejectedValue(
        makeAxiosError({ status: 422, data: { error: 'bad' } })
      );
      try {
        await client.get('/v');
        throw new Error('should have thrown');
      } catch (e) {
        const err = e as HttpClientError;
        expect(err.statusCode).toBe(422);
        expect(err.message).toContain('HTTP 422');
        expect(err.message).toContain('"error":"bad"');
      }
    });

    it('falls back to axios message when no status and no recognized code', async () => {
      isAxiosError.mockReturnValue(true);
      mockInstance.delete.mockRejectedValue(
        makeAxiosError({ message: 'weird network thing' })
      );
      try {
        await client.delete('/z');
        throw new Error('should have thrown');
      } catch (e) {
        const err = e as HttpClientError;
        expect(err.statusCode).toBeUndefined();
        expect(err.message).toBe('weird network thing');
      }
    });

    it('wraps a plain Error (non-axios) preserving its message', async () => {
      isAxiosError.mockReturnValue(false);
      mockInstance.get.mockRejectedValue(new Error('boom'));
      try {
        await client.get('/p');
        throw new Error('should have thrown');
      } catch (e) {
        const err = e as HttpClientError;
        expect(err).toBeInstanceOf(HttpClientError);
        expect(err.message).toBe('boom');
        expect(err.url).toBe('/p');
      }
    });

    it('wraps an unknown thrown value as "Unknown error"', async () => {
      isAxiosError.mockReturnValue(false);
      mockInstance.post.mockRejectedValue('a string error');
      try {
        await client.post('/q', {});
        throw new Error('should have thrown');
      } catch (e) {
        const err = e as HttpClientError;
        expect(err.message).toBe('Unknown error');
      }
    });
  });

  describe('HttpClientError helpers', () => {
    it('isNetworkError is true for timeout or connection-refused messages', () => {
      expect(new HttpClientError('ETIMEDOUT happened').isNetworkError()).toBe(true);
      expect(new HttpClientError('ECONNREFUSED happened').isNetworkError()).toBe(true);
      expect(new HttpClientError('HTTP 500: nope').isNetworkError()).toBe(false);
    });
  });

  describe('createRobotHttpClient', () => {
    it('returns an HttpClient instance', () => {
      const c = createRobotHttpClient('http://robot:41243');
      expect(c).toBeInstanceOf(HttpClient);
    });
  });
});
