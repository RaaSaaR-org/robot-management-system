/**
 * @file useListingActs.test.ts
 * @description A seller's unpublish / publish / delete acts: each confirms
 *              with the consequence, calls the route, toasts and reloads; a
 *              refused delete toasts the server's reason (TASK-272)
 * @feature marketplace
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { confirm, toast } from '@/shared/components/ui';
import { marketplaceApi } from '../../api/marketplaceApi';
import { useListingActs } from '../useListingActs';
import type { MyMarketplaceListing } from '../../types/marketplace.types';

vi.mock('@/shared/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/components/ui')>();
  return {
    ...actual,
    confirm: vi.fn(),
    toast: { ...actual.toast, success: vi.fn(), error: vi.fn() },
  };
});

vi.mock('../../api/marketplaceApi', () => ({
  marketplaceApi: {
    unpublishListing: vi.fn(),
    publishListing: vi.fn(),
    deleteListing: vi.fn(),
  },
}));

const mine = {
  listing: { id: 'lst-1', title: 'Apple to plate' },
  totalRevenue: 0,
  totalDownloads: 0,
  status: 'active',
} as unknown as MyMarketplaceListing;

function acts() {
  const onChanged = vi.fn();
  const { result } = renderHook(() => useListingActs(onChanged));
  return { acts: result.current, onChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(confirm).mockResolvedValue(true);
});

describe('useListingActs', () => {
  it('unpublishes through a danger confirm, toasts and reloads', async () => {
    const { acts: a, onChanged } = acts();

    expect(await a.unpublish(mine)).toBe(true);

    expect(vi.mocked(confirm).mock.calls[0][0]).toMatchObject({ confirmLabel: 'Unpublish', tone: 'danger' });
    expect(String(vi.mocked(confirm).mock.calls[0][0].description)).toContain('Buyers keep their licences');
    expect(marketplaceApi.unpublishListing).toHaveBeenCalledWith('lst-1');
    expect(toast.success).toHaveBeenCalledWith('Listing unpublished', { description: 'Apple to plate' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('publishes a draft again', async () => {
    const { acts: a } = acts();

    expect(await a.publish({ ...mine, status: 'draft' })).toBe(true);
    expect(marketplaceApi.publishListing).toHaveBeenCalledWith('lst-1');
  });

  it('deletes through a "Delete ‹name›?" confirm', async () => {
    const { acts: a, onChanged } = acts();

    expect(await a.remove(mine)).toBe(true);

    expect(vi.mocked(confirm).mock.calls[0][0]).toMatchObject({
      title: 'Delete Apple to plate?',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    expect(marketplaceApi.deleteListing).toHaveBeenCalledWith('lst-1');
    expect(onChanged).toHaveBeenCalled();
  });

  it("toasts the server's reason when a delete is refused, and does not reload", async () => {
    vi.mocked(marketplaceApi.deleteListing).mockRejectedValue({
      message: '1 buyer(s) hold a licence to this listing — unpublish it instead',
    });
    const { acts: a, onChanged } = acts();

    expect(await a.remove(mine)).toBe(false);

    expect(toast.error).toHaveBeenCalledWith("Couldn't delete the listing", {
      description: '1 buyer(s) hold a licence to this listing — unpublish it instead',
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('does nothing when the confirm is declined', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const { acts: a } = acts();

    expect(await a.remove(mine)).toBe(false);
    expect(marketplaceApi.deleteListing).not.toHaveBeenCalled();
  });
});
