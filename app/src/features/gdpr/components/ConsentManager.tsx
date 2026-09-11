/**
 * @file ConsentManager.tsx
 * @description Consent preferences as one panel of kit Switch rows; toast on every change
 * @feature gdpr
 */

import { useEffect, useState } from 'react';
import { ErrorState, Panel, SkeletonRows, Switch, toast } from '@/shared/components/ui';
import { errorMessage } from './errorMessage';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import type { UserConsent, ConsentType } from '../types';
import { ConsentTypes, CONSENT_TYPE_LABELS, CONSENT_TYPE_DESCRIPTIONS } from '../types';

export interface ConsentManagerProps {
  consents: UserConsent[];
  /** Persists the change; must reject on failure so the row reverts */
  onToggle: (type: ConsentType, granted: boolean) => Promise<void>;
  onLoad: () => void;
  isLoading?: boolean;
  error?: string | null;
}

function meta(consent: UserConsent | undefined, granted: boolean): string | null {
  const at = granted ? consent?.grantedAt : consent?.revokedAt;
  if (!at) return null;
  return `${granted ? 'Granted' : 'Withdrawn'} ${new Date(at).toLocaleDateString(UI_DATE_LOCALE)}`;
}

export function ConsentManager({ consents, onToggle, onLoad, isLoading = false, error }: ConsentManagerProps) {
  const [pending, setPending] = useState<Partial<Record<ConsentType, boolean>>>({});

  useEffect(() => {
    onLoad();
  }, [onLoad]);

  const change = async (type: ConsentType, granted: boolean) => {
    setPending((p) => ({ ...p, [type]: granted })); // optimistic
    try {
      await onToggle(type, granted);
      toast.success(granted ? 'Consent updated' : 'Consent withdrawn', { description: CONSENT_TYPE_LABELS[type] });
    } catch (err) {
      toast.error("Couldn't update consent", { description: errorMessage(err) });
    } finally {
      setPending((p) => { const next = { ...p }; delete next[type]; return next; }); // revert to the stored value
    }
  };

  return (
    <Panel>
      <Panel.Header title="Consent" description="How your data may be processed. You can change this at any time." />
      {isLoading && consents.length === 0 ? (
        <Panel.Body><SkeletonRows rows={5} columns={2} /></Panel.Body>
      ) : error && consents.length === 0 ? (
        <Panel.Body><ErrorState title="Couldn't load consents" message={error} onRetry={onLoad} /></Panel.Body>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {ConsentTypes.map((type) => {
            const consent = consents.find((c) => c.consentType === type);
            const granted = pending[type] ?? consent?.granted ?? false;
            const when = meta(consent, consent?.granted ?? false);
            return (
              <li key={type} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-primary">{CONSENT_TYPE_LABELS[type]}</div>
                  <div className="text-[13px] text-ink-secondary">{CONSENT_TYPE_DESCRIPTIONS[type]}</div>
                  {when && <div className="mt-1 text-xs text-ink-tertiary">{when}</div>}
                </div>
                <Switch
                  checked={granted}
                  disabled={type in pending}
                  onCheckedChange={(v) => void change(type, v)}
                  aria-label={CONSENT_TYPE_LABELS[type]}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
