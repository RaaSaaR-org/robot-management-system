/**
 * @file MarketplaceDownloadModal.tsx
 * @description Download modal showing real file details, sovereignty info, and artifact download
 * @feature marketplace
 */

import { useState } from 'react';
import {
  X, Download, Shield, HardDrive, FileText, Server,
  CheckCircle, Cpu, Copy, Check, Lock, AlertTriangle, Loader2,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { formatCredits } from '../types/contributions.types';
import { useMarketplaceDownload } from '../hooks/marketplace';
import type { MarketplaceListing } from '../types/marketplace.types';

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-2xl bg-[#1a1b1f] border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              isSkill ? 'bg-[#FF6700]/15' : 'bg-teal-500/15'
            )}>
              <Download size={20} className={isSkill ? 'text-[#FF6700]' : 'text-teal-400'} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Download {isSkill ? 'Skill Adapter' : 'Dataset'}</h2>
              <p className="text-xs text-gray-500">{listing.title}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* File info */}
          <div className="rounded-lg bg-white/5 border border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <FileText size={16} className="text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                {fileName ? (
                  <>
                    <p className="text-sm font-mono text-white truncate">{fileName}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {fileSize} &middot; {formatArtifactFormat(info?.format, isSkill)}
                    </p>
                  </>
                ) : (
                  <div className="animate-pulse">
                    <div className="h-4 w-2/3 rounded bg-white/10 mb-1.5" />
                    <div className="h-3 w-1/3 rounded bg-white/5" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Cpu size={16} className="text-gray-400 shrink-0" />
              <div className="text-xs text-gray-400">
                <span className="text-gray-300">{listing.robotType}</span>
                {listing.baseModel !== 'None' && (
                  <> &middot; Base model: <span className="text-gray-300">{listing.baseModel}</span></>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Lock size={16} className="text-gray-400 shrink-0" />
              {checksum ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xs font-mono text-gray-500 truncate">{checksum}</span>
                  <button type="button" onClick={handleCopy} className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors">
                    {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="text-gray-500" />}
                  </button>
                </div>
              ) : (
                <span className="text-xs text-gray-500">
                  {info ? 'Checksum not available' : 'Verifying checksum...'}
                </span>
              )}
            </div>
          </div>

          {/* Deployment info */}
          <div className="rounded-lg bg-white/5 border border-white/10 p-4">
            <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-2">After Download</h3>
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
          <div className="rounded-lg bg-[#FF6700]/5 border border-[#FF6700]/20 p-3 flex items-start gap-2.5">
            <Shield size={16} className="text-[#FF6700] mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-[#FF6700] mb-0.5">Your Infrastructure, Your Data</p>
              <p className="text-xs text-gray-400">
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
                'w-full py-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
                info
                  ? 'bg-[#FF6700] text-white hover:bg-[#e05d00]'
                  : 'bg-white/10 text-gray-500 cursor-not-allowed'
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
              <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                <span>Downloading...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#FF6700] transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2 text-center">
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
              <p className="text-xs text-gray-500">
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
                  className="text-xs text-[#FF6700] hover:underline"
                >
                  Try again
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer stats */}
        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between text-xs text-gray-500">
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
      <Icon size={14} className="text-[#FF6700] mt-0.5 shrink-0" />
      <p className="text-xs text-gray-400">{text}</p>
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
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}
