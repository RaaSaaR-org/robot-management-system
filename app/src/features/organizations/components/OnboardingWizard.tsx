/**
 * @file OnboardingWizard.tsx
 * @description Multi-step wizard for creating a new organization with an
 * admin user and optional starter resources. Replaces the simple 2-field
 * modal for full onboarding (TASK-160).
 * @feature organizations
 */

import { useState } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { organizationsApi, type OnboardResult } from '../api/organizationsApi';
import { useOrganizationsStore } from '../store/organizationsStore';

interface OnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (name: string) => void;
}

type Step = 'basics' | 'admin' | 'resources' | 'review' | 'success';

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const STEP_LABELS: Record<Exclude<Step, 'success'>, string> = {
  basics: 'Basics',
  admin: 'First admin',
  resources: 'Resources',
  review: 'Review',
};

function generatePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let pw = '';
  for (let i = 0; i < 16; i++) {
    pw += chars[Math.floor(Math.random() * chars.length)];
  }
  return pw;
}

export function OnboardingWizard({ isOpen, onClose, onCreated }: OnboardingWizardProps) {
  const fetchList = useOrganizationsStore((s) => s.fetchList);

  // Step state
  const [step, setStep] = useState<Step>('basics');

  // Step 1: Basics
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  // Step 2: Admin user
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState(() => generatePassword());

  // Step 3: Resources
  const [cloneRobots, setCloneRobots] = useState(false);

  // Result
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  const handleSlugChange = (v: string) => {
    setSlugEdited(true);
    setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  };

  const resetWizard = () => {
    setStep('basics');
    setName('');
    setSlug('');
    setSlugEdited(false);
    setAdminEmail('');
    setAdminName('');
    setAdminPassword(generatePassword());
    setCloneRobots(false);
    setResult(null);
    setError(null);
    setCopied(false);
  };

  const handleClose = () => {
    resetWizard();
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await organizationsApi.onboard({
        tenant: { name: name.trim(), slug: slug || undefined },
        adminUser: { email: adminEmail.trim(), name: adminName.trim(), password: adminPassword },
        starterResources: cloneRobots ? { cloneRobots: true } : undefined,
      });
      setResult(res);
      setStep('success');
      void fetchList(); // Refresh the list
      onCreated?.(name.trim());
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Failed to create organization';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyCredentials = () => {
    const text = [
      `Organization: ${result?.tenant.name}`,
      `Login URL: ${window.location.origin}/login`,
      `Email: ${result?.adminUser.email}`,
      `Temporary Password: ${adminPassword}`,
      '',
      'The user will be prompted to change their password on first login.',
    ].join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const steps: Exclude<Step, 'success'>[] = ['basics', 'admin', 'resources', 'review'];
  const currentIdx = steps.indexOf(step as Exclude<Step, 'success'>);

  const canGoNext = (): boolean => {
    switch (step) {
      case 'basics': return name.trim().length > 0 && (!slug || SLUG_REGEX.test(slug));
      case 'admin': return adminEmail.includes('@') && adminName.trim().length > 0 && adminPassword.length >= 8;
      case 'resources': return true;
      default: return false;
    }
  };

  const title = step === 'success' ? 'Organization created' : 'New organization';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title}>
      <div className="space-y-5">
        {/* Step indicator */}
        {step !== 'success' && (
          <div className="flex items-center gap-1 text-xs text-theme-tertiary">
            {steps.map((s, i) => (
              <span key={s} className="flex items-center gap-1">
                {i > 0 && <span className="text-theme-tertiary/50 mx-1">/</span>}
                <span className={step === s ? 'text-brand font-medium' : i < currentIdx ? 'text-theme-secondary' : ''}>
                  {STEP_LABELS[s]}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* Step 1: Basics */}
        {step === 'basics' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Organization name</label>
              <Input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Acme Robotics" autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Slug</label>
              <Input value={slug} onChange={(e) => handleSlugChange(e.target.value)} placeholder="acme-robotics" />
              <p className="mt-1 text-xs text-theme-tertiary">URL-safe identifier. Auto-generated from name.</p>
            </div>
          </div>
        )}

        {/* Step 2: Admin user */}
        {step === 'admin' && (
          <div className="space-y-4">
            <p className="text-sm text-theme-secondary">
              Create the first admin user for this organization. They will be prompted to change their password on first login.
            </p>
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Email</label>
              <Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@acme.com" autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Name</label>
              <Input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-secondary mb-1">Temporary password</label>
              <div className="flex gap-2">
                <Input value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className="font-mono text-sm" />
                <Button variant="ghost" size="sm" onClick={() => setAdminPassword(generatePassword())}>
                  Regenerate
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Starter resources */}
        {step === 'resources' && (
          <div className="space-y-4">
            <p className="text-sm text-theme-secondary">
              Optionally copy starter resources from the default organization.
            </p>
            <label className="flex items-center gap-3 p-3 rounded-brand border border-theme hover:bg-theme-elevated/50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={cloneRobots}
                onChange={(e) => setCloneRobots(e.target.checked)}
                className="rounded border-theme-secondary"
              />
              <div>
                <div className="text-sm font-medium text-theme-primary">Clone robot templates</div>
                <div className="text-xs text-theme-tertiary">Copy robot definitions from the default organization</div>
              </div>
            </label>
          </div>
        )}

        {/* Step 4: Review */}
        {step === 'review' && (
          <div className="space-y-3">
            <div className="rounded-brand border border-theme p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-theme-tertiary">Organization</span>
                <span className="text-theme-primary font-medium">{name.trim()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-theme-tertiary">Slug</span>
                <span className="text-theme-primary font-mono">{slug || slugify(name)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-theme-tertiary">Admin email</span>
                <span className="text-theme-primary">{adminEmail.trim()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-theme-tertiary">Admin name</span>
                <span className="text-theme-primary">{adminName.trim()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-theme-tertiary">Clone robots</span>
                <span className="text-theme-primary">{cloneRobots ? 'Yes' : 'No'}</span>
              </div>
            </div>
            {error && (
              <div className="rounded-brand border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Success */}
        {step === 'success' && result && (
          <div className="space-y-4">
            <div className="rounded-brand border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">
              <strong>{result.tenant.name}</strong> is ready. Share the credentials below with the organization admin.
            </div>
            <div className="rounded-brand border border-theme p-4 space-y-2 text-sm font-mono bg-theme-elevated">
              <div>Login: <span className="text-theme-primary">{window.location.origin}/login</span></div>
              <div>Email: <span className="text-theme-primary">{result.adminUser.email}</span></div>
              <div>Password: <span className="text-amber-300">{adminPassword}</span></div>
            </div>
            <p className="text-xs text-theme-tertiary">
              The admin will be prompted to set a new password on first login.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleCopyCredentials}>
                {copied ? 'Copied!' : 'Copy credentials'}
              </Button>
              <Button variant="primary" size="sm" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Navigation buttons */}
        {step !== 'success' && (
          <div className="flex justify-between pt-2 border-t border-theme">
            <div>
              {currentIdx > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setStep(steps[currentIdx - 1])}>
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              {step === 'review' ? (
                <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create organization'}
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => setStep(steps[currentIdx + 1])} disabled={!canGoNext()}>
                  Next
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
