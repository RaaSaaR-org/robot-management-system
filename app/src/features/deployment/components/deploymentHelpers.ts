/**
 * @file deploymentHelpers.ts
 * @description Pure helpers shared by the deployment pages: status tones, names, filters,
 * canary stage math and the skill-parameter <-> JSON Schema mapping.
 * @feature deployment
 */

import type { StatusToneName } from '@/shared/components/ui';
import type { Deployment, DeploymentStatus, ModelVersion, SkillParameter } from '../types';

/** Rollouts that are still moving, plus the one serving traffic: they show up under "Active". */
export const ACTIVE_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  'pending',
  'deploying',
  'canary',
  'production',
  'rolling_back',
];

export type DeploymentScope = 'active' | 'history' | 'all';

export function isActiveDeployment(d: Pick<Deployment, 'status'>): boolean {
  return ACTIVE_DEPLOYMENT_STATUSES.includes(d.status);
}

export function inScope(d: Pick<Deployment, 'status'>, scope: DeploymentScope): boolean {
  if (scope === 'all') return true;
  return scope === 'active' ? isActiveDeployment(d) : !isActiveDeployment(d);
}

/**
 * Tone for statuses the kit's statusTone() map does not know (canary, production, deprecated…).
 * Returns undefined for the ones it does, so StatusTag derives them itself.
 */
export function deployToneFor(status: string): StatusToneName | undefined {
  switch (status) {
    case 'deploying':
    case 'canary':
    case 'rolling_back':
      return 'info';
    case 'production':
      return 'success';
    case 'rolled_back':
    case 'deprecated':
      return 'warning';
    default:
      return undefined;
  }
}

/** Rollouts that are currently moving get a pulsing dot. */
export function isMoving(status: string): boolean {
  return status === 'deploying' || status === 'canary' || status === 'rolling_back';
}

export const canPromote = (d: Pick<Deployment, 'status'>) => d.status === 'canary';
export const canRollBack = (d: Pick<Deployment, 'status'>) =>
  d.status === 'deploying' || d.status === 'canary' || d.status === 'production';
export const canCancel = (d: Pick<Deployment, 'status'>) =>
  d.status === 'pending' || d.status === 'deploying' || d.status === 'canary';

/** The human name of a model version: its name, else its skill's name, else "Model v…". */
export function modelName(mv?: Pick<ModelVersion, 'name' | 'version' | 'skill'> | null): string {
  if (!mv) return 'Unknown model';
  return mv.name?.trim() || mv.skill?.name || `Model v${mv.version}`;
}

export function deploymentName(d: Pick<Deployment, 'modelVersion' | 'modelVersionId'>): string {
  return d.modelVersion ? modelName(d.modelVersion) : `Model #${d.modelVersionId.slice(0, 6)}`;
}

const STRATEGY_LABELS: Record<string, string> = {
  canary: 'Canary',
  blue_green: 'Blue-green',
  rolling: 'Rolling',
};

export function strategyLabel(strategy: string): string {
  return STRATEGY_LABELS[strategy] ?? strategy;
}

/** "24 h", "1 h 30 min", "45 min", or "Until promoted" for the final stage. */
export function formatStageDuration(minutes: number): string {
  if (minutes <= 0) return 'Until promoted';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Number of canary stages whose traffic share has been reached. */
export function reachedStages(d: Pick<Deployment, 'canaryConfig' | 'trafficPercentage' | 'status'>): number {
  const stages = d.canaryConfig?.stages ?? [];
  if (d.status === 'production' || d.status === 'completed') return stages.length;
  return stages.filter((s) => d.trafficPercentage >= s.percentage && d.trafficPercentage > 0).length;
}

/** Readable text for an Error, the API client's `{ message }` rejection, or anything else. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message) {
    return err.message;
  }
  return typeof err === 'string' ? err : 'Something went wrong. Try again.';
}

// ---------------------------------------------------------------------------
// Skill parameters <-> JSON Schema
// ---------------------------------------------------------------------------

const PARAM_TYPES: SkillParameter['type'][] = ['string', 'number', 'boolean', 'array', 'object'];

/** Build the JSON Schema the server stores from the flat parameter list the form edits. */
export function parametersToSchema(params: SkillParameter[]): Record<string, unknown> {
  if (params.length === 0) return {};
  const properties: Record<string, Record<string, unknown>> = {};
  for (const p of params) {
    properties[p.name] = { type: p.type, ...(p.description ? { description: p.description } : {}) };
  }
  const required = params.filter((p) => p.required).map((p) => p.name);
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/** Read the flat parameter list back out of a skill's JSON Schema (or its `parameters`, if set). */
export function schemaToParameters(
  schema: Record<string, unknown> | undefined,
  fallback?: SkillParameter[],
): SkillParameter[] {
  const props = schema?.properties;
  if (!props || typeof props !== 'object') return fallback ? [...fallback] : [];
  const required = Array.isArray(schema?.required) ? (schema.required as string[]) : [];
  return Object.entries(props as Record<string, Record<string, unknown>>).map(([name, def]) => {
    const t = def?.type as SkillParameter['type'];
    return {
      name,
      type: PARAM_TYPES.includes(t) ? t : 'string',
      required: required.includes(name),
      description: typeof def?.description === 'string' ? def.description : undefined,
    };
  });
}
