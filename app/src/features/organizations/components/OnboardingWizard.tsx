/**
 * @file OnboardingWizard.tsx
 * @description "Onboard customer": organization + first admin + optional starter robots, as
 * steps in one kit Modal with Back / Next in the footer (TASK-160).
 * @feature organizations
 */

import { useState } from 'react';
import { Button, Checkbox, FormField, Input, KeyValueList, Modal, toast } from '@/shared/components/ui';
import { organizationsApi, type OnboardResult } from '../api/organizationsApi';
import { useOrganizationsStore } from '../store/organizationsStore';
import { orgErrorMessage } from './OrganizationFormModal';
import { AuthFormErrorBox, CredentialsBlock, generatePassword } from './onboardingParts';

interface OnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (name: string) => void;
}

const STEPS = ['basics', 'admin', 'resources', 'review'] as const;
type Step = (typeof STEPS)[number] | 'success';
const STEP_LABELS: Record<(typeof STEPS)[number], string> = {
  basics: 'Organization',
  admin: 'First admin',
  resources: 'Starter resources',
  review: 'Review',
};
const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const slugify = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

export function OnboardingWizard({ isOpen, onClose, onCreated }: OnboardingWizardProps) {
  const fetchList = useOrganizationsStore((s) => s.fetchList);
  const [step, setStep] = useState<Step>('basics');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState(generatePassword);
  const [cloneRobots, setCloneRobots] = useState(false);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const idx = STEPS.indexOf(step as (typeof STEPS)[number]);

  const handleClose = () => {
    setStep('basics');
    setName(''); setSlug(''); setSlugEdited(false);
    setAdminEmail(''); setAdminName(''); setAdminPassword(generatePassword());
    setCloneRobots(false); setResult(null); setError(null);
    onClose();
  };

  const canGoNext =
    step === 'basics' ? name.trim().length > 0 && (!slug || SLUG_RE.test(slug))
    : step === 'admin' ? adminEmail.includes('@') && adminName.trim().length > 0 && adminPassword.length >= 8
    : true;

  const submit = async () => {
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
      void fetchList();
      toast.success('Organization created', { description: name.trim() });
      onCreated?.(name.trim());
    } catch (err) {
      setError(orgErrorMessage(err, "Couldn't create the organization"));
    } finally {
      setSubmitting(false);
    }
  };

  const footer =
    step === 'success' ? (
      <Button onClick={handleClose}>Done</Button>
    ) : (
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-[13px] text-ink-tertiary">Step {idx + 1} of {STEPS.length}</span>
        <div className="flex gap-2">
          {idx > 0 ? (
            <Button variant="ghost" onClick={() => setStep(STEPS[idx - 1])} disabled={submitting}>Back</Button>
          ) : (
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          )}
          {step === 'review' ? (
            <Button onClick={() => void submit()} isLoading={submitting} loadingText="Creating…">Create organization</Button>
          ) : (
            <Button onClick={() => setStep(STEPS[idx + 1])} disabled={!canGoNext}>Next</Button>
          )}
        </div>
      </div>
    );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={step === 'success' ? 'Organization ready' : 'Onboard customer'}
      description={step === 'success' ? undefined : STEP_LABELS[step as (typeof STEPS)[number]]}
      closeOnBackdrop={false}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {step === 'basics' && (
          <>
            <FormField label="Organization name" required>
              <Input value={name} autoFocus placeholder="e.g. Acme Robotics"
                onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }} />
            </FormField>
            <FormField label="Slug" hint="URL-safe id, made from the name." error={slug && !SLUG_RE.test(slug) ? 'Lowercase letters, numbers and dashes only.' : undefined}>
              <Input value={slug} className="font-mono" placeholder="acme-robotics"
                onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }} />
            </FormField>
          </>
        )}
        {step === 'admin' && (
          <>
            <p className="text-sm text-ink-secondary">The first admin of this organization. They set their own password at first sign-in.</p>
            <FormField label="Email" required>
              <Input type="email" value={adminEmail} autoFocus placeholder="admin@acme.com" onChange={(e) => setAdminEmail(e.target.value)} />
            </FormField>
            <FormField label="Name" required>
              <Input value={adminName} placeholder="e.g. Jane Doe" onChange={(e) => setAdminName(e.target.value)} />
            </FormField>
            <FormField label="Temporary password" hint="At least 8 characters. Shown once more after creation."
              aside={<Button variant="ghost" size="sm" onClick={() => setAdminPassword(generatePassword())}>Regenerate</Button>}>
              <Input value={adminPassword} className="font-mono" onChange={(e) => setAdminPassword(e.target.value)} />
            </FormField>
          </>
        )}
        {step === 'resources' && (
          <Checkbox
            label="Copy robot templates"
            description="Copies the robot definitions of the default organization into the new one."
            checked={cloneRobots}
            onChange={(e) => setCloneRobots(e.target.checked)}
          />
        )}
        {step === 'review' && (
          <>
            <KeyValueList columns={1} items={[
              { label: 'Organization', value: name.trim() },
              { label: 'Slug', value: slug || slugify(name), mono: true },
              { label: 'Admin', value: `${adminName.trim()} · ${adminEmail.trim()}` },
              { label: 'Robot templates', value: cloneRobots ? 'Copied' : 'Not copied' },
            ]} />
            {error && <AuthFormErrorBox>{error}</AuthFormErrorBox>}
          </>
        )}
        {step === 'success' && result && (
          <CredentialsBlock orgName={result.tenant.name} email={result.adminUser.email} password={adminPassword} />
        )}
      </div>
    </Modal>
  );
}
