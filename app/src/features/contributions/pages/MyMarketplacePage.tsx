/**
 * @file MyMarketplacePage.tsx
 * @description User's purchases and listings in the marketplace
 * @feature marketplace
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, ShoppingBag, Package, Plus, ExternalLink } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { TierBadge } from '../components/TierBadge';
import { CreditBalance } from '../components/CreditBalance';
import { MarketplaceDownloadModal } from '../components/MarketplaceDownloadModal';
import { formatCredits } from '../types/contributions.types';
import { LICENSE_TIER_LABELS } from '../types/marketplace.types';
import type { MarketplaceListing } from '../types/marketplace.types';
import { MOCK_MY_PURCHASES, MOCK_MY_LISTINGS, MOCK_MY_CREDIT_BALANCE } from '../mockMarketplaceData';

type Tab = 'purchases' | 'listings';

export function MyMarketplacePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('purchases');
  const [downloadListing, setDownloadListing] = useState<MarketplaceListing | null>(null);

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
          <CreditBalance totalCredits={MOCK_MY_CREDIT_BALANCE} />
        </div>

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
            <span className="text-xs opacity-60">{MOCK_MY_PURCHASES.length}</span>
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
            <span className="text-xs opacity-60">{MOCK_MY_LISTINGS.length}</span>
          </button>
        </div>

        {/* Purchases */}
        {tab === 'purchases' && (
          <div className="space-y-3">
            {MOCK_MY_PURCHASES.map((purchase) => (
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
                    <span>{purchase.purchasedAt}</span>
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

            {MOCK_MY_PURCHASES.length === 0 && (
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
        {tab === 'listings' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-400">{MOCK_MY_LISTINGS.length} active listings</p>
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FF6700] text-white text-sm font-medium hover:bg-[#e05d00] transition-colors"
              >
                <Plus size={14} />
                List a Skill or Dataset
              </button>
            </div>

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
                  {MOCK_MY_LISTINGS.map((item) => (
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
      </div>
    </div>
  );
}
