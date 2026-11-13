/**
 * @file GatedNotice.tsx
 * @description Calm inset notice shown on /organizations and /team while the server runs
 * without multi-tenancy: a gated tag, one sentence about what that means for
 * the person reading it, and the setting behind it for whoever runs the server.
 * @feature organizations
 */

import type { ReactNode } from 'react';
import { AdminHint, Panel, StatusTag } from '@/shared/components/ui';

export interface GatedNoticeProps {
  /** Tag label */
  title?: string;
  /** One sentence, in words a visitor understands */
  children: ReactNode;
  /** How an administrator changes it — folded away under "For administrators" */
  adminHint?: ReactNode;
}

export function GatedNotice({ title = 'Shared workspace', children, adminHint }: GatedNoticeProps) {
  return (
    <Panel variant="inset" padding="sm" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <StatusTag tone="gated" dot className="self-start sm:self-auto">
        {title}
      </StatusTag>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[13px] text-ink-secondary">{children}</p>
        {adminHint && <AdminHint data-testid="gated-admin-hint">{adminHint}</AdminHint>}
      </div>
    </Panel>
  );
}

/** The inline env-var code chip used inside the notice. */
export function EnvVar({ children }: { children: ReactNode }) {
  return <code className="rounded-tag bg-panel px-1.5 py-0.5 font-mono text-xs text-ink-primary">{children}</code>;
}
