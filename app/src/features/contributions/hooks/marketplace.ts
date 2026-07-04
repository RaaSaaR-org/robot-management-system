/**
 * @file marketplace.ts
 * @description React hooks for the Skill & Data Marketplace
 * @feature marketplace
 * @dependencies @/features/contributions/store, @/features/contributions/api
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useMarketplaceStore,
  selectMarketplaceListings,
  selectCurrentListing,
  selectMyPurchases,
  selectMyListings,
  selectMarketplaceCreditBalance,
  selectIsLoadingListings,
  selectIsLoadingDetail,
  selectIsLoadingMy,
  selectIsPurchasing,
  selectIsSubmittingReview,
  selectIsCreatingListing,
  selectMarketplaceError,
  selectPurchaseError,
} from '../store/marketplaceStore';
import { marketplaceApi } from '../api/marketplaceApi';
import type {
  MarketplaceListing,
  MarketplacePurchase,
  MyMarketplaceListing,
  MarketplaceLicenseTier,
  MarketplaceDownloadInfo,
  CreateListingInput,
  SubmitReviewInput,
} from '../types/marketplace.types';

// ============================================================================
// RETURN TYPE INTERFACES
// ============================================================================

export interface UseMarketplaceReturn {
  listings: MarketplaceListing[];
  featured: MarketplaceListing[];
  trending: MarketplaceListing[];
  creditBalance: number | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  clearError: () => void;
}

export interface UseMarketplaceListingReturn {
  listing: MarketplaceListing | null;
  isLoading: boolean;
  error: string | null;
  creditBalance: number | null;
  alreadyPurchased: boolean;
  purchase: (tier: MarketplaceLicenseTier) => Promise<MarketplacePurchase>;
  isPurchasing: boolean;
  purchaseError: string | null;
  clearPurchaseError: () => void;
  submitReview: (input: SubmitReviewInput) => Promise<void>;
  isSubmittingReview: boolean;
  refetch: () => Promise<void>;
}

export interface UseMyMarketplaceReturn {
  purchases: MarketplacePurchase[];
  myListings: MyMarketplaceListing[];
  creditBalance: number | null;
  isLoading: boolean;
  error: string | null;
  createListing: (input: CreateListingInput) => Promise<MarketplaceListing>;
  isCreatingListing: boolean;
  refetch: () => Promise<void>;
}

export type MarketplaceDownloadState = 'ready' | 'downloading' | 'complete' | 'error';

export interface UseMarketplaceDownloadReturn {
  /** Download metadata (null while loading or on error) */
  info: MarketplaceDownloadInfo | null;
  state: MarketplaceDownloadState;
  /** 0-100 */
  progress: number;
  error: string | null;
  start: () => Promise<void>;
  reset: () => void;
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook for the marketplace browse page: listings + credit balance.
 * Client-side filter state stays in the page component.
 */
export function useMarketplace(): UseMarketplaceReturn {
  // Selectors
  const listings = useMarketplaceStore(selectMarketplaceListings);
  const creditBalance = useMarketplaceStore(selectMarketplaceCreditBalance);
  const isLoading = useMarketplaceStore(selectIsLoadingListings);
  const error = useMarketplaceStore(selectMarketplaceError);

  // Derived (client-side, no separate fetches)
  const featured = useMemo(() => listings.filter((l) => l.isFeatured), [listings]);
  const trending = useMemo(() => listings.filter((l) => l.isTrending), [listings]);

  // Actions
  const storeFetchListings = useMarketplaceStore((state) => state.fetchListings);
  const storeFetchCreditBalance = useMarketplaceStore((state) => state.fetchCreditBalance);
  const storeClearError = useMarketplaceStore((state) => state.clearError);

  // Wrapped actions
  const refetch = useCallback(async () => {
    await Promise.all([storeFetchListings(), storeFetchCreditBalance()]);
  }, [storeFetchListings, storeFetchCreditBalance]);

  const clearError = useCallback(() => {
    storeClearError();
  }, [storeClearError]);

  // Fetch on mount
  useEffect(() => {
    refetch();
  }, [refetch]);

  return useMemo(
    () => ({
      listings,
      featured,
      trending,
      creditBalance,
      isLoading,
      error,
      refetch,
      clearError,
    }),
    [listings, featured, trending, creditBalance, isLoading, error, refetch, clearError]
  );
}

