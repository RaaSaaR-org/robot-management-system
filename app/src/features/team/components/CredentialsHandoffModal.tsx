/**
 * @file CredentialsHandoffModal.tsx
 * @description One-time display of the newly-added teammate's credentials.
 * The temporary password is shown exactly once; once this modal closes the
 * owner cannot recover it via the UI. This is intentional — matches the
 * "hand off out-of-band" contract from TASK-163.
 * @feature team
 */

import { useState } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import type { TeamMember } from '../types/team.types';

interface CredentialsHandoffModalProps {
  isOpen: boolean;
  member: TeamMember | null;
  tempPassword: string | null;
  onClose: () => void;
  /** Override the credential label (default: "Temporary password"). */
  credentialLabel?: string;
  /** Override the copy button text (default: "Copy email + password"). */
  copyLabel?: string;
}

export function CredentialsHandoffModal({
  isOpen,
  member,
  tempPassword,
  onClose,
  credentialLabel = 'Temporary password',
  copyLabel = 'Copy email + password',
}: CredentialsHandoffModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyAll = async () => {
    if (!member || !tempPassword) return;
    const text = `Email: ${member.email}\nPassword: ${tempPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may not be available — swallow.
    }
  };

  if (!member || !tempPassword) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Share these credentials"
      size="md"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <Button variant="ghost" size="sm" onClick={handleCopyAll}>
            {copied ? 'Copied!' : copyLabel}
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-brand border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <strong className="font-semibold">This password will not be shown again.</strong>{' '}
          Copy it now and send it to {member.name} via a secure channel.
        </div>

        <div className="rounded-brand border border-theme bg-theme-card p-4 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-theme-tertiary mb-1">
              Email
            </div>
            <div className="font-mono text-sm text-theme-primary select-all">
              {member.email}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-theme-tertiary mb-1">
              {credentialLabel}
            </div>
            <div className="font-mono text-sm text-theme-primary select-all break-all">
              {tempPassword}
            </div>
          </div>
        </div>

        <p className="text-xs text-theme-tertiary">
          {member.name} will be asked to choose a new password on first login.
        </p>
      </div>
    </Modal>
  );
}
