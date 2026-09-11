/**
 * @file PublishPriceTiers.tsx
 * @description License tier pricing rows for the Publish listing form (checkbox + credit price)
 * @feature marketplace
 */

import { Checkbox, Input } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { LICENSE_TIER_LABELS, type MarketplaceLicenseTier } from '../types/marketplace.types';

export const LICENSE_TIERS: MarketplaceLicenseTier[] = ['research', 'per_robot', 'per_fleet', 'enterprise'];

export const TIER_DESCRIPTIONS: Record<MarketplaceLicenseTier, string> = {
  research: 'Non-commercial use only',
  per_robot: 'One robot instance',
  per_fleet: 'Unlimited robots in one org',
  enterprise: 'Unlimited, with redistribution rights',
};

export interface TierFormState {
  enabled: boolean;
  priceCredits: string;
}

export const INITIAL_TIERS: Record<MarketplaceLicenseTier, TierFormState> = {
  research: { enabled: true, priceCredits: '200' },
  per_robot: { enabled: false, priceCredits: '' },
  per_fleet: { enabled: false, priceCredits: '' },
  enterprise: { enabled: false, priceCredits: '' },
};

export interface PublishPriceTiersProps {
  tiers: Record<MarketplaceLicenseTier, TierFormState>;
  onChange: (tier: MarketplaceLicenseTier, update: Partial<TierFormState>) => void;
  /** Per-tier price errors */
  errors: Partial<Record<MarketplaceLicenseTier, string>>;
}

export function PublishPriceTiers({ tiers, onChange, errors }: PublishPriceTiersProps) {
  return (
    <div className="flex flex-col gap-2">
      {LICENSE_TIERS.map((tier) => {
        const state = tiers[tier];
        const error = errors[tier];
        return (
          <div
            key={tier}
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-control border p-3',
              state.enabled ? 'border-line-strong bg-inset' : 'border-line-subtle bg-inset'
            )}
          >
            <Checkbox
              className="min-w-0 flex-1"
              label={LICENSE_TIER_LABELS[tier]}
              description={TIER_DESCRIPTIONS[tier]}
              checked={state.enabled}
              onChange={(e) => onChange(tier, { enabled: e.target.checked })}
            />
            <div className="flex shrink-0 items-center gap-2">
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                aria-label={`${LICENSE_TIER_LABELS[tier]} price in credits`}
                aria-invalid={error ? true : undefined}
                invalid={Boolean(error)}
                value={state.priceCredits}
                disabled={!state.enabled}
                onChange={(e) => onChange(tier, { priceCredits: e.target.value })}
                placeholder="0"
                size="sm"
                fullWidth={false}
                className="w-24 text-right"
              />
              <span className="text-xs text-ink-tertiary">credits</span>
            </div>
            {error && (
              <p role="alert" className="w-full text-xs text-signal-stopped">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
