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
import { TierBadge } from '../components/TierBadge';
import { CreditBalance } from '../components/CreditBalance';
import { MarketplaceDownloadModal } from '../components/MarketplaceDownloadModal';
import { MarketplacePublishDialog } from '../components/MarketplacePublishDialog';
import { formatCredits } from '../types/contributions.types';
import { LICENSE_TIER_LABELS } from '../types/marketplace.types';
import type { MarketplaceListing } from '../types/marketplace.types';
import { useMyMarketplace } from '../hooks/marketplace';

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
    <div className="min-h-screen bg-[#0f1012]">
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Back */}
        <button
          type="button"
          onClick={() => navigate('/marketplace')}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Marketplace
        </button>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">My Marketplace</h1>
          <CreditBalance totalCredits={creditBalance ?? 0} />
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/30">
            <AlertTriangle size={18} className="text-red-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-400">Failed to load your marketplace data</p>
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

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 mb-6 w-fit">
          <button
            type="button"
            onClick={() => setTab('purchases')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              tab === 'purchases' ? 'bg-[#FF6700] text-white' : 'text-gray-400 hover:text-white'
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
              tab === 'listings' ? 'bg-[#FF6700] text-white' : 'text-gray-400 hover:text-white'
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
              <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-[#1a1b1f] border border-white/10">
                <div className="w-10 h-10 rounded-lg bg-white/10 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="h-4 w-1/3 rounded bg-white/10 mb-2" />
                  <div className="h-3 w-1/2 rounded bg-white/5" />
                </div>
                <div className="w-24 h-9 rounded-lg bg-white/5 shrink-0" />
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
                className="flex items-center gap-4 p-4 rounded-xl bg-[#1a1b1f] border border-white/10"
              >
                <div className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                  purchase.listing.type === 'skill'
                    ? 'bg-[#FF6700]/15 text-[#FF6700]'
                    : 'bg-teal-500/15 text-teal-400'
                )}>
                  {purchase.listing.type === 'skill' ? <Package size={20} /> : <Download size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => navigate(`/marketplace/${purchase.listingId}`)}
                    className="text-sm font-medium text-white hover:text-[#FF6700] transition-colors flex items-center gap-1"
                  >
                    {purchase.listing.title}
                    <ExternalLink size={10} />
                  </button>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    <span>{purchase.listing.type === 'skill' ? 'Skill' : 'Dataset'}</span>
                    <span>{LICENSE_TIER_LABELS[purchase.licenseTier]} license</span>
                    <span>{formatCredits(purchase.creditsSpent)} credits</span>
                    <span>{formatDate(purchase.purchasedAt)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDownloadListing(purchase.listing)}
                  className="px-4 py-2 rounded-lg bg-emerald-600/20 text-emerald-400 text-sm font-medium hover:bg-emerald-600/30 transition-colors flex items-center gap-1.5 shrink-0"
                >
                  <Download size={14} />
                  Download
                </button>
              </div>
            ))}

            {purchases.length === 0 && (
              <div className="text-center py-16 rounded-xl bg-white/[0.02] border border-white/5">
                <ShoppingBag size={40} className="mx-auto text-gray-600 mb-3" />
                <p className="text-gray-400 mb-2">No purchases yet</p>
                <button
                  type="button"
                  onClick={() => navigate('/marketplace')}
                  className="text-sm text-[#FF6700] hover:underline"
                >
                  Browse the Marketplace
                </button>
              </div>
            )}
          </div>
        )}

        {/* My Listings */}
        {!showSkeleton && tab === 'listings' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-400">
                {myListings.length} {myListings.length === 1 ? 'listing' : 'listings'}
              </p>
              <button
                type="button"
                onClick={() => setShowPublishDialog(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FF6700] text-white text-sm font-medium hover:bg-[#e05d00] transition-colors"
              >
                <Plus size={14} />
                List a Skill or Dataset
              </button>
            </div>

            {myListings.length === 0 ? (
              <div className="text-center py-16 rounded-xl bg-white/[0.02] border border-white/5">
                <Package size={40} className="mx-auto text-gray-600 mb-3" />
                <p className="text-gray-400 mb-2">You haven't listed anything yet</p>
                <button
                  type="button"
                  onClick={() => setShowPublishDialog(true)}
                  className="text-sm text-[#FF6700] hover:underline"
                >
                  Publish your first skill or dataset
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white/5">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Listing</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Downloads</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myListings.map((item) => (
                      <tr key={item.listing.id} className="border-t border-white/5">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => navigate(`/marketplace/${item.listing.id}`)}
                            className="text-white hover:text-[#FF6700] transition-colors font-medium flex items-center gap-1"
                          >
                            {item.listing.title}
                            <ExternalLink size={10} />
                          </button>
                          <div className="flex items-center gap-2 mt-0.5">
                            <TierBadge tier={item.listing.seller.tier} size="sm" showLabel={false} />
                            <span className="text-xs text-gray-500">{item.listing.seller.displayName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                            item.listing.type === 'skill'
                              ? 'bg-[#FF6700]/15 text-[#FF6700]'
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
                                : 'bg-gray-500/15 text-gray-400'
                          )}>
                            {item.status === 'active' ? 'Active' : item.status === 'pending_review' ? 'In Review' : 'Draft'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-300">
                          {item.totalDownloads.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-white">
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
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}
