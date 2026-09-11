/**
 * @file ModelDetailsModal.tsx
 * @description Details of one model version: ids, artifact, lineage and
 *              metrics, with Deploy for a staging version
 * @feature deployment
 */

import { Rocket } from 'lucide-react';
import { Button, KeyValueList, LinkButton, Modal, StatusTag, type KeyValueItem } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils';
import { MODEL_SOURCE_KIND_LABELS } from '../../types';
import type { ModelVersion } from '../../types';
import { getModelDisplayName, UNLINKED_SKILL_LABEL } from './modelDisplay';

export interface ModelDetailsModalProps {
  version: ModelVersion | null;
  /** Resolved skill name, null when the version has no skill. */
  skillName: string | null;
  /** Resolved parent name, null when the version has no parent. */
  parentName: string | null;
  onClose: () => void;
}

function formatMetric(key: string, value: number): string {
  if (/accuracy|rate/i.test(key) && value <= 1) return `${(value * 100).toFixed(1)} %`;
  if (/latency/i.test(key)) return `${value} ms`;
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function metricItems(version: ModelVersion): KeyValueItem[] {
  const merged: Record<string, unknown> = {
    ...(version.trainingMetrics ?? {}),
    ...(version.validationMetrics ?? {}),
    ...(version.metrics ?? {}),
  };
  return Object.entries(merged)
    .filter(([, v]) => typeof v === 'number')
    .map(([key, v]) => ({
      key,
      label: key.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()),
      value: formatMetric(key, v as number),
    }));
}

export function ModelDetailsModal({ version, skillName, parentName, onClose }: ModelDetailsModalProps) {
  if (!version) return null;
  const metrics = metricItems(version);

  return (
    <Modal
      isOpen={Boolean(version)}
      onClose={onClose}
      title={getModelDisplayName(version)}
      description={`v${version.version}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {version.deploymentStatus === 'staging' && (
            <LinkButton to={`/deployments?new=${version.id}`} leftIcon={<Rocket className="h-4 w-4" />}>
              Deploy
            </LinkButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusTag status={version.deploymentStatus} dot />
          {version.sourceKind && (
            <span className="text-[13px] text-ink-tertiary">{MODEL_SOURCE_KIND_LABELS[version.sourceKind]}</span>
          )}
        </div>
        <KeyValueList
          items={[
            { label: 'Skill', value: skillName ?? UNLINKED_SKILL_LABEL },
            { label: 'Derived from', value: parentName },
            { label: 'Type', value: version.modelType === 'rl_policy' ? 'RL policy' : version.modelType ? 'VLA' : null },
            { label: 'Created', value: formatDateTime(version.createdAt) },
            { label: 'ID', value: version.id, mono: true },
            { label: 'Training job', value: version.trainingJobId, mono: true },
          ]}
        />
        <KeyValueList
          columns={1}
          items={[
            { label: 'Artifact URI', value: version.artifactUri, mono: true },
            ...(version.checkpointUri ? [{ label: 'Checkpoint URI', value: version.checkpointUri, mono: true }] : []),
          ]}
        />
        {metrics.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold text-ink-primary">Metrics</div>
            <KeyValueList items={metrics} />
          </div>
        )}
      </div>
    </Modal>
  );
}