/**
 * Hook for a single marketplace listing detail with purchase + review flow
 */
export function useMarketplaceListing(id: string | undefined): UseMarketplaceListingReturn {
  // Selectors
  const currentListing = useMarketplaceStore(selectCurrentListing);
  const myPurchases = useMarketplaceStore(selectMyPurchases);
  const creditBalance = useMarketplaceStore(selectMarketplaceCreditBalance);
  const isLoading = useMarketplaceStore(selectIsLoadingDetail);
  const error = useMarketplaceStore(selectMarketplaceError);
  const isPurchasing = useMarketplaceStore(selectIsPurchasing);
  const purchaseError = useMarketplaceStore(selectPurchaseError);
  const isSubmittingReview = useMarketplaceStore(selectIsSubmittingReview);

  // Only expose the detail when it matches the requested id (avoids stale flashes)
  const listing = useMemo(
    () => (id && currentListing?.id === id ? currentListing : null),
    [id, currentListing]
  );

  const alreadyPurchased = useMemo(
    () => (id ? myPurchases.some((p) => p.listingId === id) : false),
    [id, myPurchases]
  );

  // Actions
  const storeFetchListing = useMarketplaceStore((state) => state.fetchListing);
  const storeFetchMyPurchases = useMarketplaceStore((state) => state.fetchMyPurchases);
  const storeFetchCreditBalance = useMarketplaceStore((state) => state.fetchCreditBalance);
  const storePurchase = useMarketplaceStore((state) => state.purchase);
  const storeSubmitReview = useMarketplaceStore((state) => state.submitReview);
  const storeClearPurchaseError = useMarketplaceStore((state) => state.clearPurchaseError);

  // Wrapped actions
  const refetch = useCallback(async () => {
    if (!id) return;
    await Promise.all([
      storeFetchListing(id),
      storeFetchMyPurchases(),
      storeFetchCreditBalance(),
    ]);
  }, [id, storeFetchListing, storeFetchMyPurchases, storeFetchCreditBalance]);

  const purchase = useCallback(
    async (tier: MarketplaceLicenseTier) => {
      if (!id) throw new Error('Missing listing id');
      return storePurchase(id, tier);
    },
    [id, storePurchase]
  );

  const submitReview = useCallback(
    async (input: SubmitReviewInput) => {
      if (!id) throw new Error('Missing listing id');
      await storeSubmitReview(id, input);
    },
    [id, storeSubmitReview]
  );

  const clearPurchaseError = useCallback(() => {
    storeClearPurchaseError();
  }, [storeClearPurchaseError]);

  // Fetch on id change
  useEffect(() => {
    refetch();
    // Reset any purchase error left over from a previous listing
    storeClearPurchaseError();
  }, [refetch, storeClearPurchaseError]);

  return useMemo(
    () => ({
      listing,
      isLoading,
      error,
      creditBalance,
      alreadyPurchased,
      purchase,
      isPurchasing,
      purchaseError,
      clearPurchaseError,
      submitReview,
      isSubmittingReview,
      refetch,
    }),
    [
      listing,
      isLoading,
      error,
      creditBalance,
      alreadyPurchased,
      purchase,
      isPurchasing,
      purchaseError,
      clearPurchaseError,
      submitReview,
      isSubmittingReview,
      refetch,
    ]
  );
}

/**
 * Hook for the user's purchases, own listings, balance, and listing creation
 */
