/**
 * @file MarketplacePage.tsx
 * @description Main browse page for the Skill & Data Marketplace
 * @feature marketplace
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, ShoppingBag, TrendingUp, Sparkles, Shield, Download, User,
  AlertTriangle, RefreshCw, PackageOpen,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { CreditBalance } from '../components/CreditBalance';
import { MarketplaceListingCard } from '../components/MarketplaceListingCard';
import { useMarketplace } from '../hooks/marketplace';
import type { MarketplaceFilters } from '../types/marketplace.types';

const INITIAL_FILTERS: MarketplaceFilters = {
  type: 'all',
  robotType: 'all',
  baseModel: 'all',
  minRating: null,
  search: '',
};

export function MarketplacePage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<MarketplaceFilters>(INITIAL_FILTERS);
  const { listings, featured, trending, creditBalance, isLoading, error, refetch } =
    useMarketplace();

  const filtered = useMemo(() => {
    return listings.filter((l) => {
      if (filters.type !== 'all' && l.type !== filters.type) return false;
      if (filters.robotType !== 'all' && l.robotType !== filters.robotType) return false;
      if (filters.baseModel !== 'all' && l.baseModel !== filters.baseModel) return false;
      if (filters.minRating && l.rating < filters.minRating) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        return (
          l.title.toLowerCase().includes(q) ||
          l.shortDescription.toLowerCase().includes(q) ||
          l.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [filters, listings]);

  const isFiltered =
    filters.type !== 'all' ||
    filters.robotType !== 'all' ||
    filters.baseModel !== 'all' ||
    filters.search.length > 0;
  const skillCount = listings.filter((l) => l.type === 'skill').length;
  const datasetCount = listings.filter((l) => l.type === 'dataset').length;
  const showSkeleton = isLoading && listings.length === 0;
  const serverEmpty = !isLoading && !error && listings.length === 0;

  return (
    <div className="min-h-screen bg-[#0f1012]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Hero */}
        <div className="relative rounded-2xl bg-gradient-to-br from-[#1a1b1f] to-[#0a0b0d] border border-white/10 p-8 mb-8 overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#FF6700]/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#FF6700]/15 flex items-center justify-center">
                  <ShoppingBag size={20} className="text-[#FF6700]" />
                </div>
                <h1 className="text-2xl font-bold text-white">Skill & Data Marketplace</h1>
              </div>
              <p className="text-gray-400 max-w-lg mb-4">
                Own your robot intelligence. Buy skills and datasets, download them, and run on your own hardware. No cloud dependency.
              </p>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <Shield size={12} className="text-[#FF6700]" />
                  Full data sovereignty
                </span>
                <span className="flex items-center gap-1.5">
                  <Download size={12} className="text-[#FF6700]" />
                  Download & run locally
                </span>
                <span className="flex items-center gap-1.5">
                  <Sparkles size={12} className="text-[#FF6700]" />
                  {listings.length} items available
                </span>
              </div>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-2">
              <CreditBalance totalCredits={creditBalance ?? 0} />
              <button
                type="button"
                onClick={() => navigate('/marketplace/mine')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300 hover:text-white hover:border-white/20 transition-colors"
              >
                <User size={14} />
                My Marketplace
              </button>
            </div>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/30">
            <AlertTriangle size={18} className="text-red-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-400">Failed to load the marketplace</p>
              <p className="text-xs text-gray-400 truncate">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300 hover:text-white hover:border-white/20 transition-colors shrink-0"
            >
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
          {/* Type tabs */}
          <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
            {([
              { value: 'all', label: 'All', count: listings.length },
              { value: 'skill', label: 'Skills', count: skillCount },
              { value: 'dataset', label: 'Datasets', count: datasetCount },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, type: tab.value }))}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  filters.type === tab.value
                    ? 'bg-[#FF6700] text-white'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                {tab.label}
                <span className="ml-1.5 text-xs opacity-60">{tab.count}</span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search skills, datasets, robots..."
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6700]/50"
            />
          </div>

          {/* Dropdowns */}
          <select
            value={filters.robotType}
            onChange={(e) => setFilters((f) => ({ ...f, robotType: e.target.value as MarketplaceFilters['robotType'] }))}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300 focus:outline-none focus:border-[#FF6700]/50"
          >
            <option value="all">All Robots</option>
            <option value="SO-101">SO-101</option>
            <option value="Unitree G1">Unitree G1</option>
            <option value="Unitree H1">Unitree H1</option>
            <option value="Generic">Generic</option>
          </select>

          <select
            value={filters.baseModel}
            onChange={(e) => setFilters((f) => ({ ...f, baseModel: e.target.value as MarketplaceFilters['baseModel'] }))}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300 focus:outline-none focus:border-[#FF6700]/50"
          >
            <option value="all">All Models</option>
            <option value="SmolVLA">SmolVLA</option>
            <option value="Pi0.5">Pi0.5</option>
            <option value="OpenVLA">OpenVLA</option>
          </select>
        </div>

        {/* Loading skeleton */}
        {showSkeleton && (
          <section aria-busy="true" aria-label="Loading listings">
            <div className="h-6 w-40 rounded bg-white/5 animate-pulse mb-4" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <ListingCardSkeleton key={i} />
              ))}
            </div>
          </section>
        )}

        {/* Server empty state */}
        {serverEmpty && (
          <div className="text-center py-20 rounded-xl bg-white/[0.02] border border-white/5">
            <PackageOpen size={40} className="mx-auto text-gray-600 mb-3" />
            <p className="text-gray-300 font-medium mb-1">The marketplace is empty</p>
            <p className="text-sm text-gray-500 mb-4">
              No skills or datasets have been published yet. Be the first to list one.
            </p>
            <button
              type="button"
              onClick={() => navigate('/marketplace/mine')}
              className="text-sm text-[#FF6700] hover:underline"
            >
              List a Skill or Dataset
            </button>
          </div>
        )}

        {!showSkeleton && !serverEmpty && (
          <>
            {/* Featured */}
            {!isFiltered && featured.length > 0 && (
              <section className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles size={16} className="text-[#FF6700]" />
                  <h2 className="text-lg font-semibold text-white">Featured</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {featured.map((listing) => (
                    <MarketplaceListingCard
                      key={listing.id}
                      listing={listing}
                      onClick={() => navigate(`/marketplace/${listing.id}`)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Trending */}
            {!isFiltered && trending.length > 0 && (
              <section className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp size={16} className="text-amber-400" />
                  <h2 className="text-lg font-semibold text-white">Trending</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {trending.map((listing) => (
                    <MarketplaceListingCard
                      key={listing.id}
                      listing={listing}
                      onClick={() => navigate(`/marketplace/${listing.id}`)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* All Listings */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  {isFiltered ? `Results (${filtered.length})` : 'All Listings'}
                </h2>
              </div>
              {filtered.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filtered.map((listing) => (
                    <MarketplaceListingCard
                      key={listing.id}
                      listing={listing}
                      onClick={() => navigate(`/marketplace/${listing.id}`)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 rounded-xl bg-white/[0.02] border border-white/5">
                  <Search size={40} className="mx-auto text-gray-600 mb-3" />
                  <p className="text-gray-400 mb-1">No listings match your filters</p>
                  <button
                    type="button"
                    onClick={() => setFilters(INITIAL_FILTERS)}
                    className="text-sm text-[#FF6700] hover:underline"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function ListingCardSkeleton() {
  return (
    <div className="rounded-xl bg-[#1a1b1f] border border-white/10 p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-16 h-5 rounded-full bg-white/10" />
        <div className="w-12 h-5 rounded-full bg-white/5" />
      </div>
      <div className="h-4 w-3/4 rounded bg-white/10 mb-2" />
      <div className="h-3 w-full rounded bg-white/5 mb-1.5" />
      <div className="h-3 w-5/6 rounded bg-white/5 mb-4" />
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-full bg-white/10" />
        <div className="h-3 w-24 rounded bg-white/5" />
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <div className="h-3 w-16 rounded bg-white/5" />
        <div className="h-4 w-20 rounded bg-[#FF6700]/20" />
      </div>
    </div>
  );
}
