/**
 * @file OrganizationCard.tsx
 * @description Card showing a single organization: name, slug, plan,
 * per-entity counts, created date, and delete action. The system DEFAULT
 * tenant shows a badge and cannot be deleted.
 * @feature organizations
 */

import { useState } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { cn } from '@/shared/utils/cn';
import type { Organization, TenantSettings } from '../types/organizations.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

function parseSettings(raw: string): TenantSettings {
  try { return JSON.parse(raw) as TenantSettings; } catch { return {}; }
}

interface OrganizationCardProps {
  organization: Organization;
  onDelete: (id: string) => Promise<void> | void;
  onEdit?: (organization: Organization) => void;
}

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const BuildingIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(UI_DATE_LOCALE, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-brand bg-theme-elevated border border-theme px-3 py-2">
      <div className="text-2xl font-semibold text-theme-primary tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-theme-tertiary mt-0.5">
        {label}
      </div>
    </div>
  );
}

const PencilIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

export function OrganizationCard({ organization, onDelete, onEdit }: OrganizationCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const settings = parseSettings(organization.settings);
  const brandColor = settings.brandColor;

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    try {
      await onDelete(organization.id);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div
      className={cn(
        'group relative rounded-brand border border-theme bg-theme-card p-5',
        'transition-colors hover:border-theme-strong',
        organization.isDefault && 'ring-1 ring-cobalt/30'
      )}
    >
      {/* Header: icon + name + slug + badges */}
      <div className="flex items-start gap-4 mb-4">
        <div
          className={cn(
            'w-12 h-12 rounded-brand flex items-center justify-center shrink-0 overflow-hidden',
            !brandColor && 'bg-cobalt/10 text-cobalt'
          )}
          style={brandColor ? { backgroundColor: `${brandColor}20`, color: brandColor } : undefined}
        >
          {organization.logoUrl ? (
            <img src={organization.logoUrl} alt={organization.name} className="w-full h-full object-contain" />
          ) : (
            <BuildingIcon />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-semibold text-theme-primary truncate">
              {organization.name}
            </h3>
            {organization.isDefault && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cobalt/15 text-cobalt">
                Default
              </span>
            )}
            {organization.plan && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-theme-elevated text-theme-secondary border border-theme">
                {organization.plan}
              </span>
            )}
          </div>
          <div className="text-sm text-theme-tertiary font-mono mt-0.5">
            {organization.slug}
          </div>
        </div>
      </div>

      {/* Counts grid */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <StatTile label="Users" value={organization.counts.users} />
        <StatTile label="Robots" value={organization.counts.robots} />
        <StatTile label="Datasets" value={organization.counts.datasets} />
        <StatTile label="Jobs" value={organization.counts.trainingJobs} />
      </div>

      {/* Footer: created + delete */}
      <div className="flex items-center justify-between text-xs text-theme-tertiary">
        <span>Created {formatDate(organization.createdAt)}</span>
        <div className="flex items-center gap-2">
          {onEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(organization)}
              leftIcon={<PencilIcon />}
            >
              Edit
            </Button>
          )}
          {!organization.isDefault && (
            <Button
              variant={confirming ? 'destructive' : 'ghost'}
              size="sm"
              onClick={handleDelete}
              isLoading={deleting}
              leftIcon={<TrashIcon />}
            >
              {confirming ? 'Confirm delete' : 'Delete'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
