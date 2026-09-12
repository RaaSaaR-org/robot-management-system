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
export function resolveSkillName(
  version: ModelVersion,
  skillNamesById: Map<string, string>,
): string | null {
  const skillId = version.skillId;
  if (!skillId) return null;
  return version.skill?.name ?? skillNamesById.get(skillId) ?? `Skill ${skillId.slice(0, 8)}`;
}