export function useMyMarketplace(): UseMyMarketplaceReturn {
  // Selectors
  const purchases = useMarketplaceStore(selectMyPurchases);
  const myListings = useMarketplaceStore(selectMyListings);
  const creditBalance = useMarketplaceStore(selectMarketplaceCreditBalance);
  const isLoading = useMarketplaceStore(selectIsLoadingMy);
  const error = useMarketplaceStore(selectMarketplaceError);
  const isCreatingListing = useMarketplaceStore(selectIsCreatingListing);

  // Actions
  const storeFetchMyPurchases = useMarketplaceStore((state) => state.fetchMyPurchases);
  const storeFetchMyListings = useMarketplaceStore((state) => state.fetchMyListings);
  const storeFetchCreditBalance = useMarketplaceStore((state) => state.fetchCreditBalance);
  const storeCreateListing = useMarketplaceStore((state) => state.createListing);

  // Wrapped actions
  const refetch = useCallback(async () => {
    await Promise.all([
      storeFetchMyPurchases(),
      storeFetchMyListings(),
      storeFetchCreditBalance(),
    ]);
  }, [storeFetchMyPurchases, storeFetchMyListings, storeFetchCreditBalance]);

  const createListing = useCallback(
    async (input: CreateListingInput) => {
      return storeCreateListing(input);
    },
    [storeCreateListing]
  );

  // Fetch on mount
  useEffect(() => {
    refetch();
  }, [refetch]);

  return useMemo(
    () => ({
      purchases,
      myListings,
      creditBalance,
      isLoading,
      error,
      createListing,
      isCreatingListing,
      refetch,
    }),
    [
      purchases,
      myListings,
      creditBalance,
      isLoading,
      error,
      createListing,
      isCreatingListing,
      refetch,
    ]
  );
}

/**
 * Hook driving an artifact download for a purchased listing.
 * Fetches download metadata while `active`, then `start()` either opens the
 * presigned URL (immediate complete) or streams the blob with real progress.
 */
export function useMarketplaceDownload(
  listing: MarketplaceListing | null,
  active: boolean = true
): UseMarketplaceDownloadReturn {
  const [info, setInfo] = useState<MarketplaceDownloadInfo | null>(null);
  const [state, setState] = useState<MarketplaceDownloadState>('ready');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const listingId = listing?.id ?? null;

  const reset = useCallback(() => {
    setState('ready');
    setProgress(0);
    setError(null);
  }, []);

  // Fetch download metadata when activated / listing changes
  useEffect(() => {
    setInfo(null);
    reset();
    if (!active || !listingId) return;

    let cancelled = false;
    marketplaceApi
      .getDownloadInfo(listingId)
      .then((downloadInfo) => {
        if (!cancelled) setInfo(downloadInfo);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState('error');
          setError(err instanceof Error ? err.message : 'Failed to load download info');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [active, listingId, reset]);

  const start = useCallback(async () => {
    if (!listingId || !info) return;

    setError(null);

    // Presigned URL path: hand off to the browser, complete immediately
    if (info.url) {
      triggerBrowserDownload(info.url, info.fileName);
      setProgress(100);
      setState('complete');
      return;
    }

    // Streaming path: blob download with real progress
    setState('downloading');
    setProgress(0);
    try {
      const blob = await marketplaceApi.downloadArtifactBlob(listingId, (loaded, total) => {
        const totalBytes = total ?? info.fileSizeBytes;
        if (totalBytes > 0) {
          setProgress(Math.min(Math.round((loaded / totalBytes) * 100), 100));
        }
      });

      const objectUrl = URL.createObjectURL(blob);
      try {
        triggerBrowserDownload(objectUrl, info.fileName);
      } finally {
        // Give the browser a tick to start the download before revoking
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      }

      setProgress(100);
      setState('complete');
    } catch (err: unknown) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  }, [listingId, info]);

  return useMemo(
    () => ({ info, state, progress, error, start, reset }),
    [info, state, progress, error, start, reset]
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Trigger a browser file download via a temporary anchor element
 */
function triggerBrowserDownload(href: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
