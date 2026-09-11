/**
 * @file MarketplaceLicenseTierSelector.tsx
 * @description License tier picker for a marketplace purchase — a radio group of inset rows
 * @feature marketplace
 */

import { cn } from '@/shared/utils/cn';
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
    <div role="radiogroup" aria-label="License tier" className="flex flex-col gap-2">
      {tiers.map((tier) => {
        const isSelected = selected === tier.tier;
        const missing = tier.priceCredits - userCredits;

        return (
          <button
            key={tier.tier}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(tier.tier)}
            className={cn(
              'w-full rounded-control border p-3 text-left transition-colors duration-150',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              isSelected
                ? 'border-primary bg-primary/10'
                : 'border-line bg-inset hover:border-line-strong'
            )}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    isSelected ? 'border-primary' : 'border-line-strong'
                  )}
                >
                  {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="text-sm font-medium text-ink-primary">{tier.label}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums text-ink-primary">
                {formatCredits(tier.priceCredits)} credits
              </span>
            </span>
            {tier.description && (
              <span className="mt-1 block pl-6 text-xs text-ink-tertiary">{tier.description}</span>
            )}
            {missing > 0 && (
              <span className="mt-1 block pl-6 text-xs text-signal-unknown">
                {formatCredits(missing)} more credits needed
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
