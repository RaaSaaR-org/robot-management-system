/**
 * @file ApproveUpdateModal.tsx
 * @description FormModal that approves a pending update package after the
 *              approver has seen its changelog and signature
 * @feature updates
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, KeyValueList, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useUpdatesStore } from '../store/updatesStore';
import type { UpdatePackage } from '../types/updates.types';
import { runUpdateAct } from './updateActs';

export interface ApproveUpdateModalProps {
  /** The package to approve; null keeps the modal closed. */
  pkg: UpdatePackage | null;
  onClose: () => void;
}

export function ApproveUpdateModal({ pkg, onClose }: ApproveUpdateModalProps) {
  const approvePackage = useUpdatesStore((s) => s.approvePackage);
  const userName = useAuthStore((s) => s.user?.name ?? s.user?.email ?? '');
  const [approver, setApprover] = useState('');
  const [approverError, setApproverError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pkg) return;
    setApprover(userName);
    setApproverError(undefined);
    setFormError(undefined);
  }, [pkg, userName]);

  const handleSubmit = async () => {
    if (!pkg) return;
    if (!approver.trim()) {
      setApproverError('Say who approves this package.');
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      await runUpdateAct(() => approvePackage(pkg.id, approver.trim()));
      toast.success('Update approved', { description: `v${pkg.version}` });
      onClose();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={Boolean(pkg)}
      onClose={onClose}
      title={pkg ? `Approve v${pkg.version}?` : 'Approve update'}
      description="Once approved, the package can be deployed to any robot. The approval is logged for compliance."
      submitLabel="Approve update"
      submittingLabel="Approving…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      {pkg && (
        <>
          <p className="whitespace-pre-line text-sm text-ink-secondary">{pkg.changelog}</p>
          <KeyValueList
            columns={1}
            items={[
              { label: 'Signature (Ed25519)', value: `${pkg.signature.slice(0, 32)}…`, mono: true },
              { label: 'Checksum (SHA-256)', value: pkg.checksum, mono: true },
            ]}
          />
        </>
      )}
      <FormField label="Approver" required error={approverError}>
        <Input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Your name or user ID" />
      </FormField>
    </FormModal>
  );
}
