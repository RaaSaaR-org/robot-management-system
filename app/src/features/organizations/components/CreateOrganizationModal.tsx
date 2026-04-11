/**
 * @file CreateOrganizationModal.tsx
 * @description Modal with a two-field form (name + slug) for creating a
 * tenant. Slug auto-fills from name until the user manually edits it.
 * @feature organizations
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { useOrganizationsStore } from '../store/organizationsStore';

interface CreateOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional initial values — used for the "Load sample" quick action. */
  prefill?: { name: string; slug: string };
  /** Called after successful create, useful for toasts/navigation. */
  onCreated?: (name: string) => void;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function CreateOrganizationModal({
  isOpen,
  onClose,
  prefill,
  onCreated,
}: CreateOrganizationModalProps) {
  const create = useOrganizationsStore((s) => s.create);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset / apply prefill whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setName(prefill?.name ?? '');
    setSlug(prefill?.slug ?? '');
    setSlugEdited(Boolean(prefill?.slug));
    setError(null);
    setSubmitting(false);
  }, [isOpen, prefill]);

  // Auto-sync slug from name until the user overrides it.
  useEffect(() => {
    if (slugEdited) return;
    setSlug(slugify(name));
  }, [name, slugEdited]);

  const handleSlugChange = (value: string) => {
    setSlugEdited(true);
    setSlug(value);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Organization name is required.');
      return;
    }

    const finalSlug = slug.trim() || slugify(trimmedName);
    if (!SLUG_PATTERN.test(finalSlug)) {
      setError('Slug must be lowercase letters, numbers, and hyphens (e.g. "acme-robotics").');
      return;
    }

    setSubmitting(true);
    try {
      await create({ name: trimmedName, slug: finalSlug });
      onCreated?.(trimmedName);
      onClose();
    } catch (err) {
      // The API client throws a plain `ApiError` object ({ message, code,
      // statusCode }), not a native Error instance. Extract .message
      // defensively from whichever shape we got so the user sees the
      // server's actual "Slug already in use" text instead of a generic
      // fallback.
      const message =
        (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
          ? (err as { message: string }).message
          : null) ||
        (err instanceof Error ? err.message : null) ||
        'Failed to create organization. Try a different slug.';
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? () => {} : onClose}
      title="Create organization"
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
            loadingText="Creating..."
          >
            Create organization
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Organization name"
          placeholder="Acme Robotics"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          fullWidth
          disabled={submitting}
        />
        <Input
          label="URL slug"
          placeholder="acme-robotics"
          helperText="Lowercase letters, numbers, and hyphens only. Used in URLs + IDs."
          value={slug}
          onChange={(e) => handleSlugChange(e.target.value)}
          fullWidth
          disabled={submitting}
        />
        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-brand px-3 py-2">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
