/**
 * @file CapabilitiesPanel.tsx
 * @description What the selected robot can do and where its limits are (AI Act Art. 14(4)(a))
 * @feature oversight
 */

import { Bot } from 'lucide-react';
import { EmptyState, KeyValueList, Panel, SkeletonText, StatusTag, type Tone } from '@/shared/components/ui';
import type { RobotCapabilitiesSummary } from '../types';
import { humanize } from './oversightFormat';

export interface CapabilitiesPanelProps {
  hasRobot: boolean;
  capabilities: RobotCapabilitiesSummary | null;
  isLoading: boolean;
  className?: string;
}

/** Confidence in percent: ≥ 80 live, 50–80 gated, below stopped. */
function confidenceTone(pct: number): Tone {
  if (pct >= 80) return 'live';
  if (pct >= 50) return 'gated';
  return 'stopped';
}

const pct = (v: number | null) => (v === null ? undefined : `${Math.round(v)}%`);

export function CapabilitiesPanel({ hasRobot, capabilities: c, isLoading, className }: CapabilitiesPanelProps) {
  const notes = c
    ? [
        ...c.errors.map((text) => ({ text, tone: 'danger' as Tone, label: 'Error' })),
        ...c.warnings.map((text) => ({ text, tone: 'warning' as Tone, label: 'Warning' })),
        ...c.limitations.map((text) => ({ text, tone: 'neutral' as Tone, label: 'Limit' })),
      ]
    : [];

  return (
    <Panel className={className}>
      <Panel.Header
        title="Capabilities and limits"
        description="What the robot can do, how sure it is, and where a human has to watch."
        actions={c ? <StatusTag status={c.status} dot /> : undefined}
      />
      <Panel.Body>
        {!hasRobot ? (
          <EmptyState size="sm" icon={<Bot />} title="Pick a robot to see its capabilities" description="Choose one in the robot filter above." />
        ) : isLoading && !c ? (
          <SkeletonText lines={4} />
        ) : !c ? (
          <p className="text-sm text-ink-tertiary">No capability data for this robot.</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <KeyValueList
                items={[
                  { label: 'Model', value: c.model },
                  { label: 'Firmware', value: c.firmware && c.firmware !== 'unknown' ? c.firmware : 'Unknown' },
                  { label: 'Operating mode', value: humanize(c.operatingMode) },
                  { label: 'Battery', value: pct(c.batteryLevel) },
                  { label: 'Overall confidence', value: pct(c.overallConfidence) },
                  { label: 'Recent decision accuracy', value: pct(c.recentDecisionAccuracy) },
                ]}
              />
              {notes.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {notes.map((n, i) => (
                    <li key={`${n.label}-${i}`} className="flex items-start gap-2 text-sm text-ink-secondary">
                      <StatusTag tone={n.tone}>{n.label}</StatusTag>
                      <span>{n.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <ul className="flex flex-col divide-y divide-line-subtle rounded-control border border-line-subtle">
              {c.capabilities.length === 0 && <li className="px-4 py-3 text-sm text-ink-tertiary">No capabilities declared.</li>}
              {c.capabilities.map((cap) => (
                <li key={cap.name} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink-primary">{humanize(cap.name)}</div>
                    <div className="text-[13px] text-ink-tertiary">{cap.description}</div>
                    {cap.limitations && cap.limitations.length > 0 && (
                      <div className="mt-1 text-[13px] text-ink-secondary">Limits: {cap.limitations.join('; ')}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusTag tone={cap.isAvailable ? 'live' : 'neutral'}>{cap.isAvailable ? 'Available' : 'Unavailable'}</StatusTag>
                    {cap.confidenceLevel !== undefined && (
                      <StatusTag tone={confidenceTone(cap.confidenceLevel)}>{`${cap.confidenceLevel}% sure`}</StatusTag>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel.Body>
    </Panel>
  );
}
