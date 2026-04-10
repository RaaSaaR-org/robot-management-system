/**
 * @file MarketplaceDetailPage.tsx
 * @description Detail page for a marketplace listing with license purchase flow
 * @feature marketplace
 */

import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Brain, Database, Cpu, TrendingUp, Download,
  CheckCircle, Shield, Play, FileText, Clock,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { TierBadge } from '../components/TierBadge';
import { MarketplaceStarRating } from '../components/MarketplaceStarRating';
import { MarketplaceLicenseTierSelector } from '../components/MarketplaceLicenseTierSelector';
import { MarketplaceDownloadModal } from '../components/MarketplaceDownloadModal';
import { formatCredits } from '../types/contributions.types';
import { MOCK_LISTINGS, MOCK_MY_PURCHASES, MOCK_MY_CREDIT_BALANCE } from '../mockMarketplaceData';
import type { MarketplaceLicenseTier } from '../types/marketplace.types';

export function MarketplaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const listing = useMemo(() => MOCK_LISTINGS.find((l) => l.id === id), [id]);
  const alreadyPurchased = useMemo(() => MOCK_MY_PURCHASES.some((p) => p.listingId === id), [id]);

  const [selectedTier, setSelectedTier] = useState<MarketplaceLicenseTier | null>(null);
  const [justPurchased, setJustPurchased] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);

  if (!listing) {
    return (
      <div className="min-h-screen bg-[#0f1012] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">Listing not found</p>
          <button type="button" onClick={() => navigate('/marketplace')} className="text-[#FF6700] hover:underline">
            Back to Marketplace
          </button>
        </div>
      </div>
    );
  }

  const isSkill = listing.type === 'skill';
  const selectedPrice = listing.priceTiers.find((t) => t.tier === selectedTier)?.priceCredits ?? 0;
  const purchased = alreadyPurchased || justPurchased;

  return (
    <div className="min-h-screen bg-[#0f1012]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Back */}
        <button
          type="button"
          onClick={() => navigate('/marketplace')}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Marketplace
        </button>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left column */}
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                  isSkill ? 'bg-[#FF6700]/15 text-[#FF6700]' : 'bg-teal-500/15 text-teal-400'
                )}
              >
                {isSkill ? <Brain size={12} /> : <Database size={12} />}
                {isSkill ? 'Skill' : 'Dataset'}
              </span>
              {listing.isTrending && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400">
                  <TrendingUp size={10} />
                  Trending
                </span>
              )}
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">{listing.title}</h1>
            <p className="text-gray-400 mb-4">{listing.shortDescription}</p>

            {/* Seller */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10 mb-6">
              <span className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-gray-300">
                {listing.seller.avatarInitials}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{listing.seller.displayName}</span>
                  <TierBadge tier={listing.seller.tier} size="sm" />
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <MarketplaceStarRating rating={listing.seller.rating} size="sm" />
                  <span>{listing.seller.totalSales} sales</span>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-white mb-2">Description</h2>
              <div className="text-sm text-gray-400 whitespace-pre-line leading-relaxed">
                {listing.fullDescription}
              </div>
            </div>

            {/* Preview / Stats */}
            {isSkill ? (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-white mb-3">Skill Preview</h2>
                <div className="rounded-lg bg-white/5 border border-white/10 aspect-video flex items-center justify-center mb-4">
                  <div className="text-center">
                    <Play size={40} className="mx-auto text-gray-600 mb-2" />
                    <p className="text-sm text-gray-500">Demo video coming soon</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Success Rate" value={`${listing.successRate ?? 0}%`} />
                  <StatCard label="Adapter Size" value={`${listing.adapterSizeMB ?? 0} MB`} />
                  <StatCard label="Robot Type" value={listing.robotType} />
                  <StatCard label="Base Model" value={listing.baseModel} />
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-white mb-3">Dataset Info</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Episodes" value={(listing.episodeCount ?? 0).toLocaleString()} />
                  <StatCard label="Frames" value={(listing.frameCount ?? 0).toLocaleString()} />
                  <StatCard label="Size" value={`${listing.datasetSizeGB ?? 0} GB`} />
                  <StatCard label="Collection" value={listing.collectionMethod ?? 'N/A'} />
                </div>
              </div>
            )}

            {/* Tags */}
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-white mb-2">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {listing.tags.map((tag) => (
                  <span key={tag} className="px-2.5 py-1 rounded-full bg-white/5 text-xs text-gray-300 border border-white/5">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Technical Specs */}
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-white mb-3">Technical Specs</h2>
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    <SpecRow label="Type" value={isSkill ? 'LoRA Adapter (.safetensors)' : 'Dataset (LeRobot v3)'} />
                    <SpecRow label="Robot" value={listing.robotType} />
                    {listing.baseModel !== 'None' && <SpecRow label="Base Model" value={listing.baseModel} />}
                    <SpecRow label="Downloads" value={listing.downloadCount.toLocaleString()} />
                    <SpecRow label="Published" value={listing.createdAt} />
                  </tbody>
                </table>
              </div>
            </div>

            {/* Reviews */}
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-white mb-3">
                Reviews ({listing.reviewCount})
              </h2>
              <div className="space-y-3">
                {listing.reviews.map((review) => (
                  <div key={review.id} className="p-4 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{review.authorName}</span>
                        <TierBadge tier={review.authorTier} size="sm" showLabel={false} />
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Cpu size={10} />
                          {review.robotType}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Clock size={10} />
                        {review.createdAt}
                      </span>
                    </div>
                    <MarketplaceStarRating rating={review.rating} size="sm" className="mb-2" />
                    <p className="text-sm text-gray-300">{review.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right sidebar */}
          <div className="w-full lg:w-80 shrink-0">
            <div className="lg:sticky lg:top-6 rounded-xl bg-[#1a1b1f] border border-white/10 p-5">
              {purchased ? (
                <div className="text-center py-4">
                  <CheckCircle size={40} className="mx-auto text-emerald-400 mb-3" />
                  <h3 className="text-lg font-semibold text-white mb-1">
                    {justPurchased ? 'Purchase Complete!' : 'Already Purchased'}
                  </h3>
                  <p className="text-sm text-gray-400 mb-4">
                    {justPurchased
                      ? 'Your download is ready.'
                      : 'You already own a license for this item.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowDownloadModal(true)}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Download size={16} />
                    Download {isSkill ? 'Adapter' : 'Dataset'}
                  </button>
                </div>
              ) : (
                <>
                  <h3 className="text-base font-semibold text-white mb-4">Purchase License</h3>

                  <MarketplaceLicenseTierSelector
                    tiers={listing.priceTiers}
                    selected={selectedTier}
                    onChange={setSelectedTier}
                    userCredits={MOCK_MY_CREDIT_BALANCE}
                  />

                  <button
                    type="button"
                    disabled={!selectedTier || MOCK_MY_CREDIT_BALANCE < selectedPrice}
                    onClick={() => setJustPurchased(true)}
                    className={cn(
                      'w-full mt-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
                      selectedTier && MOCK_MY_CREDIT_BALANCE >= selectedPrice
                        ? 'bg-[#FF6700] text-white hover:bg-[#e05d00]'
                        : 'bg-white/10 text-gray-500 cursor-not-allowed'
                    )}
                  >
                    <FileText size={16} />
                    {selectedTier
                      ? `Purchase — ${formatCredits(selectedPrice)} credits`
                      : 'Select a license tier'}
                  </button>

                  <div className="mt-4 pt-4 border-t border-white/10">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                      <span>Your balance</span>
                      <span className="text-white font-medium">{formatCredits(MOCK_MY_CREDIT_BALANCE)} credits</span>
                    </div>
                  </div>
                </>
              )}

              {/* Sovereignty note */}
              <div className="mt-4 p-3 rounded-lg bg-[#FF6700]/5 border border-[#FF6700]/20">
                <div className="flex items-start gap-2">
                  <Shield size={14} className="text-[#FF6700] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-[#FF6700] mb-0.5">Data Sovereignty</p>
                    <p className="text-xs text-gray-400">
                      Files are downloaded to your infrastructure. No cloud dependency, no phone-home. Run on your own hardware.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Download Modal */}
        <MarketplaceDownloadModal
          listing={listing}
          open={showDownloadModal}
          onClose={() => setShowDownloadModal(false)}
        />
      </div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-white/5 border border-white/10">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="px-4 py-2.5 text-gray-500 font-medium">{label}</td>
      <td className="px-4 py-2.5 text-white text-right">{value}</td>
    </tr>
  );
}
