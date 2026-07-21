/**
 * @file MarketplaceDownloadModal.tsx
 * @description Download modal showing real file details, sovereignty info, and artifact download
 * @feature marketplace
 */

import { useEffect, useState } from 'react';
import {
  X, Download, Shield, HardDrive, FileText, Server,
  CheckCircle, Cpu, Copy, Check, Lock, AlertTriangle, Loader2,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { formatCredits } from '../types/contributions.types';
import { useMarketplaceDownload } from '../hooks/marketplace';
import type { MarketplaceListing } from '../types/marketplace.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface MarketplaceDownloadModalProps {
  listing: MarketplaceListing;
  open: boolean;
  onClose: () => void;
}

export function MarketplaceDownloadModal({ listing, open, onClose }: MarketplaceDownloadModalProps) {
  const { info, state, progress, error, start } = useMarketplaceDownload(listing, open);
  const [copied, setCopied] = useState(false);

  const isSkill = listing.type === 'skill';
  const fileName = info?.fileName ?? null;
  const fileSize = info ? formatBytes(info.fileSizeBytes) : null;
  const checksum = info?.checksumSha256 ? `sha256:${info.checksumSha256}` : null;

  const handleCopy = () => {
    if (!checksum) return;
    navigator.clipboard.writeText(checksum).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Download ${listing.title}`}
        className="relative w-full max-w-lg rounded-2xl bg-theme-card border border-theme shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-theme">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              isSkill ? 'bg-cobalt-500/10' : 'bg-teal-500/15'
            )}>
              <Download size={20} className={isSkill ? 'text-cobalt-500 dark:text-cobalt-300' : 'text-teal-400'} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-theme-primary">Download {isSkill ? 'Skill Adapter' : 'Dataset'}</h2>
              <p className="text-xs text-theme-tertiary">{listing.title}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-brand hover:bg-theme-hover text-theme-secondary hover:text-theme-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* File info */}
          <div className="rounded-lg bg-theme-elevated border border-theme p-4 space-y-3">
            <div className="flex items-center gap-3">
              <FileText size={16} className="text-theme-muted shrink-0" />
              <div className="flex-1 min-w-0">
                {fileName ? (
                  <>
                    <p className="text-sm font-mono text-theme-primary truncate">{fileName}</p>
                    <p className="text-xs text-theme-tertiary mt-0.5">
                      {fileSize} &middot; {formatArtifactFormat(info?.format, isSkill)}
                    </p>
                  </>
                ) : (
                  <div className="animate-pulse">
                    <div className="h-4 w-2/3 rounded bg-theme-hover mb-1.5" />
                    <div className="h-3 w-1/3 rounded bg-theme-hover" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Cpu size={16} className="text-theme-muted shrink-0" />
              <div className="text-xs text-theme-tertiary">
                <span className="text-theme-secondary">{listing.robotType}</span>
                {listing.baseModel !== 'None' && (
                  <> &middot; Base model: <span className="text-theme-secondary">{listing.baseModel}</span></>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Lock size={16} className="text-theme-muted shrink-0" />
              {checksum ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xs font-mono text-theme-tertiary truncate">{checksum}</span>
                  <button type="button" onClick={handleCopy} className="shrink-0 p-1 rounded hover:bg-theme-hover transition-colors">
                    {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="text-theme-tertiary" />}
                  </button>
                </div>
              ) : (
                <span className="text-xs text-theme-tertiary">
                  {info ? 'Checksum not available' : 'Verifying checksum...'}
                </span>
              )}
            </div>
          </div>

          {/* Deployment info */}
          <div className="rounded-lg bg-theme-elevated border border-theme p-4">
            <h3 className="text-xs font-semibold text-theme-secondary uppercase tracking-wide mb-2">After Download</h3>
            <div className="space-y-2">
              {isSkill ? (
                <>
                  <StepRow icon={HardDrive} text={`Place ${fileName ?? 'the adapter file'} in your VLA server's adapter directory`} />
                  <StepRow icon={Server} text={`Configure adapter_path in your VLA server config and restart`} />
                  <StepRow icon={Cpu} text={`The robot agent will load the adapter on next inference call`} />
                </>
              ) : (
                <>
                  <StepRow icon={HardDrive} text="Extract the archive into your LeRobot datasets directory" />
                  <StepRow icon={Server} text="Reference the dataset path in your training job configuration" />
                  <StepRow icon={Cpu} text="Start a fine-tuning job using the training pipeline" />
                </>
              )}
            </div>
          </div>

          {/* Sovereignty banner */}
          <div className="rounded-lg bg-cobalt-500/5 border border-cobalt-500/20 p-3 flex items-start gap-2.5">
            <Shield size={16} className="text-cobalt-500 dark:text-cobalt-300 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-cobalt-500 dark:text-cobalt-300 mb-0.5">Your Infrastructure, Your Data</p>
              <p className="text-xs text-theme-secondary">
                This file runs entirely on your hardware. No telemetry, no cloud calls, no expiration. Full sovereignty over your robot intelligence.
              </p>
            </div>
          </div>

          {/* Download progress / button / error */}
          {state === 'ready' && (
            <button
              type="button"
              onClick={() => start()}
              disabled={!info}
              className={cn(
                'w-full py-3 rounded-brand text-sm font-medium transition-colors flex items-center justify-center gap-2',
                info
                  ? 'bg-cobalt-500 text-white hover:bg-cobalt-600'
                  : 'bg-theme-elevated text-theme-muted cursor-not-allowed'
              )}
            >
              {info ? (
                <>
                  <Download size={16} />
                  Download {fileSize}
                </>
              ) : (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Preparing download...
                </>
              )}
            </button>
          )}

          {state === 'downloading' && (
            <div>
              <div className="flex items-center justify-between text-xs text-theme-secondary mb-2">
                <span>Downloading...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-theme-elevated overflow-hidden">
                <div
                  className="h-full rounded-full bg-cobalt-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-theme-tertiary mt-2 text-center">
                Downloading from secure storage...
              </p>
            </div>
          )}

          {state === 'complete' && (
            <div className="text-center py-2">
              <div className="flex items-center justify-center gap-2 text-emerald-400 mb-2">
                <CheckCircle size={20} />
                <span className="text-sm font-medium">Download Complete</span>
              </div>
              <p className="text-xs text-theme-tertiary">
                {fileName} saved to your downloads folder
              </p>
            </div>
          )}

          {state === 'error' && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-400">{error ?? 'Download failed'}</p>
              </div>
              {info && (
                <button
                  type="button"
                  onClick={() => start()}
                  className="text-xs text-cobalt-500 dark:text-cobalt-300 hover:underline"
                >
                  Try again
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer stats */}
        <div className="px-5 py-3 border-t border-theme flex items-center justify-between text-xs text-theme-tertiary">
          <span>{formatCredits(listing.downloadCount)} total downloads</span>
          <span>v{info?.version ?? '1.0.0'} &middot; Published {formatDate(listing.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function StepRow({ icon: Icon, text }: { icon: typeof HardDrive; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={14} className="text-cobalt-500 dark:text-cobalt-300 mt-0.5 shrink-0" />
      <p className="text-xs text-theme-secondary">{text}</p>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Format a byte count as a human-readable KB/MB/GB string
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

function formatArtifactFormat(format: string | undefined, isSkill: boolean): string {
  if (format === 'safetensors') return 'SafeTensors format';
  if (format === 'lerobot-v3') return 'LeRobot v3 (Parquet + MP4)';
  if (format) return format;
  return isSkill ? 'SafeTensors format' : 'LeRobot v3 (Parquet + MP4)';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(UI_DATE_LOCALE);
}
