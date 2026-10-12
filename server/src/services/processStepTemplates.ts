/**
 * @file processStepTemplates.ts
 * @description Shape check for process step templates (TASK-386). A definition
 *              with a step that has no name or an unknown actionType used to
 *              save, publish and schedule fine — and then every start failed
 *              with 500 when the instance steps were written.
 * @feature processes
 */

import { StepActionTypes } from '../types/process.types.js';

/** True when `value` is one of the step actions the executor knows. */
export function isStepActionType(value: unknown): boolean {
  return (StepActionTypes as readonly unknown[]).includes(value);
}

/**
 * Validate the shape of a stepTemplates value.
 *
 * @param stepTemplates - The raw value from the request body or the stored definition
 * @returns The first problem as a sentence naming the step index, or null when valid
 */
export function stepTemplatesError(stepTemplates: unknown): string | null {
  if (!Array.isArray(stepTemplates)) return 'stepTemplates must be an array';

  for (let i = 0; i < stepTemplates.length; i++) {
    const step: unknown = stepTemplates[i];
    const at = `stepTemplates[${i}]`;
    if (typeof step !== 'object' || step === null || Array.isArray(step)) {
      return `${at} must be an object`;
    }
    const { name, actionType, actionConfig } = step as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') {
      return `${at}.name must be a non-empty string`;
    }
    if (!isStepActionType(actionType)) {
      return `${at}.actionType must be one of: ${StepActionTypes.join(', ')}`;
    }
    if (typeof actionConfig !== 'object' || actionConfig === null || Array.isArray(actionConfig)) {
      return `${at}.actionConfig must be an object`;
    }
  }
  return null;
}
