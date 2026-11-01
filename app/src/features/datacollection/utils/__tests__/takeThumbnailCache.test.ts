/**
 * @file takeThumbnailCache.test.ts
 * @description One fetch per take, and forgetting a take drops its entry and
 *              revokes its blob URL so a reused take number fetches afresh.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../api/datacollectionApi', () => ({
  datacollectionApi: { fetchThumbnail: vi.fn() },
}));

import { datacollectionApi } from '../../api/datacollectionApi';
import { forgetThumbnail, loadThumbnail } from '../takeThumbnailCache';

const fetchThumbnail = vi.mocked(datacollectionApi.fetchThumbnail);

describe('takeThumbnailCache', () => {
  let n = 0;
  const create = vi.fn(() => `blob:t${++n}`);
  const revoke = vi.fn();

  beforeEach(() => {
    fetchThumbnail.mockReset();
    fetchThumbnail.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    create.mockClear();
    revoke.mockClear();
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: create, revokeObjectURL: revoke }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a take once, however many rows ask for it', async () => {
    const [a, b] = await Promise.all([loadThumbnail('s-once', 0), loadThumbnail('s-once', 0)]);
    expect(a).toBe(b);
    expect(fetchThumbnail).toHaveBeenCalledTimes(1);
  });

  it('forgetting a take revokes its blob URL and the next load fetches again', async () => {
    const first = await loadThumbnail('s-forget', 3);
    forgetThumbnail('s-forget', 3);
    await Promise.resolve();
    expect(revoke).toHaveBeenCalledWith(first);
    const second = await loadThumbnail('s-forget', 3);
    expect(second).not.toBe(first);
    expect(fetchThumbnail).toHaveBeenCalledTimes(2);
  });

  it('forgetting a take with no thumbnail, or one never loaded, revokes nothing', async () => {
    fetchThumbnail.mockResolvedValue(null);
    await loadThumbnail('s-none', 1);
    forgetThumbnail('s-none', 1);
    forgetThumbnail('s-none', 9);
    await Promise.resolve();
    expect(revoke).not.toHaveBeenCalled();
  });
});
