/**
 * @file datasetVideoApi.test.ts
 * @description The episode video URL and the ticket it carries (TASK-478).
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { post, defaults: { baseURL: '/api' } } }));

import {
  clearDatasetVideoTickets,
  episodeVideoUrl,
  fetchDatasetVideoTicket,
  getDatasetVideoTicket,
} from '../datasetVideoApi';
import { trainingApi } from '../trainingApi';

const WINDOW = { chunk: 2, file: 5, from: 12.5, to: 20 };

describe('episodeVideoUrl', () => {
  it('is the bare route without a ticket, as before', () => {
    expect(episodeVideoUrl('/api', 'ds-1', 3, 'observation.images.ego_view')).toBe(
      '/api/datasets/ds-1/episodes/3/video/observation.images.ego_view'
    );
  });

  it('carries the ticket in the query string', () => {
    expect(episodeVideoUrl('/api', 'ds-1', 3, 'top', undefined, 'abc.def')).toBe(
      '/api/datasets/ds-1/episodes/3/video/top?ticket=abc.def'
    );
  });

  it('keeps a v3.0 window: chunk/file in the query, the slice in the fragment', () => {
    expect(episodeVideoUrl('/api', 'ds-1', 3, 'top', WINDOW)).toBe(
      '/api/datasets/ds-1/episodes/3/video/top?chunk=2&file=5#t=12.5,20'
    );
    // The ticket goes before the fragment — a browser never sends a fragment.
    expect(episodeVideoUrl('/api', 'ds-1', 3, 'top', WINDOW, 'abc.def')).toBe(
      '/api/datasets/ds-1/episodes/3/video/top?chunk=2&file=5&ticket=abc.def#t=12.5,20'
    );
  });

  it('escapes a ticket that would break the query', () => {
    expect(episodeVideoUrl('/api', 'ds-1', 0, 'top', undefined, 'a&b=c')).toContain('?ticket=a%26b%3Dc');
  });

  it('is what trainingApi.getEpisodeVideoUrl builds', () => {
    expect(trainingApi.getEpisodeVideoUrl('ds-1', 3, 'top', WINDOW, 'abc.def')).toBe(
      '/api/datasets/ds-1/episodes/3/video/top?chunk=2&file=5&ticket=abc.def#t=12.5,20'
    );
    expect(trainingApi.getEpisodeVideoUrl('ds-1', 3, 'top')).toBe('/api/datasets/ds-1/episodes/3/video/top');
  });
});

describe('dataset video tickets', () => {
  beforeEach(() => {
    post.mockReset();
    clearDatasetVideoTickets();
  });

  it('asks the server through the authenticated client', async () => {
    post.mockResolvedValue({ data: { ticket: 'tkt-1', expiresIn: 900 } });

    await expect(fetchDatasetVideoTicket('ds 1')).resolves.toEqual({ ticket: 'tkt-1', expiresIn: 900 });
    expect(post).toHaveBeenCalledWith('/datasets/ds%201/video-ticket');
  });

  it('reuses a ticket while it is fresh, so the video URL stays the same', async () => {
    post.mockResolvedValue({ data: { ticket: 'tkt-1', expiresIn: 900 } });

    expect(await getDatasetVideoTicket('ds-1')).toBe('tkt-1');
    expect(await getDatasetVideoTicket('ds-1')).toBe('tkt-1');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('shares one request between callers that ask at the same time', async () => {
    post.mockResolvedValue({ data: { ticket: 'tkt-1', expiresIn: 900 } });

    await Promise.all([getDatasetVideoTicket('ds-1'), getDatasetVideoTicket('ds-1')]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('fetches a new one once the ticket is half spent', async () => {
    post
      .mockResolvedValueOnce({ data: { ticket: 'tkt-1', expiresIn: 900 } })
      .mockResolvedValueOnce({ data: { ticket: 'tkt-2', expiresIn: 900 } });

    await getDatasetVideoTicket('ds-1');
    expect(await getDatasetVideoTicket('ds-1', { now: Date.now() + 449_000 })).toBe('tkt-1');
    expect(await getDatasetVideoTicket('ds-1', { now: Date.now() + 451_000 })).toBe('tkt-2');
  });

  it('fetches a new one when asked to, whatever the age', async () => {
    post
      .mockResolvedValueOnce({ data: { ticket: 'tkt-1', expiresIn: 900 } })
      .mockResolvedValueOnce({ data: { ticket: 'tkt-2', expiresIn: 900 } });

    await getDatasetVideoTicket('ds-1');
    expect(await getDatasetVideoTicket('ds-1', { fresh: true })).toBe('tkt-2');
  });

  it('keeps tickets per dataset', async () => {
    post.mockImplementation(async (url: string) => ({ data: { ticket: `tkt:${url}`, expiresIn: 900 } }));

    expect(await getDatasetVideoTicket('ds-1')).toBe('tkt:/datasets/ds-1/video-ticket');
    expect(await getDatasetVideoTicket('ds-2')).toBe('tkt:/datasets/ds-2/video-ticket');
  });

  it('does not remember a refusal', async () => {
    post.mockRejectedValueOnce(new Error('401')).mockResolvedValueOnce({ data: { ticket: 'tkt-2', expiresIn: 900 } });

    await expect(getDatasetVideoTicket('ds-1')).rejects.toThrow('401');
    expect(await getDatasetVideoTicket('ds-1')).toBe('tkt-2');
  });
});
