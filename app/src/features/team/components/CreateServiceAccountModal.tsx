/**
 * @file CreateServiceAccountModal.tsx
 * @description Modal for creating a new service account (TASK-165).
 * @feature team
 */

import { useState, useEffect } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import type {
  AssignableServiceRole,
  ServiceAccount,
} from '../types/serviceAccount.types';
import { useServiceAccountsStore } from '../store/serviceAccountsStore';

interface CreateServiceAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (account: ServiceAccount) => void;
}

const ROLES: { value: AssignableServiceRole; label: string; desc: string }[] = [
  {
    value: 'member',
    label: 'Member',
    desc: 'Can operate robots, run training, create datasets',
  },
  {
    value: 'viewer',
    label: 'Viewer',
    desc: 'Read-only access to dashboards and status',
  },
];

export function CreateServiceAccountModal({
  isOpen,
  onClose,
  onCreated,
}: CreateServiceAccountModalProps) {
  const create = useServiceAccountsStore((s) => s.create);

  const [name, setName] = useState('');
  const [role, setRole] = useState<AssignableServiceRole>('member');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setRole('member');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const account = await create({ name: name.trim(), role });
      onCreated(account);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to create service account'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create service account"
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
            loadingText="Creating…"
          >
            Create
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Name"
          placeholder="e.g. kira-agent, github-actions"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          fullWidth
          autoFocus
        />

        <div>
          <label className="block text-sm font-medium text-theme-secondary mb-2">
            Role
          </label>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRole(r.value)}
                disabled={submitting}
                className={`text-left px-3 py-2 rounded-brand border transition-colors ${
                  role === r.value
                    ? 'border-brand bg-brand/10 text-theme-primary'
                    : 'border-theme text-theme-secondary hover:border-theme-hover'
                }`}
              >
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-xs text-theme-tertiary mt-0.5">{r.desc}</div>
              </button>
            ))}
          </div>
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
