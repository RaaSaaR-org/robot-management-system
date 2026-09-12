/**
 * @file MarketplaceLicensePanel.tsx
 * @description License aside of a listing: tier picker, balance and purchase (or "Licensed" + Download)
 * @feature marketplace
 */

import { forwardRef } from 'react';
import { Download, ShoppingCart } from 'lucide-react';
import { Button, Panel, StatusTag } from '@/shared/components/ui';
import { MarketplaceLicenseTierSelector } from './MarketplaceLicenseTierSelector';
import { formatCredits } from '../types/contributions.types';
import type { LicenseTierPrice, MarketplaceLicenseTier } from '../types/marketplace.types';

export interface MarketplaceLicensePanelProps {
  tiers: LicenseTierPrice[];
  selectedTier: MarketplaceLicenseTier | null;
  onSelectTier: (tier: MarketplaceLicenseTier) => void;
  balance: number;
  owned: boolean;
  isPurchasing: boolean;
  onPurchase: () => void;
  onDownload: () => void;
  className?: string;
}

export const MarketplaceLicensePanel = forwardRef<HTMLDivElement, MarketplaceLicensePanelProps>(
  function MarketplaceLicensePanel(
    { tiers, selectedTier, onSelectTier, balance, owned, isPurchasing, onPurchase, onDownload, className },
    ref
  ) {
    const price = tiers.find((t) => t.tier === selectedTier)?.priceCredits ?? 0;

    return (
      <Panel as="aside" className={className} aria-label="License">
        <div ref={ref} tabIndex={-1} className="outline-none">
          <Panel.Header
            title="License"
            actions={owned ? <StatusTag tone="success">Licensed</StatusTag> : undefined}
          />
        </div>
        <Panel.Body className="flex flex-col gap-4">
          {owned ? (
            <>
              <p className="text-sm text-ink-secondary">
                You hold a license for this listing. Download it as often as you need.
              </p>
              <Button variant="secondary" fullWidth leftIcon={<Download className="h-4 w-4" />} onClick={onDownload}>
                Download
              </Button>
            </>
          ) : (
            <>
              <MarketplaceLicenseTierSelector
                tiers={tiers}
                selected={selectedTier}
                onChange={onSelectTier}
                userCredits={balance}
              />
              <Button
                fullWidth
                leftIcon={<ShoppingCart className="h-4 w-4" />}
                disabled={!selectedTier}
                isLoading={isPurchasing}
                loadingText="Purchasing…"
                onClick={onPurchase}
              >
                {selectedTier ? `Purchase license · ${formatCredits(price)} credits` : 'Choose a license tier'}
              </Button>
            </>
          )}
          <div className="flex items-center justify-between border-t border-line-subtle pt-3 text-[13px]">
            <span className="text-ink-tertiary">Your balance</span>
            <span className="font-medium tabular-nums text-ink-primary">{formatCredits(balance)} credits</span>
          </div>
        </Panel.Body>
      </Panel>
    );
  }
);
