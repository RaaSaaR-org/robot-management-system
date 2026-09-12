/**
 * @file AuthLayout.tsx
 * @description The one calm layout every page outside the shell uses to get
 * a person in: logo, one panel with the page's h1, the form, quiet links below.
 * @feature auth
 */

import type { ReactNode } from 'react';
import { Logo } from '@/components/common/Logo';
import { Panel } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';

export interface AuthLayoutProps {
  /** The page's only h1 */
  title: string;
  /** One sentence under the title */
  description?: ReactNode;
  /** Optional icon tile above the title (success / error states) */
  icon?: ReactNode;
  /** Icon tile tone */
  iconTone?: 'primary' | 'danger';
  /** Panel content: the form or a state */
  children?: ReactNode;
  /** Quiet links under the panel */
  footer?: ReactNode;
}

/**
 * Centred auth column in the landing's language — no blobs, no gradients.
 */
export function AuthLayout({ title, description, icon, iconTone = 'primary', children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex justify-center">
          <Logo />
        </div>

        <Panel className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            {icon && (
              <div
                aria-hidden="true"
                className={cn(
                  'mb-2 flex h-10 w-10 items-center justify-center rounded-control [&_svg]:h-5 [&_svg]:w-5',
                  iconTone === 'danger'
                    ? 'bg-signal-stopped/10 text-signal-stopped'
                    : 'bg-primary/10 text-primary',
                )}
              >
                {icon}
              </div>
            )}
            <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] text-ink-primary">
              {title}
            </h1>
            {description && <p className="text-sm text-ink-secondary">{description}</p>}
          </div>
          {children}
        </Panel>

        {footer && (
          <div className="flex flex-col items-center gap-2 text-center text-[13px] text-ink-tertiary">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline form-level error inside an auth panel. */
export function AuthFormError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-control border border-signal-stopped/30 bg-signal-stopped/10 px-3 py-2 text-[13px] text-signal-stopped"
    >
      {children}
    </div>
  );
}

/** Link style used in auth footers and field asides. */
export const authLinkClass =
  'font-medium text-primary hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary rounded-sm';
