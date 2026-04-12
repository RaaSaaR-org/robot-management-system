/**
 * @file AddTeamMemberModal.tsx
 * @description Modal for adding a new teammate to the current tenant.
 * Generates a temporary password client-side so the owner sees a sensible
 * suggestion, but the server authoritatively generates one if the field
 * is blank. On success, hands the result up to the page which then shows
 * the credentials handoff modal.
 * @feature team
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { useTeamStore } from '../store/teamStore';
import type {
  AssignableRole,
  AddTeamMemberResult,
} from '../types/team.types';

interface AddTeamMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: (result: AddTeamMemberResult) => void;
}

const ROLE_OPTIONS: Array<{
  value: AssignableRole;
  label: string;
  description: string;
}> = [
  { value: 'owner', label: 'Owner', description: 'Full control: team, settings, data' },
  { value: 'member', label: 'Member', description: 'Operate robots, run training' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only dashboards + metrics' },
];

/**
 * Client-side temp password suggestion. Mirrors the server generator in
 * shape (12 chars, mixed) but is non-authoritative — the server re-runs
 * its own generator if this field is empty on submit.
 */
function suggestTempPassword(): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = lower + upper + digits + symbols;
  function pick(set: string): string {
    return set[Math.floor(Math.random() * set.length)];
  }
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function AddTeamMemberModal({
  isOpen,
  onClose,
  onAdded,
}: AddTeamMemberModalProps) {
  const add = useTeamStore((s) => s.add);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('member');
  const [tempPassword, setTempPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setEmail('');
    setRole('member');
    setTempPassword(suggestTempPassword());
    setError(null);
    setSubmitting(false);
  }, [isOpen]);

  const handleRegenerate = () => setTempPassword(suggestTempPassword());

  const handleCopyPassword = async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
    } catch {
      // Clipboard may be unavailable in some contexts — fall through silently.
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedName || !trimmedEmail) {
      setError('Name and email are required.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await add({
        name: trimmedName,
        email: trimmedEmail,
        role,
        tempPassword: tempPassword || undefined,
      });
      onAdded(result);
      onClose();
    } catch (err) {
      const message =
        (err &&
        typeof err === 'object' &&
        'message' in err &&
        typeof (err as { message: unknown }).message === 'string'
          ? (err as { message: string }).message
          : null) ||
        (err instanceof Error ? err.message : null) ||
        'Failed to add teammate.';
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? () => {} : onClose}
      title="Add teammate"
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            isLoading={submitting}
            loadingText="Adding..."
          >
            Add teammate
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Full name"
          placeholder="Alice Smith"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          fullWidth
          disabled={submitting}
        />
        <Input
          label="Email"
          type="email"
          placeholder="alice@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          fullWidth
          disabled={submitting}
        />

        <div>
          <label className="block text-sm font-medium text-theme-primary mb-2">
            Role
          </label>
          <div className="grid grid-cols-3 gap-2">
            {ROLE_OPTIONS.map((opt) => {
              const active = role === opt.value;
              return (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setRole(opt.value)}
                  disabled={submitting}
                  className={`rounded-brand border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-brand bg-brand/10 text-theme-primary'
                      : 'border-theme bg-theme-card text-theme-secondary hover:text-theme-primary'
                  }`}
                >
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="text-xs text-theme-tertiary mt-0.5">
                    {opt.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-theme-primary mb-2">
            Temporary password
          </label>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Generated automatically"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              fullWidth
              disabled={submitting}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRegenerate}
              disabled={submitting}
            >
              Regenerate
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopyPassword}
              disabled={submitting || !tempPassword}
            >
              Copy
            </Button>
          </div>
          <p className="text-xs text-theme-tertiary mt-1">
            Hand this to your teammate out-of-band (Slack, in person). They'll
            be asked to set their own password on first login.
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-brand px-3 py-2">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
