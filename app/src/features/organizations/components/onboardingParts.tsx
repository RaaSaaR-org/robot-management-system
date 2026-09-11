/**
 * @file onboardingParts.tsx
 * @description Small pieces of the onboarding wizard: password generator, form error box and
 * the one-time credentials block with a Copy button
 * @feature organizations
 */

import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, KeyValueList, toast } from '@/shared/components/ui';

export function generatePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@$%';
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function AuthFormErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-control border border-signal-stopped/30 bg-signal-stopped/10 px-3 py-2 text-[13px] text-signal-stopped">
      {children}
    </div>
  );
}

export function CredentialsBlock({ orgName, email, password }: { orgName: string; email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  const loginUrl = `${window.location.origin}/login`;

  const copy = async () => {
    const text = [
      `Organization: ${orgName}`,
      `Sign-in URL: ${loginUrl}`,
      `Email: ${email}`,
      `Temporary password: ${password}`,
      '',
      'You will be asked to set a new password at first sign-in.',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy", { description: 'Select the values and copy them by hand.' });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-secondary">
        <span className="font-medium text-ink-primary">{orgName}</span> is ready. Hand these to its admin — the password is
        shown only now.
      </p>
      <div className="rounded-control border border-line-subtle bg-inset p-4">
        <KeyValueList
          columns={1}
          items={[
            { label: 'Sign-in URL', value: loginUrl, mono: true },
            { label: 'Email', value: email, mono: true },
            { label: 'Temporary password', value: password, mono: true },
          ]}
        />
      </div>
      <div>
        <Button
          variant="secondary"
          leftIcon={copied ? <Check className="h-4 w-4" strokeWidth={1.75} /> : <Copy className="h-4 w-4" strokeWidth={1.75} />}
          onClick={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy credentials'}
        </Button>
      </div>
    </div>
  );
}
