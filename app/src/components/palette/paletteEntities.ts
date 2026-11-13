/**
 * @file paletteEntities.ts
 * @description The things — not pages — the palette finds by name: datasets and
 *              robots. Typing "apple" used to find only pages, because the
 *              palette read nothing but the navigation model (TASK-486). Both
 *              lists are small and already served by the endpoints their own
 *              pages use, so the palette asks for them once per opening and
 *              filters in the browser; a failed request simply leaves the
 *              palette with its pages.
 * @feature layout
 */

import { Bot, Database, type LucideIcon } from 'lucide-react';
import { robotsApi } from '@/features/robots/api/robotsApi';
import { trainingApi } from '@/features/training/api/trainingApi';

export type PaletteEntityKind = 'dataset' | 'robot';

export interface PaletteEntity {
  kind: PaletteEntityKind;
  /** The name a person knows it by */
  label: string;
  /** Also searchable, and shown muted after the label: a Hub repo id, a robot id or model */
  detail?: string;
  /** Where Enter goes */
  path: string;
  icon: LucideIcon;
}

/** What the muted trail calls each kind. */
export const ENTITY_KIND_LABEL: Record<PaletteEntityKind, string> = {
  dataset: 'Dataset',
  robot: 'Robot',
};

/** Enough for any instance this ships to; the palette is not a paginated browser. */
const PAGE_SIZE = 200;

async function loadDatasets(): Promise<PaletteEntity[]> {
  const { datasets } = await trainingApi.listDatasets({ pageSize: PAGE_SIZE });
  return datasets.map((d) => ({
    kind: 'dataset' as const,
    label: d.name,
    detail: d.huggingFaceRepoId ?? undefined,
    path: `/datasets/${encodeURIComponent(d.id)}/episodes`,
    icon: Database,
  }));
}

async function loadRobots(): Promise<PaletteEntity[]> {
  const { robots } = await robotsApi.listRobots({ pageSize: PAGE_SIZE });
  return robots.map((r) => ({
    kind: 'robot' as const,
    label: r.name || r.id,
    detail: r.name && r.name !== r.id ? r.id : undefined,
    path: `/robots/${encodeURIComponent(r.id)}`,
    icon: Bot,
  }));
}

/**
 * Datasets and robots by name. Each list fails on its own: a server without
 * datasets must not cost the palette its robots.
 */
export async function loadPaletteEntities(): Promise<PaletteEntity[]> {
  const settled = await Promise.allSettled([loadDatasets(), loadRobots()]);
  return settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

/** How well `needle` (lowercase, non-empty) names an entity; null when it does not. */
export function entityRank(entity: PaletteEntity, needle: string): 'prefix' | 'contains' | null {
  const label = entity.label.toLowerCase();
  // The start of the name or of any word in it: "apple" and "plate" both find
  // "Apple to Plate".
  if (label.startsWith(needle) || label.split(/[^a-z0-9]+/).some((word) => word.startsWith(needle))) return 'prefix';
  if (label.includes(needle) || entity.detail?.toLowerCase().includes(needle)) return 'contains';
  // No subsequence matching here: scattered letters across a hundred dataset
  // names would bury the pages.
  return null;
}
