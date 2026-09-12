/**
 * @file MarketplacePage.tsx
 * @description Marketplace browse page: one filterable card grid of skills and datasets
 * @feature marketplace
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackageOpen, Plus, Search } from 'lucide-react';
import {
  Button, EmptyState, ErrorState, LinkButton, PageHeader, Panel, SearchInput, Select, Skeleton,
  SkeletonText, Toolbar,
} from '@/shared/components/ui';
import { CreditBalance } from '../components/CreditBalance';
import { MarketplaceListingCard } from '../components/MarketplaceListingCard';
import { MarketplacePublishDialog } from '../components/MarketplacePublishDialog';
import { ROBOT_TYPES, SORT_OPTIONS, sortListings, type MarketplaceSort } from '../components/marketplaceUi';
import { useMarketplace } from '../hooks/marketplace';
import { useMarketplaceStore, selectIsCreatingListing } from '../store/marketplaceStore';
import type { MarketplaceItemType, RobotHardwareType } from '../types/marketplace.types';

const TYPE_OPTIONS = [
  { value: 'skill', label: 'Skills' },
  { value: 'dataset', label: 'Datasets' },
];

export function MarketplacePage() {
  const navigate = useNavigate();
  const { listings, creditBalance, isLoading, error, refetch } = useMarketplace();
  const createListing = useMarketplaceStore((s) => s.createListing);
  const isCreatingListing = useMarketplaceStore(selectIsCreatingListing);

  const [query, setQuery] = useState('');
  const [type, setType] = useState<'' | MarketplaceItemType>('');
  const [robotType, setRobotType] = useState<'' | RobotHardwareType>('');
  const [sort, setSort] = useState<MarketplaceSort>('featured');
  const [publishOpen, setPublishOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = listings.filter((l) => {
      if (type && l.type !== type) return false;
      if (robotType && l.robotType !== robotType) return false;
      if (!q) return true;
      return (
        l.title.toLowerCase().includes(q) ||
        l.shortDescription.toLowerCase().includes(q) ||
        l.seller.displayName.toLowerCase().includes(q) ||
        l.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    return sortListings(matches, sort);
  }, [listings, query, type, robotType, sort]);

  const clearFilters = () => { setQuery(''); setType(''); setRobotType(''); };
  const showSkeleton = isLoading && listings.length === 0;
  const openPublish = () => setPublishOpen(true);

  const publishButton = (
    <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openPublish}>Publish listing</Button>
  );

  let content: React.ReactNode;
  if (error && listings.length === 0) {
    content = (
      <Panel>
        <ErrorState title="Couldn't load listings" message={error} onRetry={() => void refetch()} />
      </Panel>
    );
  } else if (showSkeleton) {
    content = (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading listings">
        {Array.from({ length: 6 }).map((_, i) => (
          <Panel key={i} padding="sm" className="flex flex-col gap-3">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-3/4" />
            <SkeletonText lines={2} />
          </Panel>
        ))}
      </div>
    );
  } else if (listings.length === 0) {
    content = (
      <Panel>
        <EmptyState
          icon={<PackageOpen />}
          title="No listings yet"
          description="Publish a skill or dataset to share it with other teams."
          action={publishButton}
        />
      </Panel>
    );
  } else if (filtered.length === 0) {
    content = (
      <Panel>
        <EmptyState
          icon={<Search />}
          title="No listings match"
          description="Try another search, or clear the filters."
          action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
        />
      </Panel>
    );
  } else {
    content = (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((listing) => (
          <MarketplaceListingCard
            key={listing.id}
            listing={listing}
            onClick={() => navigate(`/marketplace/${listing.id}`)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        title="Marketplace"
        description="Skills and datasets published by other teams. License one to use it on your fleet."
        meta={creditBalance != null ? <CreditBalance totalCredits={creditBalance} /> : undefined}
        actions={
          <>
            <LinkButton to="/marketplace/mine" variant="secondary">My marketplace</LinkButton>
            {publishButton}
          </>
        }
      />

      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search listings" />}
        filters={
          <>
            <Select
              aria-label="Type"
              fullWidth={false}
              className="w-36"
              placeholder="All types"
              options={TYPE_OPTIONS}
              value={type}
              onChange={(e) => setType(e.target.value as '' | MarketplaceItemType)}
            />
            <Select
              aria-label="Robot type"
              fullWidth={false}
              className="w-40"
              placeholder="All robots"
              options={ROBOT_TYPES.map((r) => ({ value: r, label: r }))}
              value={robotType}
              onChange={(e) => setRobotType(e.target.value as '' | RobotHardwareType)}
            />
            <Select
              aria-label="Sort"
              fullWidth={false}
              className="w-44"
              options={SORT_OPTIONS}
              value={sort}
              onChange={(e) => setSort(e.target.value as MarketplaceSort)}
            />
          </>
        }
      />

      {content}

      <MarketplacePublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onSubmit={async (input) => {
          const listing = await createListing(input);
          navigate(`/marketplace/${listing.id}`);
        }}
        isSubmitting={isCreatingListing}
      />
    </div>
  );
}
