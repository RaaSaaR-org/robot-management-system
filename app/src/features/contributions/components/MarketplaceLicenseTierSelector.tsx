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
              'relative w-full text-left rounded-brand border p-3 transition-all',
              isSelected
                ? 'border-cobalt-500 bg-cobalt-500/10'
                : canAfford
                  ? 'border-theme bg-theme-elevated hover:border-theme-strong'
                  : 'border-theme bg-theme-elevated opacity-50'
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                {isSelected ? (
                  <div className="w-4 h-4 rounded-full bg-cobalt-500 flex items-center justify-center">
                    <Check size={10} className="text-white" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded-full border border-theme-strong" />
                )}
                <span className="text-sm font-medium text-theme-primary">{tier.label}</span>
              </div>
              <div className="flex items-center gap-1">
                {!canAfford && <Lock size={10} className="text-theme-tertiary" />}
                <span className={cn(
                  'text-sm font-bold',
                  isSelected ? 'text-cobalt-500 dark:text-cobalt-300' : 'text-theme-primary'
                )}>
                  {formatCredits(tier.priceCredits)} cr
                </span>
              </div>
            </div>
            <p className="text-xs text-theme-secondary ml-6">{tier.description}</p>
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
