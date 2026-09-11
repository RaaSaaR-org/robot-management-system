/**
 * @file GatedNotice.tsx
 * @description Calm inset notice shown on /organizations and /team while the server runs
 * without multi-tenancy: a gated tag and one sentence about what that means.
 * @feature organizations
 */

import type { ReactNode } from 'react';
import { Panel, StatusTag } from '@/shared/components/ui';

export interface GatedNoticeProps {
  /** Tag label */
  title?: string;
  /** One sentence */
  children: ReactNode;
}

export function GatedNotice({ title = 'Multi-tenancy off', children }: GatedNoticeProps) {
  return (
    <Panel variant="inset" padding="sm" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <StatusTag tone="gated" dot className="self-start sm:self-auto">
        {title}
      </StatusTag>
      <p className="text-[13px] text-ink-secondary">{children}</p>
    </Panel>
  );
}

/** The inline env-var code chip used inside the notice. */
export function EnvVar({ children }: { children: ReactNode }) {
  return <code className="rounded-tag bg-panel px-1.5 py-0.5 font-mono text-xs text-ink-primary">{children}</code>;
}
