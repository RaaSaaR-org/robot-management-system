/**
 * @file marketplaceStore.ts
 * @description Zustand store for Skill & Data Marketplace state management
 * @feature marketplace
 * @dependencies @/store, @/features/contributions/api, @/features/contributions/types
 * @stateAccess Creates: useMarketplaceStore
 */

import { createStore } from '@/store';
import { marketplaceApi, InsufficientCreditsError } from '../api/marketplaceApi';
import type {
  MarketplaceListing,
  MarketplacePurchase,
  MyMarketplaceListing,
  MarketplaceLicenseTier,
  ListListingsParams,
  CreateListingInput,
  SubmitReviewInput,
} from '../types/marketplace.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

// ============================================================================
// STORE TYPE
// ============================================================================

export interface MarketplaceStore {
  // State
  listings: MarketplaceListing[];
  currentListing: MarketplaceListing | null;
  myPurchases: MarketplacePurchase[];
  myListings: MyMarketplaceListing[];
  creditBalance: number | null;
  isLoadingListings: boolean;
  isLoadingDetail: boolean;
  isLoadingMy: boolean;
  isPurchasing: boolean;
  isSubmittingReview: boolean;
  isCreatingListing: boolean;
  error: string | null;
  purchaseError: string | null;

  // Actions
  fetchListings: (filters?: ListListingsParams) => Promise<void>;
  fetchListing: (id: string) => Promise<void>;
  fetchMyPurchases: () => Promise<void>;
  fetchMyListings: () => Promise<void>;
  fetchCreditBalance: () => Promise<void>;
  purchase: (listingId: string, tier: MarketplaceLicenseTier) => Promise<MarketplacePurchase>;
  submitReview: (listingId: string, input: SubmitReviewInput) => Promise<void>;
  createListing: (input: CreateListingInput) => Promise<MarketplaceListing>;
  clearError: () => void;
  clearPurchaseError: () => void;
  reset: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  listings: [] as MarketplaceListing[],
  currentListing: null as MarketplaceListing | null,
  myPurchases: [] as MarketplacePurchase[],
  myListings: [] as MyMarketplaceListing[],
  creditBalance: null as number | null,
  isLoadingListings: false,
  isLoadingDetail: false,
  isLoadingMy: false,
  isPurchasing: false,
  isSubmittingReview: false,
  isCreatingListing: false,
  error: null as string | null,
  purchaseError: null as string | null,
};

// ============================================================================
// STORE
// ============================================================================

