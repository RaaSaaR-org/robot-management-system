/**
 * @file MarketplaceDownloadModal.tsx
 * @description "Download ‹title›" Modal: file details, checksum, next steps and the artifact download
 * @feature marketplace
 */

import { useEffect, useRef } from 'react';
import { Copy, Download } from 'lucide-react';
import {
  Button, KeyValueList, Modal, ProgressBar, Skeleton, toast,
} from '@/shared/components/ui';
import { useMarketplaceDownload } from '../hooks/marketplace';
import { formatArtifactFormat, formatBytes, formatMarketplaceDate } from './marketplaceUi';
import type { MarketplaceListing } from '../types/marketplace.types';

export interface MarketplaceDownloadModalProps {
  listing: MarketplaceListing;
  open: boolean;
  onClose: () => void;
}

export function MarketplaceDownloadModal({ listing, open, onClose }: MarketplaceDownloadModalProps) {
  const { info, state, progress, error, start } = useMarketplaceDownload(listing, open);
  const isSkill = listing.type === 'skill';
  const checksum = info?.checksumSha256 ? `sha256:${info.checksumSha256}` : null;

  // One toast per outcome
  const lastState = useRef(state);
  useEffect(() => {
    if (lastState.current === state) return;
    lastState.current = state;
    if (state === 'complete') toast.success('Download started', { description: info?.fileName });
    if (state === 'error' && info) toast.error("Couldn't download the file", { description: error ?? undefined });
  }, [state, info, error]);

  const copyChecksum = () => {
    if (!checksum) return;
    navigator.clipboard
      .writeText(checksum)
      .then(() => toast.success('Checksum copied'))
      .catch(() => toast.error("Couldn't copy the checksum"));
  };

  const steps = isSkill
    ? [
        `Put ${info?.fileName ?? 'the adapter file'} in your VLA server's adapter directory.`,
        'Set adapter_path in the VLA server config and restart it.',
        'The robot agent loads the adapter on its next inference call.',
      ]
    : [
        'Extract the archive into your LeRobot datasets directory.',
        'Reference the dataset path in your training job.',
        'Start a fine-tuning job from Training.',
      ];

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`Download ${listing.title}`}
      description="The file runs on your own hardware: no telemetry, no cloud calls, no expiry."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            leftIcon={<Download className="h-4 w-4" />}
            onClick={() => void start()}
            disabled={!info || state === 'downloading'}
            isLoading={state === 'downloading'}
            loadingText="Downloading…"
          >
            {state === 'error' ? 'Try again' : info ? `Download ${formatBytes(info.fileSizeBytes)}` : 'Download'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {info ? (
          <KeyValueList
            columns={2}
            items={[
              { label: 'File', value: info.fileName, mono: true },
              { label: 'Format', value: formatArtifactFormat(info.format, isSkill) },
              { label: 'Size', value: formatBytes(info.fileSizeBytes) },
              { label: 'Version', value: info.version },
              { label: 'Robot', value: listing.robotType },
              { label: 'Published', value: formatMarketplaceDate(listing.createdAt) },
            ]}
          />
        ) : state === 'error' ? null : (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Preparing download">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        )}

        {checksum && (
          <div className="flex items-center gap-2 rounded-control border border-line-subtle bg-inset px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink-secondary">{checksum}</code>
            <Button variant="ghost" size="sm" iconOnly aria-label="Copy checksum" onClick={copyChecksum}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        )}

        {state === 'downloading' && <ProgressBar value={progress} label="Downloading" />}
        {state === 'complete' && (
          <p className="text-sm text-ink-secondary">{info?.fileName} was handed to your browser's downloads.</p>
        )}
        {state === 'error' && (
          <p role="alert" className="text-sm text-signal-stopped">{error ?? 'The download failed.'}</p>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink-primary">After the download</h3>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-secondary">
            {steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>
      </div>
    </Modal>
  );
}
