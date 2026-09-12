/**
 * @file SecuritySettings.tsx
 * @description Two-step verification panel: status, set up in a kit Modal, turn off via confirm
 * @feature auth
 * @regulatory NIS2 Art. 21(2)(j)
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button, ErrorState, Modal, Panel, SkeletonText, StatusTag, confirm, errorMessage, toast } from '@/shared/components/ui';
import { authApi } from '../api/authApi';
import type { MFAStatus } from '../types/auth.types';
import { MFASetup } from './MFASetup';

export function SecuritySettings() {
  const [mfaStatus, setMfaStatus] = useState<MFAStatus | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [turningOff, setTurningOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setMfaStatus(await authApi.mfaGetStatus());
    } catch (err) {
      setError(errorMessage(err, 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const turnOff = async () => {
    const ok = await confirm({
      tone: 'danger',
      title: 'Turn off two-step verification?',
      description: 'Your account is then protected by your password only.',
      confirmLabel: 'Turn off',
    });
    if (!ok) return;
    setTurningOff(true);
    try {
      await authApi.mfaDisableTotp();
      toast.success('Two-step verification turned off');
      await fetchStatus();
    } catch (err) {
      toast.error("Couldn't turn off two-step verification", {
        description: errorMessage(err),
      });
    } finally {
      setTurningOff(false);
    }
  };

  const enabled = Boolean(mfaStatus?.mfaEnabled);

  return (
    <Panel>
      <Panel.Header
        title="Two-step verification"
        description="A code from an authenticator app, asked for after your password."
        actions={
          !isLoading && !error ? (
            <StatusTag tone={enabled ? 'live' : 'neutral'} dot>
              {enabled ? 'On' : 'Off'}
            </StatusTag>
          ) : undefined
        }
      />
      <Panel.Body>
        {isLoading ? (
          <SkeletonText lines={2} />
        ) : error ? (
          <ErrorState size="sm" title="Couldn't load the verification status" message={error} onRetry={fetchStatus} />
        ) : enabled ? (
          <p className="text-sm text-ink-secondary">
            Your account asks for a code from your authenticator app at every sign-in.
          </p>
        ) : (
          <p className="text-sm text-ink-secondary">
            Add a second step at sign-in with an authenticator app such as 1Password, Authy or Google Authenticator.
          </p>
        )}
      </Panel.Body>
      {!isLoading && !error && (
        <Panel.Footer>
          {enabled ? (
            <Button variant="danger" isLoading={turningOff} onClick={() => void turnOff()}>
              Turn off
            </Button>
          ) : (
            <Button
              variant="secondary"
              leftIcon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />}
              onClick={() => setSetupOpen(true)}
            >
              Set up two-step verification
            </Button>
          )}
        </Panel.Footer>
      )}

      <Modal
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        title="Set up two-step verification"
        size="md"
        closeOnBackdrop={false}
      >
        <MFASetup
          onCancel={() => setSetupOpen(false)}
          onComplete={() => {
            setSetupOpen(false);
            toast.success('Two-step verification is on');
            void fetchStatus();
          }}
        />
      </Modal>
    </Panel>
  );
}
