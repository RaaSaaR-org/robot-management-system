/**
 * @file social.ts
 * @description Pure helpers for the social layer (TASK-241): where an
 *   evidence ref or a subject links to, how a 0..1 score reads for a human
 *   (stars) or a machine (percent), and a stable key per subject.
 * @feature social
 */

import type { ActorType, EvidenceRef, SubjectRef, SubjectType } from '../types/social.types';

/** Where an evidence chip points. `external` opens in a new tab. */
export interface EvidenceLink {
  label: string;
  href: string;
  external: boolean;
}

const q = encodeURIComponent;

/** Build the link for one evidence ref — an agent's claim is one click from its proof. */
export function evidenceLink(e: EvidenceRef): EvidenceLink {
  switch (e.kind) {
    case 'evaluation_episode':
      return {
        label: e.ids.length === 1 ? `Evaluation ${short(e.ids[0])}` : `${e.ids.length} evaluation episodes`,
        href: `/training?tab=evaluation&episode=${q(e.ids[0])}`,
        external: false,
      };
    case 'sim_to_real_validation':
      return { label: `Sim-to-real ${short(e.id)}`, href: `/training?tab=simulation&validation=${q(e.id)}`, external: false };
    case 'episode_reward':
      return { label: `${e.rewardType} rewards`, href: `/datasets/${q(e.datasetId)}/episodes?reward=${q(e.rewardType)}`, external: false };
    case 'training_job':
      return { label: `Run ${short(e.id)}`, href: `/training?job=${q(e.id)}`, external: false };
    case 'model_version':
      return { label: `Model ${short(e.id)}`, href: `/models?model=${q(e.id)}`, external: false };
    case 'dataset':
      return { label: `Dataset ${short(e.id)}`, href: `/datasets/${q(e.id)}/episodes`, external: false };
    case 'external':
      return { label: e.note || e.uri, href: e.uri, external: true };
  }
}

/** Where a subject lives in the app (used by the activity feed). */
export function subjectLink(s: { subjectType: SubjectType; subjectId: string; episodeIndex?: number | null }): string {
  switch (s.subjectType) {
    case 'dataset':
    case 'dataset_view':
      return `/datasets/${q(s.subjectId)}/episodes`;
    case 'episode':
      return `/datasets/${q(s.subjectId)}/episodes?episode=${s.episodeIndex ?? 0}`;
    case 'model_version':
      return `/models?model=${q(s.subjectId)}`;
    case 'training_job':
      return `/training?job=${q(s.subjectId)}`;
    case 'experiment':
      return `/experiments/${q(s.subjectId)}`;
  }
}

export const SUBJECT_LABEL: Record<SubjectType, string> = {
  dataset: 'Dataset',
  dataset_view: 'Dataset view',
  model_version: 'Model',
  episode: 'Episode',
  training_job: 'Training run',
  experiment: 'Experiment',
};

export const ACTOR_LABEL: Record<ActorType, string> = { user: 'Person', agent: 'Agent', system: 'System' };

/** 0..1 → whole stars out of five (humans rate in stars). */
export function scoreToStars(score: number): number {
  return Math.max(0, Math.min(5, Math.round(score * 5)));
}

/** Stars out of five → 0..1. */
export function starsToScore(stars: number): number {
  return Math.max(0, Math.min(5, stars)) / 5;
}

/** 0..1 → "72%" (machines report a percentage). */
export function formatPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/** "coverage" / "labelQuality" → "Coverage" / "Label quality". */
export function dimensionLabel(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** One stable key per subject, for the store. */
export function subjectKey(s: SubjectRef): string {
  return s.subjectType === 'episode' ? `${s.subjectType}:${s.subjectId}#${s.episodeIndex ?? 0}` : `${s.subjectType}:${s.subjectId}`;
}

function short(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id;
}
