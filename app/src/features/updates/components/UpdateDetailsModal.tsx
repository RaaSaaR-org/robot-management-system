/**
 * @file UpdateDetailsModal.tsx
 * @description Details of one update package: signature, checksum, full
 *              changelog and the deployment history per robot
 * @feature updates
 */

import { useEffect, useState } from 'react';
import { Button, FormField, KeyValueList, Modal, Select, StatusTag } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils';
import { useUpdatesStore, selectDeployments, selectIsLoading } from '../store/updatesStore';
import { UPDATE_STATUS_LABELS, type UpdatePackage } from '../types/updates.types';
import { DeploymentHistory } from './DeploymentHistory';
import { formatBytes } from './updateActs';
import { useRobotOptions } from './useRobotOptions';

export interface UpdateDetailsModalProps {
  pkg: UpdatePackage | null;
  onClose: () => void;
}

export function UpdateDetailsModal({ pkg, onClose }: UpdateDetailsModalProps) {
  const fetchDeployments = useUpdatesStore((s) => s.fetchDeployments);
  const deployments = useUpdatesStore(selectDeployments);
  const isLoading = useUpdatesStore(selectIsLoading);
  const robots = useRobotOptions(Boolean(pkg));
  const [robotId, setRobotId] = useState('');

  useEffect(() => {
    if (pkg) setRobotId('');
  }, [pkg]);

  useEffect(() => {
    if (robotId) void fetchDeployments(robotId);
  }, [robotId, fetchDeployments]);

  if (!pkg) return null;
  const history = deployments.filter((d) => d.packageId === pkg.id && d.robotId === robotId);

  return (
    <Modal
      isOpen={Boolean(pkg)}
      onClose={onClose}
      title={`v${pkg.version}`}
      description={`Created ${formatDateTime(pkg.createdAt)}`}
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-5">
        <div>
          <StatusTag status={pkg.status} dot>{UPDATE_STATUS_LABELS[pkg.status]}</StatusTag>
        </div>
        <p className="whitespace-pre-line text-sm text-ink-secondary">{pkg.changelog}</p>
        <KeyValueList
          items={[
            { label: 'Size', value: formatBytes(pkg.fileSize) },
            { label: 'Approved by', value: pkg.approvedBy },
            { label: 'Approved', value: pkg.approvedAt ? formatDateTime(pkg.approvedAt) : null },
            { label: 'ID', value: pkg.id, mono: true },
          ]}
        />
        <KeyValueList
          columns={1}
          items={[
            { label: 'Checksum (SHA-256)', value: pkg.checksum, mono: true },
            { label: 'Signature (Ed25519)', value: `${pkg.signature.slice(0, 44)}…`, mono: true },
            { label: 'Public key', value: pkg.publicKey, mono: true },
          ]}
        />
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="text-sm font-semibold text-ink-primary">Robot deployments</div>
          <FormField label="Robot">
            <Select placeholder={robots.isLoading ? 'Loading robots…' : 'Choose a robot…'}
              options={robots.options} value={robotId} onChange={(e) => setRobotId(e.target.value)} />
          </FormField>
          {robotId ? (
            <DeploymentHistory deployments={history} isLoading={isLoading} robotName={robots.nameOf}
              className="overflow-hidden rounded-panel border border-line" />
          ) : (
            <p className="text-[13px] text-ink-tertiary">Choose a robot to see where this package went.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