export const useMarketplaceStore = createStore<MarketplaceStore>(
  (set) => ({
    ...initialState,

    // --------------------------------------------------------------------------
    // Fetch Listings
    // --------------------------------------------------------------------------
    fetchListings: async (filters?: ListListingsParams) => {
      set((state) => {
        state.isLoadingListings = true;
        state.error = null;
      });

      try {
        const response = await marketplaceApi.listListings(filters);

        set((state) => {
          state.listings = response.listings;
          state.isLoadingListings = false;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoadingListings = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Single Listing (detail, reviews populated)
    // --------------------------------------------------------------------------
    fetchListing: async (id: string) => {
      set((state) => {
        state.isLoadingDetail = true;
        state.error = null;
      });

      try {
        const listing = await marketplaceApi.getListing(id);

        set((state) => {
          state.currentListing = listing;
          state.isLoadingDetail = false;
          // Update in list if present
          const index = state.listings.findIndex((l) => l.id === id);
          if (index !== -1) {
            state.listings[index] = listing;
          }
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoadingDetail = false;
          state.currentListing = null;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch My Purchases
    // --------------------------------------------------------------------------
    fetchMyPurchases: async () => {
      set((state) => {
        state.isLoadingMy = true;
        state.error = null;
      });

      try {
        const response = await marketplaceApi.getMyPurchases();

        set((state) => {
          state.myPurchases = response.purchases;
          state.isLoadingMy = false;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoadingMy = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch My Listings
    // --------------------------------------------------------------------------
    fetchMyListings: async () => {
      set((state) => {
        state.isLoadingMy = true;
        state.error = null;
      });

      try {
        const response = await marketplaceApi.getMyListings();

        set((state) => {
          state.myListings = response.listings;
          state.isLoadingMy = false;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isLoadingMy = false;
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch Credit Balance
    // --------------------------------------------------------------------------
    fetchCreditBalance: async () => {
      try {
        const response = await marketplaceApi.getCreditBalance();

        set((state) => {
          state.creditBalance = response.balance;
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.error = errorMessage;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Purchase
    // --------------------------------------------------------------------------
    purchase: async (listingId: string, tier: MarketplaceLicenseTier) => {
      set((state) => {
        state.isPurchasing = true;
        state.purchaseError = null;
      });

      try {
        const response = await marketplaceApi.purchase(listingId, tier);

        set((state) => {
          state.creditBalance = response.balance;
          state.myPurchases.unshift(response.purchase);
          state.isPurchasing = false;
        });

        // Silently refresh the detail (download count, etc.) without
        // flashing the detail skeleton
        marketplaceApi
          .getListing(listingId)
          .then((listing) => {
            set((state) => {
              if (state.currentListing?.id === listingId) {
                state.currentListing = listing;
              }
            });
          })
          .catch(() => {
            /* non-fatal: purchase already succeeded */
          });

        return response.purchase;
      } catch (error) {
        const errorMessage =
          error instanceof InsufficientCreditsError
            ? formatInsufficientCredits(error)
            : getErrorMessage(error);

        set((state) => {
          state.isPurchasing = false;
          state.purchaseError = errorMessage;
          // Keep the displayed balance honest if the server told us
          if (error instanceof InsufficientCreditsError && typeof error.balance === 'number') {
            state.creditBalance = error.balance;
          }
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Submit Review
    // --------------------------------------------------------------------------
    submitReview: async (listingId: string, input: SubmitReviewInput) => {
      set((state) => {
        state.isSubmittingReview = true;
        state.error = null;
      });

      try {
        const response = await marketplaceApi.submitReview(listingId, input);

        set((state) => {
          state.isSubmittingReview = false;
          // Refresh the detail in place with the new review + denormalized stats
          if (state.currentListing?.id === listingId) {
            state.currentListing.reviews.unshift(response.review);
            state.currentListing.rating = response.rating;
            state.currentListing.reviewCount = response.reviewCount;
          }
          const index = state.listings.findIndex((l) => l.id === listingId);
          if (index !== -1) {
            state.listings[index].rating = response.rating;
            state.listings[index].reviewCount = response.reviewCount;
          }
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isSubmittingReview = false;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Create Listing
    // --------------------------------------------------------------------------
    createListing: async (input: CreateListingInput) => {
      set((state) => {
        state.isCreatingListing = true;
      });

      try {
        const listing = await marketplaceApi.createListing(input);

        set((state) => {
          state.isCreatingListing = false;
          state.myListings.unshift({
            listing,
            totalRevenue: 0,
            totalDownloads: 0,
            status: 'active',
          });
          // New listings are published immediately (MVP) — show in browse list
          state.listings.unshift(listing);
        });

        return listing;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        set((state) => {
          state.isCreatingListing = false;
        });
        throw new Error(errorMessage);
      }
    },

    // --------------------------------------------------------------------------
    // Clear Errors
    // --------------------------------------------------------------------------
    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },

    clearPurchaseError: () => {
      set((state) => {
        state.purchaseError = null;
      });
    },

    // --------------------------------------------------------------------------
    // Reset Store
    // --------------------------------------------------------------------------
    reset: () => {
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  }),
  {
    name: 'MarketplaceStore',
    persist: false,
  }
);

// ============================================================================
// SELECTORS
// ============================================================================

/** Select all listings */
export const selectMarketplaceListings = (state: MarketplaceStore) => state.listings;

/** Select the current (detail) listing */
export const selectCurrentListing = (state: MarketplaceStore) => state.currentListing;

/** Select the user's purchases */
export const selectMyPurchases = (state: MarketplaceStore) => state.myPurchases;

/** Select the user's own listings */
export const selectMyListings = (state: MarketplaceStore) => state.myListings;

/** Select the user's credit balance */
export const selectMarketplaceCreditBalance = (state: MarketplaceStore) => state.creditBalance;

/** Select listings-loading state */
export const selectIsLoadingListings = (state: MarketplaceStore) => state.isLoadingListings;

/** Select detail-loading state */
export const selectIsLoadingDetail = (state: MarketplaceStore) => state.isLoadingDetail;

/** Select my-marketplace-loading state */
export const selectIsLoadingMy = (state: MarketplaceStore) => state.isLoadingMy;

/** Select purchasing state */
export const selectIsPurchasing = (state: MarketplaceStore) => state.isPurchasing;

/** Select review submission state */
export const selectIsSubmittingReview = (state: MarketplaceStore) => state.isSubmittingReview;

/** Select listing creation state */
export const selectIsCreatingListing = (state: MarketplaceStore) => state.isCreatingListing;

/** Select error */
export const selectMarketplaceError = (state: MarketplaceStore) => state.error;

/** Select purchase error */
export const selectPurchaseError = (state: MarketplaceStore) => state.purchaseError;

/** Select featured listings (derived client-side) */
export const selectFeaturedListings = (state: MarketplaceStore) =>
  state.listings.filter((l) => l.isFeatured);

/** Select trending listings (derived client-side) */
export const selectTrendingListings = (state: MarketplaceStore) =>
  state.listings.filter((l) => l.isTrending);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build a precise insufficient-credits message using server extras when present
 */
function formatInsufficientCredits(error: InsufficientCreditsError): string {
  if (typeof error.balance === 'number' && typeof error.required === 'number') {
    return `Insufficient credits: this license costs ${error.required.toLocaleString(UI_DATE_LOCALE)} credits, but your balance is ${error.balance.toLocaleString(UI_DATE_LOCALE)}.`;
  }
  return error.message || 'Insufficient credits';
}

/**
 * Extract error message from API error
 */
function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    // Check for message property (ApiError from apiClient or Error)
    if ('message' in error && typeof error.message === 'string' && error.message) {
      return error.message;
    }

    // Check for response.data.error (raw Axios error format)
    if ('response' in error) {
      const response = error.response as { data?: { error?: string; message?: string } };
      if (response?.data?.error) {
        return response.data.error;
      }
      if (response?.data?.message) {
        return response.data.message;
      }
    }
  }

  return 'An unexpected error occurred';
}
