/**
 * @file DecisionModal.tsx
 * @description Detail of one AI decision: facts, confidence, reasoning, safety, alternatives
 * @feature explainability
 */

import { useEffect } from 'react';
import { Button, KeyValueList, Modal, ProgressBar, SkeletonText } from '@/shared/components/ui';
import { ConfidenceGauge } from './ConfidenceGauge';
import { SafetyBadge } from './SafetyBadge';
import {
  DECISION_TYPE_LABELS,
  formatDate,
  type DecisionExplanation,
  type FormattedExplanation,
} from '../types';

export interface DecisionModalProps {
  decision: DecisionExplanation | null;
  explanation: FormattedExplanation | null;
  isLoadingExplanation?: boolean;
  onLoadExplanation: (id: string) => void;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
      {children}
    </section>
  );
}

export function DecisionModal({
  decision,
  explanation,
  isLoadingExplanation,
  onLoadExplanation,
  onClose,
}: DecisionModalProps) {
  const id = decision?.id;
  useEffect(() => {
    if (id) onLoadExplanation(id);
  }, [id, onLoadExplanation]);

  if (!decision) return null;
  const ready = explanation?.id === decision.id ? explanation : null;
  const reasoning = ready?.reasoning.steps ?? decision.reasoning;
  const warnings = decision.safetyFactors.warnings;
  const constraints = decision.safetyFactors.constraints;

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={decision.inputFactors.userCommand || 'AI decision'}
      description={`${DECISION_TYPE_LABELS[decision.decisionType] ?? decision.decisionType} · ${formatDate(decision.createdAt)}`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-6">
        <KeyValueList
          items={[
            { label: 'Safety', value: <SafetyBadge classification={decision.safetyFactors.classification} /> },
            { label: 'Model', value: decision.modelUsed },
            { label: 'Robot', value: decision.robotId, mono: true },
            { label: 'Entity', value: decision.entityId, mono: true },
          ]}
        />
        <ConfidenceGauge confidence={decision.confidence} variant="bar" />

        {ready?.summary && <p className="max-w-[70ch] text-sm text-ink-secondary">{ready.summary}</p>}

        <Section title="Reasoning">
          {isLoadingExplanation && !ready ? (
            <SkeletonText lines={3} />
          ) : reasoning.length ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-secondary">
              {reasoning.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          ) : (
            <p className="text-sm text-ink-tertiary">No reasoning steps were recorded.</p>
          )}
        </Section>

        {ready && ready.inputFactors.items.length > 0 && (
          <Section title="What the AI knew">
            <KeyValueList items={ready.inputFactors.items.map((f) => ({ label: f.label, value: f.value }))} />
          </Section>
        )}

        {(warnings.length > 0 || constraints.length > 0) && (
          <Section title="Safety assessment">
            {warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-signal-unknown">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            {constraints.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-secondary">
                {constraints.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}
          </Section>
        )}

        {decision.alternatives.length > 0 && (
          <Section title="Alternatives considered">
            <ul className="flex flex-col gap-3">
              {decision.alternatives.map((alt, i) => (
                <li key={i} className="rounded-control bg-inset p-3">
                  <div className="text-sm font-medium text-ink-primary">{alt.action}</div>
                  <div className="text-[13px] text-ink-secondary">{alt.reason}</div>
                  {alt.rejectionReason && (
                    <div className="mt-1 text-[13px] text-ink-tertiary">Rejected: {alt.rejectionReason}</div>
                  )}
                  {typeof alt.confidence === 'number' && (
                    <ProgressBar className="mt-2" size="sm" value={Math.round(alt.confidence * 100)} label="Confidence" />
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </Modal>
  );
}
