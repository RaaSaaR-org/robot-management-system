/**
 * @file MarketplacePage.tsx
 * @description Main browse page for the Skill & Data Marketplace
 * @feature marketplace
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, TrendingUp, Sparkles, User,
  AlertTriangle, RefreshCw, PackageOpen,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { EmptyState } from '@/shared/components/ui/EmptyState';
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
    <div className="max-w-7xl mx-auto px-4 py-6">
      <PageHeader
        title="Skill & Data Marketplace"
        subtitle="Buy skills and datasets, download them, and run on your own hardware. No cloud dependency."
        actions={
          <>
            <CreditBalance totalCredits={creditBalance ?? 0} />
            <button
              type="button"
              onClick={() => navigate('/marketplace/mine')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-brand bg-theme-elevated border border-theme text-sm text-theme-secondary hover:text-theme-primary transition-colors"
            >
              <User size={14} />
              My Marketplace
            </button>
          </>
        }
        className="mb-6"
      />

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertTriangle size={18} className="text-red-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-400">Failed to load the marketplace</p>
            <p className="text-xs text-theme-secondary truncate">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-brand bg-theme-elevated border border-theme text-sm text-theme-secondary hover:text-theme-primary transition-colors shrink-0"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        {/* Type tabs */}
        <div className="flex items-center gap-1 bg-theme-elevated rounded-brand p-1">
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
                  ? 'bg-cobalt-500 text-white'
                  : 'text-theme-secondary hover:text-theme-primary'
              )}
            >
              {tab.label}
              <span className="ml-1.5 text-xs opacity-60">{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
          <input
            type="text"
            placeholder="Search skills, datasets, robots..."
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="w-full pl-9 pr-3 py-2 rounded-brand bg-theme-card border border-theme text-sm text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:border-cobalt-500/50"
          />
        </div>

        {/* Dropdowns */}
        <select
          value={filters.robotType}
          onChange={(e) => setFilters((f) => ({ ...f, robotType: e.target.value as MarketplaceFilters['robotType'] }))}
          className="px-3 py-2 rounded-brand bg-theme-card border border-theme text-sm text-theme-secondary focus:outline-none focus:border-cobalt-500/50"
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
          className="px-3 py-2 rounded-brand bg-theme-card border border-theme text-sm text-theme-secondary focus:outline-none focus:border-cobalt-500/50"
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
          <div className="h-6 w-40 rounded bg-theme-elevated animate-pulse mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ListingCardSkeleton key={i} />
            ))}
          </div>
        </section>
      )}

      {/* Server empty state */}
      {serverEmpty && (
        <EmptyState
          size="lg"
          icon={<PackageOpen className="w-10 h-10" />}
          title="The marketplace is empty"
          description="No skills or datasets have been published yet. Be the first to list one."
          action={
            <button
              type="button"
              onClick={() => navigate('/marketplace/mine')}
              className="text-sm text-cobalt-500 dark:text-cobalt-300 hover:underline"
            >
              List a Skill or Dataset
            </button>
          }
        />
      )}

      {!showSkeleton && !serverEmpty && (
        <>
          {/* Featured */}
          {!isFiltered && featured.length > 0 && (
            <section className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={16} className="text-cobalt-500 dark:text-cobalt-300" />
                <h2 className="text-lg font-semibold text-theme-primary">Featured</h2>
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
                <h2 className="text-lg font-semibold text-theme-primary">Trending</h2>
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
              <h2 className="text-lg font-semibold text-theme-primary">
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
              <EmptyState
                icon={<Search className="w-10 h-10" />}
                title="No listings match your filters"
                action={
                  <button
                    type="button"
                    onClick={() => setFilters(INITIAL_FILTERS)}
                    className="text-sm text-cobalt-500 dark:text-cobalt-300 hover:underline"
                  >
                    Clear filters
                  </button>
                }
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function ListingCardSkeleton() {
  return (
    <div className="rounded-xl bg-theme-card border border-theme p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-16 h-5 rounded-full bg-theme-elevated" />
        <div className="w-12 h-5 rounded-full bg-theme-elevated" />
      </div>
      <div className="h-4 w-3/4 rounded bg-theme-elevated mb-2" />
      <div className="h-3 w-full rounded bg-theme-elevated mb-1.5" />
      <div className="h-3 w-5/6 rounded bg-theme-elevated mb-4" />
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-full bg-theme-elevated" />
        <div className="h-3 w-24 rounded bg-theme-elevated" />
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-theme">
        <div className="h-3 w-16 rounded bg-theme-elevated" />
        <div className="h-4 w-20 rounded bg-cobalt-500/20" />
      </div>
    </div>
  );
}
