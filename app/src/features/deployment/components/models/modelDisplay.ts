/**
 * @file modelDisplay.ts
 * @description Naming rules shared by the model registry table, the details
 *              modal and the model version card (TASK-238, TASK-266)
 * @feature deployment
 */

import type { ModelVersion } from '../../types';

/**
 * Label for a version with no skill. A model registered from outside carries
 * no skill until someone links it — the normal state of a fresh registry, not
 * a lookup failure, so it must never read "Unknown Skill".
 */
export const UNLINKED_SKILL_LABEL = 'Not linked to a skill';

/**
 * The model's headline: its own name, else its skill's name, else
 * "Model ‹version›" — never "Unknown Skill".
 */
export function getModelDisplayName(version: ModelVersion): string {
  return version.name || version.skill?.name || `Model ${version.version}`;
}

/**
 * The skill a version is linked to, resolved from the relation, then from the
 * skills already loaded, then by id. Returns null when the version has no
 * skill at all (`null` from the registry, `''` from an older payload).
 */
/**
 * A version as a label: "v1.2.0" for one that starts with a digit — the
 * timestamps this server stamps, a semver — and the version as it is for a
 * name like "g11-step-5000", which "v" would only garble.
 */
export function getVersionLabel(version: string): string {
  return /^\d/.test(version) ? `v${version}` : version;
}

/** Names of the foundation models a VLA is fine-tuned from, by registry value. */
const BASE_MODEL_LABELS: Record<string, string> = {
  smolvla: 'SmolVLA',
  pi0: 'Pi0',
  pi0_6: 'Pi0.6',
  openvla: 'OpenVLA',
  groot: 'GR00T',
  groot_n1_7: 'GR00T N1.7',
};

/**
 * The foundation model a version states it was fine-tuned from, in words —
 * null when it states none. A value this build does not know is shown as it is.
 */
export function getBaseModelLabel(version: { baseModel?: string | null }): string | null {
  if (!version.baseModel) return null;
  return BASE_MODEL_LABELS[version.baseModel] ?? version.baseModel;
}

/** 6918209810 → "6.4 GB" — binary units, as the dataset pages show sizes. */
export function formatArtifactSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function resolveSkillName(
  version: ModelVersion,
  skillNamesById: Map<string, string>,
): string | null {
  const skillId = version.skillId;
  if (!skillId) return null;
  return version.skill?.name ?? skillNamesById.get(skillId) ?? `Skill ${skillId.slice(0, 8)}`;
}
