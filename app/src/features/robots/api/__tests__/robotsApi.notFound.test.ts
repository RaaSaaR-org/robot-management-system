/**
 * @file robotsApi.notFound.test.ts
 * @description A 404 from apiClient reads as "nothing here", not a failure (TASK-388).
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, apiClient: { get: (...a: unknown[]) => get(...a) } };
});

import { ApiRequestError } from '@/api/client';
import { robotsApi } from '../robotsApi';

// What apiClient's interceptor really rejects with: `statusCode`, no `response`.
const apiError = (statusCode: number) =>
  new ApiRequestError({ code: 'X', message: `status ${statusCode}`, statusCode });

describe('robotsApi on a 404', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('reads a missing frame registration as none', async () => {
    get.mockImplementation(() => Promise.reject(apiError(404)));
    await expect(robotsApi.getFrameRegistration('r1')).resolves.toBeNull();
  });

  it('reads a robot without a site as having no places', async () => {
    get.mockImplementation(() => Promise.reject(apiError(404)));
    await expect(robotsApi.getSitePlaces('r1')).resolves.toEqual([]);
  });

  it('still throws on any other failure', async () => {
    get.mockImplementation(() => Promise.reject(apiError(500)));
    await expect(robotsApi.getFrameRegistration('r1')).rejects.toBeInstanceOf(ApiRequestError);
    await expect(robotsApi.getSitePlaces('r1')).rejects.toBeInstanceOf(ApiRequestError);
  });
});
