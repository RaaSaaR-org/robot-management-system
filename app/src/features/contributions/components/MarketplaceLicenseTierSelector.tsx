/**
 * @file MarketplaceLicenseTierSelector.tsx
 * @description License tier selector for marketplace purchases
 * @feature marketplace
 */

import { cn } from '@/shared/utils/cn';
import { Check, Lock } from 'lucide-react';
import { formatCredits } from '../types/contributions.types';
import type { LicenseTierPrice, MarketplaceLicenseTier } from '../types/marketplace.types';

export interface MarketplaceLicenseTierSelectorProps {
  tiers: LicenseTierPrice[];
  selected: MarketplaceLicenseTier | null;
  onChange: (tier: MarketplaceLicenseTier) => void;
  userCredits: number;
}

export function MarketplaceLicenseTierSelector({
  tiers,
  selected,
  onChange,
  userCredits,
}: MarketplaceLicenseTierSelectorProps) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {tiers.map((tier) => {
        const isSelected = selected === tier.tier;
        const canAfford = userCredits >= tier.priceCredits;

        return (
          <button
            key={tier.tier}
            type="button"
            onClick={() => onChange(tier.tier)}
            className={cn(
              'relative w-full text-left rounded-lg border p-3 transition-all',
              isSelected
                ? 'border-[#FF6700] bg-[#FF6700]/10'
                : canAfford
                  ? 'border-white/10 bg-white/5 hover:border-white/20'
                  : 'border-white/5 bg-white/[0.02] opacity-50'
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                {isSelected ? (
                  <div className="w-4 h-4 rounded-full bg-[#FF6700] flex items-center justify-center">
                    <Check size={10} className="text-white" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded-full border border-white/20" />
                )}
                <span className="text-sm font-medium text-white">{tier.label}</span>
              </div>
              <div className="flex items-center gap-1">
                {!canAfford && <Lock size={10} className="text-gray-500" />}
                <span className={cn(
                  'text-sm font-bold',
                  isSelected ? 'text-[#FF6700]' : 'text-white'
                )}>
                  {formatCredits(tier.priceCredits)} cr
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-400 ml-6">{tier.description}</p>
            {!canAfford && (
              <p className="text-xs text-red-400/70 ml-6 mt-1">
                Need {formatCredits(tier.priceCredits - userCredits)} more credits
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
