/**
 * @file PreflightChecklist.tsx
 * @description "Before you record" panel on a created session (TASK-392): one
 *              row per check (robot, recorder, camera, input, control) with a
 *              ready / check / blocking tag, and the single next action. The
 *              checks come from `buildPreflight`; this only renders them.
 * @feature datacollection
 */

import { Panel, StatusTag, type StatusTagTone } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { PreflightItem, PreflightLevel, PreflightSummary } from '../utils/preflight';

export interface PreflightChecklistProps {
  items: PreflightItem[];
  summary: PreflightSummary;
  className?: string;
}

const LEVEL: Record<PreflightLevel, { label: string; tone: StatusTagTone }> = {
  ok: { label: 'Ready', tone: 'success' },
  warning: { label: 'Check', tone: 'warning' },
  blocking: { label: 'Blocking', tone: 'danger' },
  checking: { label: 'Checking', tone: 'neutral' },
  unknown: { label: 'Not checked', tone: 'neutral' },
};

export function PreflightChecklist({ items, summary, className }: PreflightChecklistProps) {
  const description = summary.blocking
    ? 'Recording cannot start until the blocking item is fixed.'
    : summary.warnings > 0
      ? 'You can start, but check the items marked below.'
      : 'Everything NeoDEM can check is ready.';

  return (
    <Panel className={className} data-testid="preflight">
      <Panel.Header title="Before you record" description={description} />
      <Panel.Body className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y divide-line-subtle">
          {items.map((item) => {
            const level = LEVEL[item.level];
            return (
              <li
                key={item.id}
                data-testid={`preflight-${item.id}`}
                data-level={item.level}
                className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-primary">{item.label}</div>
                  <div className="break-words text-[13px] text-ink-secondary">{item.detail}</div>
                </div>
                <StatusTag tone={level.tone} size="sm" dot pulse={item.level === 'checking'} className="shrink-0">
                  {level.label}
                </StatusTag>
              </li>
            );
          })}
        </ul>
        <Panel
          variant="inset"
          padding="sm"
          data-testid="preflight-next"
          className={cn('text-[13px]', summary.blocking ? 'text-signal-stopped' : 'text-ink-secondary')}
        >
          <span className="font-medium text-ink-primary">Next: </span>
          {summary.next}
        </Panel>
      </Panel.Body>
    </Panel>
  );
}
