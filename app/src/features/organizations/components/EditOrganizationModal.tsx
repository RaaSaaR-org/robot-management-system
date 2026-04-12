/**
 * @file EditOrganizationModal.tsx
 * @description Modal for editing tenant branding: name, logo URL, plan,
 * and brand color. Tabs: Basics / Branding.
 * @feature organizations
 */

import { useEffect, useState } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { useOrganizationsStore } from '../store/organizationsStore';
import type { Organization, TenantSettings } from '../types/organizations.types';

interface EditOrganizationModalProps {
  organization: Organization | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (name: string) => void;
}

type Tab = 'basics' | 'branding';

function parseSettings(raw: string): TenantSettings {
  try {
    return JSON.parse(raw) as TenantSettings;
  } catch {
    return {};
  }
}

const PRESET_COLORS = [
  '#FF6700', // EmAI orange
  '#3B82F6', // Blue
  '#10B981', // Green
  '#8B5CF6', // Purple
  '#EF4444', // Red
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#06B6D4', // Cyan
];

export function EditOrganizationModal({ organization, isOpen, onClose, onSaved }: EditOrganizationModalProps) {
  const update = useOrganizationsStore((s) => s.update);

  const [tab, setTab] = useState<Tab>('basics');
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [plan, setPlan] = useState('');
  const [brandColor, setBrandColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (organization && isOpen) {
      setName(organization.name);
      setLogoUrl(organization.logoUrl ?? '');
      setPlan(organization.plan ?? '');
      const settings = parseSettings(organization.settings);
      setBrandColor(settings.brandColor ?? '');
      setError(null);
      setTab('basics');
    }
  }, [organization, isOpen]);

  if (!organization) return null;

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const settings: TenantSettings = {};
      if (brandColor) settings.brandColor = brandColor;

      await update(organization.id, {
        name: name.trim() || undefined,
        logoUrl: logoUrl.trim() || null,
        plan: plan.trim() || null,
        settings,
      });
      onSaved?.(name.trim() || organization.name);
      onClose();
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Failed to save';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Edit ${organization.name}`}>
      <div className="space-y-5">
        {/* Tab switcher */}
        <div className="flex gap-1 border-b border-theme">
          {(['basics', 'branding'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-brand text-brand'
                  : 'border-transparent text-theme-tertiary hover:text-theme-secondary'
              }`}
            >
              {t === 'basics' ? 'Basics' : 'Branding'}
            </button>
          ))}
        </div>

        {/* Basics tab */}
        {tab === 'basics' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Plan</label>
              <Input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="free, pro, enterprise..." />
            </div>
          </div>
        )}

        {/* Branding tab */}
        {tab === 'branding' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Logo URL</label>
              <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://cdn.example.com/logo.png" />
              {logoUrl && (
                <div className="mt-2 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-brand border border-theme bg-theme-elevated flex items-center justify-center overflow-hidden">
                    <img src={logoUrl} alt="Preview" className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                  <span className="text-xs text-theme-tertiary">Preview</span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Brand color</label>
              <div className="flex items-center gap-2">
                <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} placeholder="#FF6700" className="w-32 font-mono" />
                {brandColor && (
                  <div className="w-8 h-8 rounded-brand border border-theme" style={{ backgroundColor: brandColor }} />
                )}
              </div>
              <div className="flex gap-1.5 mt-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setBrandColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                      brandColor === c ? 'border-white scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-brand border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-theme">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
