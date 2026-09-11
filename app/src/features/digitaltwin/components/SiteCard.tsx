/**
 * @file SiteCard.tsx
 * @description Gallery card for a scanned site (server digital twin): an
 *   occupancy-grid thumbnail, name, robot, status tag, footprint and point
 *   count, a live build-progress bar while it builds, and RowActions (Open,
 *   Delete). The whole card opens the viewer.
 * @feature digitaltwin
 */

import { memo, useState } from 'react';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import { Panel, ProgressBar, RowActions, Spinner, StatusTag, type StatusTagTone } from '@/shared/components/ui';
import type { Site, TwinStatus } from '../types/twin.types';
import { twinDimensions } from '../types/twin.types';
import { useOccupancyImage, type OccupancyImage } from '../utils/occupancy';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface SiteCardProps {
  site: Site;
  /** Human-readable robot name (falls back to the raw id). */
  robotName?: string;
  /** Live build progress 0..100 while the twin is recording/processing. */
  buildProgress?: number;
  onOpen: (id: string) => void;
  onDelete: (site: Site) => void;
}

/** Display label + tone per twin status (shared with the viewer page). */
export const TWIN_STATUS_TAG: Record<TwinStatus, { label: string; tone: StatusTagTone }> = {
  draft: { label: 'Empty', tone: 'neutral' },
  recording: { label: 'Scanning', tone: 'info' },
  processing: { label: 'Building', tone: 'info' },
  ready: { label: 'Scanned', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** Occupancy-grid preview; degrades to a status placeholder. */
function SiteThumbnail({ site, occ, onImageError }: { site: Site; occ: OccupancyImage | null; onImageError: () => void }) {
  const busy = site.status === 'recording' || site.status === 'processing';
  return (
    <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-control border border-line-subtle bg-inset">
      {occ ? (
        <img
          src={occ.url}
          alt={`${site.name} occupancy grid`}
          className="h-full w-full object-contain p-2"
          style={{ imageRendering: 'pixelated' }}
          onError={onImageError}
        />
      ) : busy ? (
        <div className="flex flex-col items-center gap-2 text-ink-tertiary">
          <Spinner size="sm" color="primary" />
          <span className="text-xs">{site.status === 'recording' ? 'Scanning room…' : 'Building twin…'}</span>
        </div>
      ) : (
        <span className="text-xs text-ink-tertiary">{site.status === 'failed' ? 'Build failed' : 'No scan yet'}</span>
      )}
    </div>
  );
}

export const SiteCard = memo(function SiteCard({ site, robotName, buildProgress, onOpen, onDelete }: SiteCardProps) {
  // The decoded occupancy image is the single source of truth for "this site
  // has a scan": both the thumbnail and the status tag derive from it, so
  // they can never contradict — a 'ready' twin whose grid is missing or
  // unreachable shows "Empty" + "No scan yet" instead of a bogus "Scanned".
  const occ = useOccupancyImage(site.id, !!site.hasOccupancy);
  const [imgFailed, setImgFailed] = useState(false);
  const hasScan = !!occ && !imgFailed;
  const displayStatus: TwinStatus = site.status === 'ready' && !hasScan ? 'draft' : site.status;
  const tag = TWIN_STATUS_TAG[displayStatus] ?? TWIN_STATUS_TAG.draft;
  const dims = twinDimensions(site.bounds);
  const facts = [
    dims ? `${dims.width.toFixed(1)} × ${dims.length.toFixed(1)} m` : null,
    dims ? `${Math.round(dims.area)} m²` : null,
    site.pointCount ? `${site.pointCount.toLocaleString(UI_DATE_LOCALE)} points` : null,
  ].filter(Boolean);

  return (
    <Panel
      interactive
      padding="sm"
      onClick={() => onOpen(site.id)}
      aria-label={`Open ${site.name}`}
      className="flex flex-col gap-3"
      data-testid="site-card"
    >
      <SiteThumbnail site={site} occ={hasScan ? occ : null} onImageError={() => setImgFailed(true)} />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink-primary">{site.name}</h3>
          <p className="truncate text-[13px] text-ink-tertiary">
            {robotName || site.robotId || 'No robot'} · {new Date(site.createdAt).toLocaleDateString(UI_DATE_LOCALE)}
          </p>
        </div>
        <RowActions
          label={`Actions for ${site.name}`}
          items={[
            { label: 'Open', icon: <ArrowUpRight />, onSelect: () => onOpen(site.id) },
            { label: 'Delete', icon: <Trash2 />, tone: 'danger', separatorBefore: true, onSelect: () => onDelete(site) },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusTag tone={tag.tone} dot pulse={displayStatus === 'recording'}>{tag.label}</StatusTag>
        {facts.length > 0 && <span className="text-[13px] tabular-nums text-ink-secondary">{facts.join(' · ')}</span>}
      </div>

      {site.status === 'processing' && (
        <ProgressBar value={buildProgress ?? 0} size="sm" label="Building" />
      )}
    </Panel>
  );
});
