/**
 * @file useListingActs.ts
 * @description A seller's acts on their own listing — unpublish, publish
 *              again, delete — each behind a confirm that states the
 *              consequence and ending in a toast (TASK-272)
 * @feature marketplace
 */

import { useCallback } from 'react';
import { confirm, errorMessage, toast } from '@/shared/components/ui';
import { marketplaceApi } from '../api/marketplaceApi';
import type { MyMarketplaceListing } from '../types/marketplace.types';

export interface ListingActs {
  unpublish: (m: MyMarketplaceListing) => Promise<boolean>;
  publish: (m: MyMarketplaceListing) => Promise<boolean>;
  remove: (m: MyMarketplaceListing) => Promise<boolean>;
}

/**
 * @param onChanged called after every successful act, to reload the list
 */
export function useListingActs(onChanged: () => void): ListingActs {
  const unpublish = useCallback(
    async ({ listing }: MyMarketplaceListing) => {
      const ok = await confirm({
        title: `Unpublish ${listing.title}?`,
        description:
          'It leaves the marketplace, so nobody new can find or buy it. Buyers keep their licences and downloads. You can publish it again.',
        confirmLabel: 'Unpublish',
        tone: 'danger',
      });
      if (!ok) return false;
      try {
        await marketplaceApi.unpublishListing(listing.id);
        toast.success('Listing unpublished', { description: listing.title });
        onChanged();
        return true;
      } catch (err) {
        toast.error("Couldn't unpublish the listing", { description: errorMessage(err) });
        return false;
      }
    },
    [onChanged],
  );

  const publish = useCallback(
    async ({ listing }: MyMarketplaceListing) => {
      const ok = await confirm({
        title: `Publish ${listing.title}?`,
        description: 'It appears in the marketplace again and can be bought.',
        confirmLabel: 'Publish',
      });
      if (!ok) return false;
      try {
        await marketplaceApi.publishListing(listing.id);
        toast.success('Listing published', { description: listing.title });
        onChanged();
        return true;
      } catch (err) {
        toast.error("Couldn't publish the listing", { description: errorMessage(err) });
        return false;
      }
    },
    [onChanged],
  );

  const remove = useCallback(
    async ({ listing }: MyMarketplaceListing) => {
      const ok = await confirm({
        title: `Delete ${listing.title}?`,
        description:
          'The listing, its versions and its reviews are removed for good. If anyone holds a licence to it, the delete is refused — unpublish it instead.',
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      if (!ok) return false;
      try {
        await marketplaceApi.deleteListing(listing.id);
        toast.success('Listing deleted', { description: listing.title });
        onChanged();
        return true;
      } catch (err) {
        toast.error("Couldn't delete the listing", { description: errorMessage(err) });
        return false;
      }
    },
    [onChanged],
  );

  return { unpublish, publish, remove };
}
