/**
 * @file ComplianceLogViewer.tsx
 * @description Body of the audit-log entry modal: event, payload, hash chain,
 *              model information and ids of one compliance log.
 * @feature compliance
 */

import { Lock, Sparkles } from 'lucide-react';
import { Button, Divider, KeyValueList, StatusTag, statusTone } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { ComplianceLog } from '../types';
import { eventTypeLabel, formatDateTime, humanize } from './complianceFormat';

export interface ComplianceLogViewerProps {
  log: ComplianceLog;
  onViewDecision?: (decisionId: string) => void;
  className?: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-ink-secondary">{title}</h3>
      {children}
    </section>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-control border border-line-subtle bg-inset p-3 font-mono text-xs leading-relaxed text-ink-secondary whitespace-pre-wrap break-all">
      {children}
    </pre>
  );
}

/** Detail view of one compliance log entry (rendered inside a Modal). */
export function ComplianceLogViewer({ log, onViewDecision, className }: ComplianceLogViewerProps) {
  const modelItems = [
    { label: 'Model version', value: log.modelVersion, mono: true },
    { label: 'Model hash', value: log.modelHash, mono: true },
    { label: 'Input hash', value: log.inputHash, mono: true },
    { label: 'Output hash', value: log.outputHash, mono: true },
  ].filter((i) => i.value);

  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusTag tone="neutral">{eventTypeLabel(log.eventType)}</StatusTag>
        <StatusTag tone={statusTone(log.severity)}>{humanize(log.severity)}</StatusTag>
        {log.immutable && (
          <span className="inline-flex items-center gap-1 text-[13px] text-ink-tertiary">
            <Lock className="h-3.5 w-3.5" strokeWidth={1.75} /> Immutable
          </span>
        )}
        <span className="text-[13px] text-ink-tertiary sm:ml-auto">{formatDateTime(log.timestamp)}</span>
      </div>

      <KeyValueList
        items={[
          { label: 'Robot', value: log.robotId, mono: true },
          { label: 'Operator', value: log.operatorId, mono: true },
          { label: 'Session', value: log.sessionId, mono: true },
          { label: 'Log ID', value: log.id, mono: true },
        ]}
      />

      <Section title="Payload">
        <CodeBlock>{JSON.stringify(log.payload, null, 2)}</CodeBlock>
      </Section>

      <Section title="Hash chain">
        <KeyValueList
          columns={1}
          items={[
            { label: 'Previous hash', value: log.previousHash, mono: true },
            { label: 'Current hash', value: log.currentHash, mono: true },
          ]}
        />
      </Section>

      {modelItems.length > 0 && (
        <Section title="AI model">
          <KeyValueList items={modelItems} />
        </Section>
      )}

      {log.decisionId && onViewDecision && (
        <>
          <Divider />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-ink-tertiary">This entry is linked to an AI decision.</p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />}
              onClick={() => onViewDecision(log.decisionId!)}
            >
              View AI decision
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
