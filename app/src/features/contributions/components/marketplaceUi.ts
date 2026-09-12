/**
 * @file marketplaceUi.ts
 * @description Shared UI constants and formatters for the marketplace pages (filters, sort, dates, sizes)
 * @feature marketplace
 */

import { UI_DATE_LOCALE } from '@/shared/utils/format';
import type {
  BaseModelType,
  MarketplaceListing,
  RobotHardwareType,
} from '../types/marketplace.types';

export const ROBOT_TYPES: RobotHardwareType[] = ['Unitree G1', 'SO-101', 'Unitree H1', 'Generic'];
export const BASE_MODELS: BaseModelType[] = ['SmolVLA', 'Pi0.5', 'OpenVLA', 'None'];

export type MarketplaceSort = 'featured' | 'downloads' | 'rating' | 'newest';

export const SORT_OPTIONS: { value: MarketplaceSort; label: string }[] = [
  { value: 'featured', label: 'Featured first' },
  { value: 'downloads', label: 'Most downloaded' },
  { value: 'rating', label: 'Top rated' },
  { value: 'newest', label: 'Newest' },
];

/** Sort a copy of the listings by the chosen order */
export function sortListings(listings: MarketplaceListing[], sort: MarketplaceSort): MarketplaceListing[] {
  const byNewest = (a: MarketplaceListing, b: MarketplaceListing) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  const copy = [...listings];
  switch (sort) {
    case 'downloads':
      return copy.sort((a, b) => b.downloadCount - a.downloadCount);
    case 'rating':
      return copy.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
    case 'newest':
      return copy.sort(byNewest);
    default:
      return copy.sort(
        (a, b) =>
          Number(b.isFeatured) - Number(a.isFeatured) ||
          Number(b.isTrending) - Number(a.isTrending) ||
          b.downloadCount - a.downloadCount
      );
  }
}

/** Absolute date, e.g. "Jul 11, 2026" */
export function formatMarketplaceDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(UI_DATE_LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Human-readable byte count */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/** Plain-language artifact format */
export function formatArtifactFormat(format: string | undefined, isSkill: boolean): string {
  if (format === 'safetensors') return 'SafeTensors adapter';
  if (format === 'lerobot-v3') return 'LeRobot v3 (Parquet + MP4)';
  if (format) return format;
  return isSkill ? 'SafeTensors adapter' : 'LeRobot v3 (Parquet + MP4)';
}

/** "Skill" / "Dataset" */
export function listingTypeLabel(listing: Pick<MarketplaceListing, 'type'>): string {
  return listing.type === 'skill' ? 'Skill' : 'Dataset';
}
