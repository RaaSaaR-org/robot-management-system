/**
 * @file MyMarketplacePage.tsx
 * @description My marketplace: licenses you bought and listings you published, as tabs in the URL
 * @feature marketplace
 */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, ExternalLink, Package, Plus, ShoppingBag } from 'lucide-react';
import {
  Badge, Button, DataTable, EmptyState, LinkButton, PageHeader, Panel, StatusTag, Tabs,
  type DataTableColumn,
} from '@/shared/components/ui';
import { formatTimeAgo, UI_DATE_LOCALE } from '@/shared/utils/format';
import { CreditBalance } from '../components/CreditBalance';
import { MarketplaceDownloadModal } from '../components/MarketplaceDownloadModal';
import { MarketplacePublishDialog } from '../components/MarketplacePublishDialog';
import { MarketplaceStarRating } from '../components/MarketplaceStarRating';
import { listingTypeLabel } from '../components/marketplaceUi';
import { formatCredits } from '../types/contributions.types';
import {
  LICENSE_TIER_LABELS,
  type MarketplaceListing,
  type MarketplacePurchase,
  type MyMarketplaceListing,
} from '../types/marketplace.types';
import { useMyMarketplace } from '../hooks/marketplace';

const TAB_IDS = ['purchases', 'listings'] as const;
type TabId = (typeof TAB_IDS)[number];

export function MyMarketplacePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TAB_IDS.includes(params.get('tab') as TabId) ? (params.get('tab') as TabId) : 'purchases';
  const setTab = (id: string) =>
    setParams((p) => { if (id === TAB_IDS[0]) p.delete('tab'); else p.set('tab', id); return p; }, { replace: true });

  const [downloadListing, setDownloadListing] = useState<MarketplaceListing | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const { purchases, myListings, creditBalance, isLoading, error, createListing, isCreatingListing, refetch } =
    useMyMarketplace();

  const openListing = (id: string) => navigate(`/marketplace/${id}`);
  const publishButton = (
    <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setPublishOpen(true)}>Publish listing</Button>
  );

  const purchaseColumns: DataTableColumn<MarketplacePurchase>[] = [
    {
      key: 'title', header: 'Listing', sortable: true, sortValue: (p) => p.listing.title,
      cell: (p) => <ListingCell listing={p.listing} />,
    },
    {
      key: 'tier', header: 'License', sortable: true, hideBelow: 'sm', sortValue: (p) => p.licenseTier,
      cell: (p) => <Badge variant="neutral" size="sm">{LICENSE_TIER_LABELS[p.licenseTier]}</Badge>,
    },
    {
      key: 'credits', header: 'Credits', align: 'right', sortable: true, hideBelow: 'sm',
      sortValue: (p) => p.creditsSpent, cell: (p) => <span className="tabular-nums">{formatCredits(p.creditsSpent)}</span>,
    },
    {
      key: 'purchasedAt', header: 'Purchased', align: 'right', sortable: true, hideBelow: 'md',
      sortValue: (p) => new Date(p.purchasedAt), cell: (p) => formatTimeAgo(p.purchasedAt),
    },
  ];

  const listingColumns: DataTableColumn<MyMarketplaceListing>[] = [
    {
      key: 'title', header: 'Title', sortable: true, sortValue: (m) => m.listing.title,
      cell: (m) => <span className="font-medium text-ink-primary">{m.listing.title}</span>,
    },
    { key: 'type', header: 'Type', sortable: true, sortValue: (m) => m.listing.type, hideBelow: 'sm', cell: (m) => listingTypeLabel(m.listing) },
    { key: 'status', header: 'Status', sortable: true, sortValue: (m) => m.status, cell: (m) => <StatusTag status={m.status} /> },
    {
      key: 'downloads', header: 'Downloads', align: 'right', sortable: true, hideBelow: 'sm', sortValue: (m) => m.totalDownloads,
      cell: (m) => <span className="tabular-nums">{m.totalDownloads.toLocaleString(UI_DATE_LOCALE)}</span>,
    },
    {
      key: 'rating', header: 'Rating', sortable: true, hideBelow: 'sm', sortValue: (m) => m.listing.rating,
      cell: (m) => (m.listing.reviewCount > 0 ? <MarketplaceStarRating rating={m.listing.rating} /> : null),
    },
    {
      key: 'revenue', header: 'Revenue', align: 'right', sortable: true, hideBelow: 'md', sortValue: (m) => m.totalRevenue,
      cell: (m) => <span className="tabular-nums">{formatCredits(m.totalRevenue)} credits</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        back={{ to: '/marketplace', label: 'Marketplace' }}
        title="My marketplace"
        description="What you licensed and what you published."
        meta={creditBalance != null ? <CreditBalance totalCredits={creditBalance} /> : undefined}
        actions={tab === 'listings' ? publishButton : undefined}
      />

      <Tabs
        tabs={[
          { id: 'purchases', label: 'Purchases', count: purchases.length },
          { id: 'listings', label: 'Listings', count: myListings.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === 'purchases' && (
        <Panel padding="none">
          <DataTable
            caption="Purchased licenses"
            columns={purchaseColumns}
            rows={purchases}
            getRowId={(p) => p.id}
            defaultSort={{ key: 'purchasedAt', direction: 'desc' }}
            onRowClick={(p) => openListing(p.listingId)}
            rowActions={(p) => [
              { label: 'Open', icon: <ExternalLink />, onSelect: () => openListing(p.listingId) },
              { label: 'Download', icon: <Download />, onSelect: () => setDownloadListing(p.listing) },
            ]}
            rowActionsLabel={(p) => `Actions for ${p.listing.title}`}
            isLoading={isLoading}
            error={purchases.length === 0 ? error : null}
            errorTitle="Couldn't load your purchases"
            onRetry={() => void refetch()}
            empty={
              <EmptyState
                icon={<ShoppingBag />}
                title="No purchases yet"
                description="Licenses you buy in the marketplace show up here, ready to download."
                action={<LinkButton to="/marketplace" variant="secondary">Browse the marketplace</LinkButton>}
              />
            }
          />
        </Panel>
      )}

      {tab === 'listings' && (
        <Panel padding="none">
          <DataTable
            caption="Your listings"
            columns={listingColumns}
            rows={myListings}
            getRowId={(m) => m.listing.id}
            defaultSort={{ key: 'title', direction: 'asc' }}
            onRowClick={(m) => openListing(m.listing.id)}
            rowActions={(m) => [{ label: 'Open', icon: <ExternalLink />, onSelect: () => openListing(m.listing.id) }]}
            rowActionsLabel={(m) => `Actions for ${m.listing.title}`}
            isLoading={isLoading}
            error={myListings.length === 0 ? error : null}
            errorTitle="Couldn't load your listings"
            onRetry={() => void refetch()}
            empty={
              <EmptyState
                icon={<Package />}
                title="No listings yet"
                description="Publish a skill or dataset to share it with other teams."
                action={publishButton}
              />
            }
          />
        </Panel>
      )}

      {downloadListing && (
        <MarketplaceDownloadModal listing={downloadListing} open onClose={() => setDownloadListing(null)} />
      )}

      <MarketplacePublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onSubmit={async (input) => { await createListing(input); }}
        isSubmitting={isCreatingListing}
      />
    </div>
  );
}

function ListingCell({ listing }: { listing: MarketplaceListing }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-ink-primary">{listing.title}</div>
      <div className="text-[13px] text-ink-tertiary">{listingTypeLabel(listing)}</div>
    </div>
  );
}
