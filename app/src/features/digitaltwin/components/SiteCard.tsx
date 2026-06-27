/**
 * @file SiteCard.tsx
 * @description Gallery card for a scanned site (server digital twin): an
 *   occupancy-grid thumbnail, footprint dimensions, point count, a live
 *   build-progress bar while it scans/builds, and Open/Delete actions.
 * @feature digitaltwin
 */

import { memo } from 'react';
import { Button } from '@/shared/components/ui';
import type { Site, TwinStatus } from '../types/twin.types';
import { twinDimensions } from '../types/twin.types';
import { useOccupancyImage } from '../utils/occupancy';

export interface SiteCardProps {
  site: Site;
  /** Human-readable robot name (falls back to the raw id). */
  robotName?: string;
  /** Live build progress 0..100 while the twin is recording/processing. */
  buildProgress?: number;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

const STATUS_BADGE: Record<TwinStatus, { label: string; className: string }> = {
  draft: { label: 'Empty', className: 'bg-surface-700 text-theme-tertiary' },
  recording: { label: 'Scanning', className: 'bg-[#18E4C3] text-black' },
  processing: { label: 'Building', className: 'bg-[#f97316] text-black' },
  ready: { label: 'Scanned', className: 'bg-[#FF6700] text-black' },
  failed: { label: 'Failed', className: 'bg-red-500 text-white' },
};

/** Square occupancy-grid preview; degrades to a status placeholder. */
function SiteThumbnail({ site, buildProgress }: { site: Site; buildProgress?: number }) {
  const occ = useOccupancyImage(site.id, !!site.hasOccupancy);
  const busy = site.status === 'recording' || site.status === 'processing';

  return (
    <div className="relative aspect-[16/10] rounded-md overflow-hidden bg-surface-950 border border-surface-800 flex items-center justify-center">
      {occ ? (
        <img
          src={occ.url}
          alt={`${site.name} occupancy grid`}
          className="w-full h-full object-contain p-2"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : busy ? (
        <div className="flex flex-col items-center gap-2 text-theme-tertiary">
          <span className="inline-block w-5 h-5 rounded-full border-2 border-surface-600 border-t-[#FF6700] animate-spin" />
          <span className="text-[11px] uppercase tracking-wide">
            {site.status === 'recording' ? 'Scanning room…' : 'Building twin…'}
          </span>
        </div>
      ) : site.status === 'failed' ? (
        <span className="text-xs text-red-400">Build failed</span>
      ) : (
        <span className="text-[11px] uppercase tracking-wide text-theme-tertiary">No scan yet</span>
      )}

      {/* Live build-progress overlay (bottom edge). */}
      {busy && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-surface-800">
          <div
            className={`h-full transition-all ${site.status === 'recording' ? 'bg-[#18E4C3] animate-pulse w-1/3' : 'bg-[#f97316]'}`}
            style={site.status === 'processing' ? { width: `${buildProgress ?? 0}%` } : undefined}
          />
        </div>
      )}
    </div>
  );
}

export const SiteCard = memo(function SiteCard({ site, robotName, buildProgress, onOpen, onDelete }: SiteCardProps) {
  const badge = STATUS_BADGE[site.status] ?? STATUS_BADGE.draft;
  const dims = twinDimensions(site.bounds);

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900/60 p-3 flex flex-col gap-3 hover:border-surface-600 transition-colors">
      <SiteThumbnail site={site} buildProgress={buildProgress} />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-theme-primary truncate">{site.name}</h3>
          <p className="text-xs text-theme-tertiary mt-0.5 truncate">{robotName || site.robotId || '—'}</p>
        </div>
        <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-theme-tertiary">
        {dims && (
          <span className="text-theme-secondary font-mono">
            {dims.width.toFixed(1)} × {dims.length.toFixed(1)} m
          </span>
        )}
        {dims && <span>{Math.round(dims.area)} m²</span>}
        {site.pointCount ? <span>{site.pointCount.toLocaleString()} pts</span> : null}
      </div>
      <div className="text-[11px] text-theme-tertiary">{new Date(site.createdAt).toLocaleString()}</div>

      <div className="flex gap-2 mt-auto pt-1">
        <Button variant="primary" size="sm" onClick={() => onOpen(site.id)}>Open</Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(site.id)}>Delete</Button>
      </div>
    </div>
  );
});
