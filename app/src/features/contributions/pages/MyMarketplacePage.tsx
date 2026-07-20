/**
 * @file MyMarketplacePage.tsx
 * @description User's purchases and listings in the marketplace
 * @feature marketplace
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Download, ShoppingBag, Package, Plus, ExternalLink,
  AlertTriangle, RefreshCw,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import { TierBadge } from '../components/TierBadge';
import { CreditBalance } from '../components/CreditBalance';
import { MarketplaceDownloadModal } from '../components/MarketplaceDownloadModal';
import { MarketplacePublishDialog } from '../components/MarketplacePublishDialog';
import { formatCredits } from '../types/contributions.types';
import { LICENSE_TIER_LABELS } from '../types/marketplace.types';
import type { MarketplaceListing } from '../types/marketplace.types';
import { useMyMarketplace } from '../hooks/marketplace';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

type Tab = 'purchases' | 'listings';

export function MyMarketplacePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('purchases');
  const [downloadListing, setDownloadListing] = useState<MarketplaceListing | null>(null);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const {
    purchases,
    myListings,
    creditBalance,
    isLoading,
    error,
    createListing,
    isCreatingListing,
    refetch,
  } = useMyMarketplace();

  const showSkeleton = isLoading && purchases.length === 0 && myListings.length === 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate('/marketplace')}
        className="flex items-center gap-2 text-sm text-theme-secondary hover:text-theme-primary mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Marketplace
      </button>

      <PageHeader
        title="My Marketplace"
        subtitle="Your purchased licenses and published listings"
        actions={<CreditBalance totalCredits={creditBalance ?? 0} />}
        className="mb-6"
      />

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertTriangle size={18} className="text-red-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-400">Failed to load your marketplace data</p>
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

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-theme-elevated rounded-brand p-1 mb-6 w-fit">
        <button
          type="button"
          onClick={() => setTab('purchases')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            tab === 'purchases' ? 'bg-cobalt-500 text-white' : 'text-theme-secondary hover:text-theme-primary'
          )}
        >
          <ShoppingBag size={14} />
          My Purchases
          <span className="text-xs opacity-60">{purchases.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('listings')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            tab === 'listings' ? 'bg-cobalt-500 text-white' : 'text-theme-secondary hover:text-theme-primary'
          )}
        >
          <Package size={14} />
          My Listings
          <span className="text-xs opacity-60">{myListings.length}</span>
        </button>
      </div>

      {/* Loading skeleton (shared for both tabs) */}
      {showSkeleton && (
        <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-theme-card border border-theme">
              <div className="w-10 h-10 rounded-lg bg-theme-elevated shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="h-4 w-1/3 rounded bg-theme-elevated mb-2" />
                <div className="h-3 w-1/2 rounded bg-theme-elevated" />
              </div>
              <div className="w-24 h-9 rounded-brand bg-theme-elevated shrink-0" />
            </div>
          ))}
        </div>
      )}

      {/* Purchases */}
      {!showSkeleton && tab === 'purchases' && (
        <div className="space-y-3">
          {purchases.map((purchase) => (
            <div
              key={purchase.id}
              className="flex items-center gap-4 p-4 rounded-xl bg-theme-card border border-theme"
            >
              <div className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                purchase.listing.type === 'skill'
                  ? 'bg-cobalt-500/10 text-cobalt-500 dark:text-cobalt-300'
                  : 'bg-teal-500/15 text-teal-400'
              )}>
                {purchase.listing.type === 'skill' ? <Package size={20} /> : <Download size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => navigate(`/marketplace/${purchase.listingId}`)}
                  className="text-sm font-medium text-theme-primary hover:text-cobalt-500 dark:hover:text-cobalt-300 transition-colors flex items-center gap-1"
                >
                  {purchase.listing.title}
                  <ExternalLink size={10} />
                </button>
                <div className="flex items-center gap-3 text-xs text-theme-tertiary mt-0.5">
                  <span>{purchase.listing.type === 'skill' ? 'Skill' : 'Dataset'}</span>
                  <span>{LICENSE_TIER_LABELS[purchase.licenseTier]} license</span>
                  <span>{formatCredits(purchase.creditsSpent)} credits</span>
                  <span>{formatDate(purchase.purchasedAt)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDownloadListing(purchase.listing)}
                className="px-4 py-2 rounded-brand bg-emerald-600/20 text-emerald-400 text-sm font-medium hover:bg-emerald-600/30 transition-colors flex items-center gap-1.5 shrink-0"
              >
                <Download size={14} />
                Download
              </button>
            </div>
          ))}

          {purchases.length === 0 && (
            <EmptyState
              icon={<ShoppingBag className="w-10 h-10" />}
              title="No purchases yet"
              action={
                <button
                  type="button"
                  onClick={() => navigate('/marketplace')}
                  className="text-sm text-cobalt-500 dark:text-cobalt-300 hover:underline"
                >
                  Browse the Marketplace
                </button>
              }
            />
          )}
        </div>
      )}

      {/* My Listings */}
      {!showSkeleton && tab === 'listings' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-theme-secondary">
              {myListings.length} {myListings.length === 1 ? 'listing' : 'listings'}
            </p>
            <button
              type="button"
              onClick={() => setShowPublishDialog(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-brand bg-cobalt-500 text-white text-sm font-medium hover:bg-cobalt-600 transition-colors"
            >
              <Plus size={14} />
              List a Skill or Dataset
            </button>
          </div>

          {myListings.length === 0 ? (
            <EmptyState
              icon={<Package className="w-10 h-10" />}
              title="You haven't listed anything yet"
              action={
                <button
                  type="button"
                  onClick={() => setShowPublishDialog(true)}
                  className="text-sm text-cobalt-500 dark:text-cobalt-300 hover:underline"
                >
                  Publish your first skill or dataset
                </button>
              }
            />
          ) : (
            <div className="rounded-xl border border-theme overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-theme-elevated">
                    <th className="text-left px-4 py-3 text-xs font-medium text-theme-tertiary uppercase tracking-wide">Listing</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-theme-tertiary uppercase tracking-wide">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-theme-tertiary uppercase tracking-wide">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-theme-tertiary uppercase tracking-wide">Downloads</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-theme-tertiary uppercase tracking-wide">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {myListings.map((item) => (
                    <tr key={item.listing.id} className="border-t border-theme">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => navigate(`/marketplace/${item.listing.id}`)}
                          className="text-theme-primary hover:text-cobalt-500 dark:hover:text-cobalt-300 transition-colors font-medium flex items-center gap-1"
                        >
                          {item.listing.title}
                          <ExternalLink size={10} />
                        </button>
                        <div className="flex items-center gap-2 mt-0.5">
                          <TierBadge tier={item.listing.seller.tier} size="sm" showLabel={false} />
                          <span className="text-xs text-theme-tertiary">{item.listing.seller.displayName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                          item.listing.type === 'skill'
                            ? 'bg-cobalt-500/10 text-cobalt-500 dark:text-cobalt-300'
                            : 'bg-teal-500/15 text-teal-400'
                        )}>
                          {item.listing.type === 'skill' ? 'Skill' : 'Dataset'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                          item.status === 'active'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : item.status === 'pending_review'
                              ? 'bg-amber-500/15 text-amber-400'
                              : 'bg-theme-elevated text-theme-tertiary'
                        )}>
                          {item.status === 'active' ? 'Active' : item.status === 'pending_review' ? 'In Review' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-theme-secondary">
                        {item.totalDownloads.toLocaleString(UI_DATE_LOCALE)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-theme-primary">
                        {formatCredits(item.totalRevenue)} cr
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Download Modal */}
      {downloadListing && (
        <MarketplaceDownloadModal
          listing={downloadListing}
          open={!!downloadListing}
          onClose={() => setDownloadListing(null)}
        />
      )}

      {/* Publish Dialog */}
      <MarketplacePublishDialog
        open={showPublishDialog}
        onClose={() => setShowPublishDialog(false)}
        onSubmit={async (input) => {
          await createListing(input);
        }}
        isSubmitting={isCreatingListing}
      />
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(UI_DATE_LOCALE);
}
