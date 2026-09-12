/**
 * @file OrganizationFormModal.tsx
 * @description The one create/edit form for an organization (name, slug on create, plan,
 * logo URL, brand color). Replaces CreateOrganizationModal + EditOrganizationModal.
 * @feature organizations
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, toast } from '@/shared/components/ui';
import { useOrganizationsStore } from '../store/organizationsStore';
import type { Organization, TenantSettings } from '../types/organizations.types';

export interface OrganizationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** null = create */
  organization: Organization | null;
  /** Prefill for create (the "Load sample" path) */
  prefill?: { name: string; slug: string };
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Pull a readable message out of the API client's plain-object errors. */
export function orgErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

function parseSettings(raw: string): TenantSettings {
  try {
    return JSON.parse(raw) as TenantSettings;
  } catch {
    return {};
  }
}

export function OrganizationFormModal({ isOpen, onClose, organization, prefill }: OrganizationFormModalProps) {
  const create = useOrganizationsStore((s) => s.create);
  const update = useOrganizationsStore((s) => s.update);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [plan, setPlan] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [brandColor, setBrandColor] = useState('');
  const [errors, setErrors] = useState<{ name?: string; slug?: string; brandColor?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(organization?.name ?? prefill?.name ?? '');
    setSlug(organization?.slug ?? prefill?.slug ?? '');
    setPlan(organization?.plan ?? '');
    setLogoUrl(organization?.logoUrl ?? '');
    setBrandColor(organization ? parseSettings(organization.settings).brandColor ?? '' : '');
    setErrors({});
    setFormError(undefined);
  }, [isOpen, organization, prefill]);

  const handleSubmit = async () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Give the organization a name.';
    if (!organization && slug && !SLUG_RE.test(slug)) next.slug = 'Lowercase letters, numbers and dashes only.';
    if (brandColor && !COLOR_RE.test(brandColor.trim())) next.brandColor = 'Use a hex color: # followed by 3 or 6 digits.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setFormError(undefined);
    try {
      if (organization) {
        const settings: TenantSettings = { ...parseSettings(organization.settings) };
        if (brandColor.trim()) settings.brandColor = brandColor.trim();
        else delete settings.brandColor;
        await update(organization.id, {
          name: name.trim(),
          plan: plan.trim() || null,
          logoUrl: logoUrl.trim() || null,
          settings,
        });
        toast.success('Organization updated', { description: name.trim() });
      } else {
        await create({ name: name.trim(), slug: slug.trim() || undefined, plan: plan.trim() || null, logoUrl: logoUrl.trim() || null });
        toast.success('Organization created', { description: name.trim() });
      }
      onClose();
    } catch (err) {
      setFormError(orgErrorMessage(err, organization ? "Couldn't save the organization" : "Couldn't create the organization"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title={organization ? `Edit ${organization.name}` : 'New organization'}
      description={organization ? undefined : 'A tenant with its own users, robots and data. Add its first admin later on the Team page, or use Onboard customer.'}
      submitLabel={organization ? 'Save changes' : 'Create organization'}
      submittingLabel={organization ? 'Saving…' : 'Creating…'}
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Name" required error={errors.name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Robotics" />
      </FormField>
      {organization ? (
        <FormField label="Slug" hint="The slug can't change after creation.">
          <Input value={organization.slug} readOnly disabled className="font-mono" />
        </FormField>
      ) : (
        <FormField label="Slug" aside="Optional" hint="URL-safe id. Left empty, it is made from the name." error={errors.slug}>
          <Input
            value={slug}
            className="font-mono"
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="acme-robotics"
          />
        </FormField>
      )}
      <FormField label="Plan" aside="Optional">
        <Input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. pro" />
      </FormField>
      <FormField label="Logo URL" aside="Optional">
        <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://cdn.example.com/logo.png" />
      </FormField>
      {organization && (
        <FormField label="Brand color" aside="Optional" hint="Replaces the primary color for this tenant's users." error={errors.brandColor}>
          <div className="flex items-center gap-2">
            <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="font-mono" placeholder="Hex color" />
            {COLOR_RE.test(brandColor.trim()) && (
              <span
                aria-hidden="true"
                className="h-9 w-9 shrink-0 rounded-control border border-line"
                style={{ backgroundColor: brandColor.trim() }}
              />
            )}
          </div>
        </FormField>
      )}
    </FormModal>
  );
}
