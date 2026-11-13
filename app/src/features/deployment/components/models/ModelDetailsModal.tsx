/**
 * @file ModelDetailsModal.tsx
 * @description Details of one model version: ids, artifact, lineage and
 *              metrics, with Deploy for a staging version — and, for a model
 *              uploaded to this instance, its base model, the dataset it was
 *              trained on and the files stored for it (TASK-498)
 * @feature deployment
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import { Button, KeyValueList, LinkButton, Modal, StatusTag, type KeyValueItem } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils';
import { SocialPanel } from '@/features/social';
import { ModelExperimentsLink } from '@/features/experiments';
import { storesFiles, useModelStorage } from '../../hooks/useModelStorage';
import { MODEL_SOURCE_KIND_LABELS } from '../../types';
import type { ModelVersion, ModelVersionOrigin } from '../../types';
import {
  formatArtifactSize, getBaseModelLabel, getModelDisplayName, getVersionLabel, UNLINKED_SKILL_LABEL,
} from './modelDisplay';
import { ModelStoredFiles } from './ModelStoredFiles';

export interface ModelDetailsModalProps {
  version: ModelVersion | null;
  /** Resolved skill name, null when the version has no skill. */
  skillName: string | null;
  /** Resolved parent name, null when the version has no parent. */
  parentName: string | null;
  onClose: () => void;
}

function formatMetric(key: string, value: number): string {
  // A learning rate is a rate, but not a share of anything.
  if (/accuracy|rate/i.test(key) && !/learning/i.test(key) && value <= 1) return `${(value * 100).toFixed(1)} %`;
  if (/latency/i.test(key)) return `${value} ms`;
  if (Number.isInteger(value)) return String(value);
  // 0.0001 must not read "0.0000".
  return Math.abs(value) < 0.001 ? value.toExponential(1) : value.toFixed(4);
}

/**
 * The dataset a model names as its training data: a link while the dataset
 * exists on this instance, its id with a note once it does not.
 */
function trainedOn(version: ModelVersion, origin: ModelVersionOrigin | null, isLoading: boolean): ReactNode {
  if (!version.datasetId) return null;
  if (origin?.trainedOnDataset) {
    return (
      <Link to={`/datasets/${origin.trainedOnDataset.id}/episodes`} className="text-primary hover:underline">
        {origin.trainedOnDataset.name}
      </Link>
    );
  }
  const shortId = `Dataset ${version.datasetId.slice(0, 8)}`;
  return isLoading || !origin ? shortId : `${shortId} (no longer on this instance)`;
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
  const storage = useModelStorage(version);
  if (!version) return null;
  const metrics = metricItems(version);
  const stored = storesFiles(version)
    ? `${formatArtifactSize(version.artifactSizeBytes ?? 0)}${
        version.artifactFileCount ? ` in ${version.artifactFileCount} files` : ''
      }${storage.filesRemoved ? ' — removed' : ''}`
    : null;

  return (
    <Modal
      isOpen={Boolean(version)}
      onClose={onClose}
      title={getModelDisplayName(version)}
      description={getVersionLabel(version.version)}
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
            { label: 'Base model', value: getBaseModelLabel(version) },
            { label: 'Trained on', value: trainedOn(version, storage.origin, storage.isLoading) },
            { label: 'Stored here', value: stored },
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
        {version.notes && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold text-ink-primary">Notes</div>
            <p className="whitespace-pre-line text-[13px] text-ink-secondary">{version.notes}</p>
          </div>
        )}
        {metrics.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold text-ink-primary">Metrics</div>
            <KeyValueList items={metrics} />
          </div>
        )}
        {storesFiles(version) && (
          <ModelStoredFiles
            modelVersionId={version.id}
            files={storage.files}
            removed={storage.filesRemoved}
            removedAt={storage.origin?.storage?.filesRemovedAt}
            isLoading={storage.isLoading}
            error={storage.filesError}
          />
        )}
        <ModelExperimentsLink modelVersionId={version.id} />
        <SocialPanel subject={{ subjectType: 'model_version', subjectId: version.id }} />
      </div>
    </Modal>
  );
}
