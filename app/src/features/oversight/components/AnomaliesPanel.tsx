/**
 * @file AnomaliesPanel.tsx
 * @description Active anomalies table with acknowledge / resolve acts and a detail modal
 * @feature oversight
 */

import { useState } from 'react';
import { Check, CheckCircle2, Eye, Wrench } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  InfoIcon,
  KeyValueList,
  Modal,
  Panel,
  StatusTag,
  toast,
  type DataTableColumn,
  type RowActionItem,
} from '@/shared/components/ui';
import type { AnomalyRecord } from '../types';
import { ResolveAnomalyModal } from './ResolveAnomalyModal';
import { errorMessage, humanize, severityTone } from './oversightFormat';

export interface AnomaliesPanelProps {
  anomalies: AnomalyRecord[];
  isLoading: boolean;
  onAcknowledge: (anomalyId: string) => Promise<void>;
  onResolve: (anomalyId: string, resolution: string) => Promise<void>;
  className?: string;
}

const icon = 'h-4 w-4';
const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

export function AnomaliesPanel({ anomalies, isLoading, onAcknowledge, onResolve, className }: AnomaliesPanelProps) {
  const [detail, setDetail] = useState<AnomalyRecord | null>(null);
  const [resolving, setResolving] = useState<AnomalyRecord | null>(null);

  const acknowledge = async (a: AnomalyRecord) => {
    try {
      await onAcknowledge(a.id);
      toast.success('Anomaly acknowledged', { description: humanize(a.anomalyType) });
    } catch (err) {
      toast.error("Couldn't acknowledge anomaly", { description: errorMessage(err) });
    }
  };

  const actions = (a: AnomalyRecord): RowActionItem[] => [
    { label: 'View details', icon: <Eye className={icon} />, onSelect: () => setDetail(a) },
    ...(a.acknowledgedAt ? [] : [{ label: 'Acknowledge', icon: <Check className={icon} />, onSelect: () => void acknowledge(a) }]),
    { label: 'Resolve…', icon: <Wrench className={icon} />, onSelect: () => setResolving(a) },
  ];

  const columns: DataTableColumn<AnomalyRecord>[] = [
    {
      key: 'detectedAt',
      header: 'Detected',
      sortable: true,
      sortValue: (a) => new Date(a.detectedAt),
      cell: (a) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{new Date(a.detectedAt).toLocaleString()}</span>,
    },
    {
      key: 'robot',
      header: 'Robot',
      hideBelow: 'sm',
      cell: (a) =>
        a.robotName ? (
          <span className="text-sm text-ink-primary" title={a.robotId}>{a.robotName}</span>
        ) : (
          <code className="font-mono text-[13px] text-ink-secondary">{a.robotId}</code>
        ),
    },
    { key: 'type', header: 'Type', cell: (a) => <span className="text-sm text-ink-primary">{humanize(a.anomalyType)}</span> },
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      sortValue: (a) => SEVERITY_ORDER.indexOf(a.severity),
      cell: (a) => <StatusTag tone={severityTone(a.severity)}>{humanize(a.severity)}</StatusTag>,
    },
    {
      key: 'state',
      header: 'Status',
      hideBelow: 'md',
      cell: (a) => (a.acknowledgedAt ? <StatusTag tone="info">Acknowledged</StatusTag> : <StatusTag tone="warning">New</StatusTag>),
    },
  ];

  return (
    <Panel padding="none" className={className}>
      <Panel.Header
        title={
          <span className="inline-flex items-center gap-2">
            Anomalies
            <InfoIcon content="Check the evidence before acting on an AI suggestion. An anomaly is a signal to look, not a verdict." />
          </span>
        }
        description="Deviations the system flagged for a human to review."
      />
      <DataTable
        caption="Active anomalies"
        columns={columns}
        rows={anomalies}
        getRowId={(a) => a.id}
        defaultSort={{ key: 'severity', direction: 'desc' }}
        onRowClick={setDetail}
        rowActions={actions}
        rowActionsLabel={(a) => `Actions for ${humanize(a.anomalyType)}`}
        isLoading={isLoading}
        empty={<EmptyState size="sm" icon={<CheckCircle2 />} title="No active anomalies" description="Nothing needs a human look right now." />}
      />

      <Modal
        isOpen={Boolean(detail)}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail ? humanize(detail.anomalyType) : ''}
        description={detail ? `Detected ${new Date(detail.detectedAt).toLocaleString()}` : undefined}
        footer={
          detail && (
            <>
              {!detail.acknowledgedAt && (
                <Button variant="secondary" onClick={() => { void acknowledge(detail); setDetail(null); }}>Acknowledge</Button>
              )}
              <Button onClick={() => { setResolving(detail); setDetail(null); }}>Resolve…</Button>
            </>
          )
        }
      >
        {detail && (
          <div className="flex flex-col gap-4">
            <p className="max-w-[70ch] text-sm text-ink-secondary">{detail.description}</p>
            <KeyValueList
              items={[
                { label: 'Severity', value: <StatusTag tone={severityTone(detail.severity)}>{humanize(detail.severity)}</StatusTag> },
                { label: 'Robot', value: detail.robotName ?? detail.robotId },
                { label: 'Robot ID', value: detail.robotId, mono: true },
                { label: 'Acknowledged', value: detail.acknowledgedAt ? `${new Date(detail.acknowledgedAt).toLocaleString()} by ${detail.acknowledgedByName ?? detail.acknowledgedBy ?? 'unknown'}` : undefined },
              ]}
            />
          </div>
        )}
      </Modal>

      <ResolveAnomalyModal anomaly={resolving} onClose={() => setResolving(null)} onResolve={onResolve} />
    </Panel>
  );
}
