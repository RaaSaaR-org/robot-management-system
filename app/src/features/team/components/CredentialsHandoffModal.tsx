/**
 * @file CredentialsHandoffModal.tsx
 * @description One-time display of a new teammate's temporary password or a new API token.
 * Shown exactly once; after closing it cannot be recovered in the UI (TASK-163 contract).
 * @feature team
 */

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, KeyValueList, Modal, StatusTag } from '@/shared/components/ui';
import type { TeamMember } from '../types/team.types';

interface CredentialsHandoffModalProps {
  isOpen: boolean;
  member: TeamMember | null;
  tempPassword: string | null;
  onClose: () => void;
  /** Override the credential label (default: "Temporary password"). */
  credentialLabel?: string;
  /** Override the copy button text (default: "Copy email and password"). */
  copyLabel?: string;
  /** Override the warning text */
  warningText?: string;
  /** Override the helper text under the credential */
  helperText?: string;
  /** Title override */
  title?: string;
}

export function CredentialsHandoffModal({
  isOpen,
  member,
  tempPassword,
  onClose,
  credentialLabel = 'Temporary password',
  copyLabel = 'Copy email and password',
  warningText,
  helperText,
  title = 'Share these credentials',
}: CredentialsHandoffModalProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  if (!member || !tempPassword) return null;
  const isToken = credentialLabel !== 'Temporary password';

  const copy = async () => {
    const text = isToken ? tempPassword : `Email: ${member.email}\nPassword: ${tempPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="md"
      closeOnBackdrop={false}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <StatusTag tone="gated" className="self-start sm:self-auto">Shown once</StatusTag>
          <p className="text-[13px] text-ink-secondary">
            {warningText ?? `Copy it now and send it to ${member.name} over a secure channel.`}
          </p>
        </div>
        <div className="rounded-control border border-line-subtle bg-inset p-4">
          <KeyValueList
            columns={1}
            items={[
              ...(isToken ? [{ label: 'Service account', value: member.name }] : [{ label: 'Email', value: member.email, mono: true }]),
              { label: credentialLabel, value: <span className="select-all break-all">{tempPassword}</span>, mono: true },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            leftIcon={copied ? <Check className="h-4 w-4" strokeWidth={1.75} /> : <Copy className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => void copy()}
          >
            {copied ? 'Copied' : copyLabel}
          </Button>
          {copyFailed && <span className="text-[13px] text-ink-tertiary">Clipboard unavailable — select the value and copy it.</span>}
        </div>
        <p className="text-xs text-ink-tertiary">
          {helperText ?? `${member.name} is asked to choose a new password at first sign-in.`}
        </p>
      </div>
    </Modal>
  );
}
