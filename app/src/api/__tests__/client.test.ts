/**
 * @file client.test.ts
 * @description Real-seam tests for the api client's rejection contract. Nothing
 *              at the broken boundary is mocked: msw answers the HTTP request,
 *              axios and both interceptors run for real.
 * @feature api
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { apiClient, createApiClient, ApiRequestError } from '../client';

const BASE = 'http://api.test/api';
const client = createApiClient({ baseURL: BASE, timeout: 5000 });

/** Capture the rejection of a call that must fail. */
async function rejectionOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error('expected the request to reject');
}

describe('api client error contract', () => {
  it('rejects with an Error that still exposes the ApiError fields', async () => {
    server.use(
      http.post(`${BASE}/safety/robots/r1/estop`, () =>
        HttpResponse.json({ error: 'Robot r1 is not connected' }, { status: 503 })
      )
    );

    const err = await rejectionOf(() => client.post('/safety/robots/r1/estop', {}));

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiRequestError);
    const apiError = err as ApiRequestError;
    expect(apiError.message).toBe('Robot r1 is not connected');
    expect(apiError.statusCode).toBe(503);
    expect(apiError.code).toBe('UNKNOWN_ERROR');
    // Own properties, not prototype accessors — the sweep reads them directly.
    expect(Object.prototype.hasOwnProperty.call(apiError, 'code')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(apiError, 'statusCode')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(apiError, 'message')).toBe(true);
  });

  it('carries the server sentence through the default apiClient too', async () => {
    // The default instance resolves '/api' against the jsdom origin.
    server.use(
      http.post('/api/safety/robots/r1/estop', () =>
        HttpResponse.json({ error: 'Robot r1 is not connected' }, { status: 503 })
      )
    );

    const err = await rejectionOf(() => apiClient.post('/safety/robots/r1/estop', {}));

    expect(err).toBeInstanceOf(Error);
    expect((err as ApiRequestError).message).toBe('Robot r1 is not connected');
    expect((err as ApiRequestError).statusCode).toBe(503);
  });

  describe('message resolution order', () => {
    it('prefers `message` over `error` and keeps the server code and details', async () => {
      server.use(
        http.get(`${BASE}/thing`, () =>
          HttpResponse.json(
            {
              error: 'validation_failed',
              message: 'Zone id is required',
              code: 'VALIDATION_ERROR',
              details: { field: 'zoneId' },
            },
            { status: 400 }
          )
        )
      );

      const err = (await rejectionOf(() => client.get('/thing'))) as ApiRequestError;

      expect(err.message).toBe('Zone id is required');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toEqual({ field: 'zoneId' });
      expect(err.statusCode).toBe(400);
    });

    it('falls back to a string `error` when there is no `message`', async () => {
      server.use(
        http.get(`${BASE}/thing`, () =>
          HttpResponse.json({ error: 'Tenant not found' }, { status: 404 })
        )
      );

      const err = (await rejectionOf(() => client.get('/thing'))) as ApiRequestError;

      expect(err.message).toBe('Tenant not found');
      expect(err.code).toBe('UNKNOWN_ERROR');
      expect(err.statusCode).toBe(404);
    });

    it('falls back to the axios message when the body carries neither', async () => {
      server.use(
        http.get(`${BASE}/thing`, () => HttpResponse.json({ other: true }, { status: 500 }))
      );

      const err = (await rejectionOf(() => client.get('/thing'))) as ApiRequestError;

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Request failed with status code 500');
      expect(err.statusCode).toBe(500);
    });
  });

  it('reports an unreachable server as a NETWORK_ERROR with status 0', async () => {
    server.use(http.get(`${BASE}/thing`, () => HttpResponse.error()));

    const err = (await rejectionOf(() => client.get('/thing'))) as ApiRequestError;

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.statusCode).toBe(0);
  });

  it('stays readable through the shared helpers', async () => {
    const { getErrorMessage, getErrorStatus, isNotFoundError } = await import(
      '@/shared/utils/error'
    );
    const { errorMessage } = await import('@/shared/components/ui/errorMessage');

    server.use(
      http.get(`${BASE}/thing`, () =>
        HttpResponse.json({ error: 'Robot r1 is not connected' }, { status: 404 })
      )
    );

    const err = await rejectionOf(() => client.get('/thing'));

    expect(getErrorMessage(err, 'fallback')).toBe('Robot r1 is not connected');
    expect(errorMessage(err, 'fallback')).toBe('Robot r1 is not connected');
    expect(getErrorStatus(err)).toBe(404);
    expect(isNotFoundError(err)).toBe(true);
  });
});
