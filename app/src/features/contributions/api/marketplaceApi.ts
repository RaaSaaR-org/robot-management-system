/**
 * @file marketplaceApi.ts
 * @description API calls for the Skill & Data Marketplace endpoints
 * @feature marketplace
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type {
  MarketplaceListing,
  ListListingsParams,
  ListListingsResponse,
  GetListingResponse,
  CreateListingInput,
  MarketplaceLicenseTier,
  PurchaseListingResponse,
  MarketplaceDownloadInfo,
  SubmitReviewInput,
  SubmitReviewResponse,
  MyPurchasesResponse,
  MyListingsResponse,
  MarketplaceCreditBalanceResponse,
} from '../types/marketplace.types';

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Error thrown when a purchase fails with 402 Insufficient Credits.
 * Carries the server-provided balance/required extras so the UI can
 * render a precise message.
 */
export class InsufficientCreditsError extends Error {
  readonly statusCode = 402;
  readonly balance?: number;
  readonly required?: number;

  constructor(message: string, balance?: number, required?: number) {
    super(message);
    this.name = 'InsufficientCreditsError';
    this.balance = balance;
    this.required = required;
  }
}

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  listings: '/marketplace/listings',
  listing: (id: string) => `/marketplace/listings/${id}`,
  purchase: (id: string) => `/marketplace/listings/${id}/purchase`,
  download: (id: string) => `/marketplace/listings/${id}/download`,
  downloadFile: (id: string) => `/marketplace/listings/${id}/download/file`,
  reviews: (id: string) => `/marketplace/listings/${id}/reviews`,
  myPurchases: '/marketplace/my/purchases',
  myListings: '/marketplace/my/listings',
  creditBalance: '/marketplace/credits/balance',
} as const;

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const marketplaceApi = {
  // --------------------------------------------------------------------------
  // Listings
  // --------------------------------------------------------------------------

  /**
   * List published marketplace listings with optional filters
   * @param filters - Optional type/robotType/baseModel/search/featured/trending filters
   * @returns Listings (reviews omitted) and total count
   */
  async listListings(filters?: ListListingsParams): Promise<ListListingsResponse> {
    const response = await apiClient.get<ListListingsResponse>(ENDPOINTS.listings, {
      params: {
        type: filters?.type,
        robotType: filters?.robotType,
        baseModel: filters?.baseModel,
        search: filters?.search,
        featured: filters?.featured,
        trending: filters?.trending,
      },
    });
    return response.data;
  },

  /**
   * Get a single listing with reviews populated
   * @param id - Listing ID
   * @returns Full listing detail
   */
  async getListing(id: string): Promise<MarketplaceListing> {
    const response = await apiClient.get<GetListingResponse>(ENDPOINTS.listing(id));
    return response.data.listing;
  },

  /**
   * Publish a new listing
   * @param input - Listing metadata and price tiers
   * @returns Created listing
   */
  async createListing(input: CreateListingInput): Promise<MarketplaceListing> {
    const response = await apiClient.post<GetListingResponse>(ENDPOINTS.listings, input);
    return response.data.listing;
  },

  // --------------------------------------------------------------------------
  // Purchase
  // --------------------------------------------------------------------------

  /**
   * Purchase a license for a listing.
   * A 402 (insufficient credits) is intercepted here so the server's
   * balance/required extras survive the axios error normalization.
   * @param listingId - Listing ID
   * @param tier - License tier to purchase
   * @returns Purchase record and the buyer's new balance
   */
  async purchase(
    listingId: string,
    tier: MarketplaceLicenseTier
  ): Promise<PurchaseListingResponse> {
    const response = await apiClient.post<
      PurchaseListingResponse & { error?: string; balance?: number; required?: number }
    >(
      ENDPOINTS.purchase(listingId),
      { tier },
      {
        // Let 402 through so we can read the balance/required extras
        validateStatus: (status) => (status >= 200 && status < 300) || status === 402,
      }
    );

    if (response.status === 402) {
      const data = response.data;
      throw new InsufficientCreditsError(
        data.error ?? 'Insufficient credits',
        data.balance,
        data.required
      );
    }

    return response.data;
  },

  // --------------------------------------------------------------------------
  // Download
  // --------------------------------------------------------------------------

  /**
   * Get download metadata for a purchased listing
   * @param listingId - Listing ID
   * @returns File name, size, checksum, and presigned URL (or null)
   */
  async getDownloadInfo(listingId: string): Promise<MarketplaceDownloadInfo> {
    const response = await apiClient.get<MarketplaceDownloadInfo>(ENDPOINTS.download(listingId));
    return response.data;
  },

  /**
   * Download the artifact as a Blob via the streaming endpoint
   * @param listingId - Listing ID
   * @param onProgress - Progress callback with loaded/total bytes
   * @returns The artifact blob
   */
  async downloadArtifactBlob(
    listingId: string,
    onProgress?: (loaded: number, total: number | undefined) => void
  ): Promise<Blob> {
    const response = await apiClient.get<Blob>(ENDPOINTS.downloadFile(listingId), {
      responseType: 'blob',
      // Large artifacts can exceed the default 30s timeout
      timeout: 0,
      onDownloadProgress: (event) => {
        onProgress?.(event.loaded, event.total ?? undefined);
      },
    });
    return response.data;
  },

  // --------------------------------------------------------------------------
  // Reviews
  // --------------------------------------------------------------------------

  /**
   * Submit a review for a purchased listing
   * @param listingId - Listing ID
   * @param input - Rating (1-5), body, optional robot type
   * @returns Created review plus updated denormalized rating/reviewCount
   */
  async submitReview(listingId: string, input: SubmitReviewInput): Promise<SubmitReviewResponse> {
    const response = await apiClient.post<SubmitReviewResponse>(
      ENDPOINTS.reviews(listingId),
      input
    );
    return response.data;
  },

  // --------------------------------------------------------------------------
  // My Marketplace
  // --------------------------------------------------------------------------

  /**
   * Get the current user's purchases (newest first)
   * @returns Purchase records with embedded listings
   */
  async getMyPurchases(): Promise<MyPurchasesResponse> {
    const response = await apiClient.get<MyPurchasesResponse>(ENDPOINTS.myPurchases);
    return response.data;
  },

  /**
   * Get the current user's own listings with revenue stats
   * @returns Seller listings
   */
  async getMyListings(): Promise<MyListingsResponse> {
    const response = await apiClient.get<MyListingsResponse>(ENDPOINTS.myListings);
    return response.data;
  },

  // --------------------------------------------------------------------------
  // Credits
  // --------------------------------------------------------------------------

  /**
   * Get the current user's marketplace credit balance
   * @returns Credit balance
   */
  async getCreditBalance(): Promise<MarketplaceCreditBalanceResponse> {
    const response = await apiClient.get<MarketplaceCreditBalanceResponse>(
      ENDPOINTS.creditBalance
    );
    return response.data;
  },
};
