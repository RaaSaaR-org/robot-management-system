/**
 * @file mapColors.ts
 * @description Token-safe colours for the fleet map: robot status and zone type
 *   resolve to CSS variables, so the map follows the theme and the contract's
 *   signal colours instead of hard-coded hex.
 * @feature fleet
 */

import { statusTone, type Tone } from '@/shared/components/ui';
import type { ZoneType } from '../types/fleet.types';

/** CSS variable for each kit tone, usable as an SVG fill/stroke. */
export const TONE_VAR: Record<string, string> = {
  success: 'var(--signal-measured)',
  live: 'var(--signal-measured)',
  info: 'var(--signal-estimated)',
  sim: 'var(--signal-estimated)',
  warning: 'var(--signal-unknown)',
  gated: 'var(--signal-unknown)',
  danger: 'var(--signal-stopped)',
  stopped: 'var(--signal-stopped)',
  accent: 'var(--color-primary)',
  neutral: 'var(--text-muted)',
};

/** Map colour of a robot marker, derived from its status via statusTone. */
export function robotStatusColor(status: string): string {
  return TONE_VAR[statusTone(status)] ?? TONE_VAR.neutral;
}

/** StatusTag tone for each zone type (Zones table, legend). */
export const ZONE_TYPE_TONE: Record<ZoneType, Tone> = {
  operational: 'accent',
  charging: 'success',
  maintenance: 'warning',
  restricted: 'danger',
};

/** Human label for each zone type. */
export const ZONE_TYPE_LABEL: Record<ZoneType, string> = {
  operational: 'Operational',
  charging: 'Charging',
  maintenance: 'Maintenance',
  restricted: 'Restricted',
};

/**
 * Token-safe palette a zone may carry as its `color`. The value stored on the
 * zone is the palette key; older zones may still carry a hex string from the
 * API — that is data and is rendered as-is.
 */
export const ZONE_COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'By zone type' },
  { value: 'mint', label: 'Mint' },
  { value: 'violet', label: 'Violet' },
  { value: 'amber', label: 'Amber' },
  { value: 'red', label: 'Red' },
  { value: 'grey', label: 'Grey' },
];

const ZONE_PALETTE_VAR: Record<string, string> = {
  mint: 'var(--color-primary)',
  violet: 'var(--signal-estimated)',
  amber: 'var(--signal-unknown)',
  red: 'var(--signal-stopped)',
  grey: 'var(--text-muted)',
};

/** Stroke/fill colour of a zone on the map. */
export function zoneColor(type: ZoneType, color?: string): string {
  if (color) return ZONE_PALETTE_VAR[color] ?? color;
  return TONE_VAR[ZONE_TYPE_TONE[type]] ?? TONE_VAR.accent;
}
