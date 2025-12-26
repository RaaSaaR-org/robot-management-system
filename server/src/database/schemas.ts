/**
 * @file schemas.ts
 * @description Safe JSON parsing utilities for database data
 */

import { z } from 'zod';

// ============================================================================
// ROBOT SCHEMAS
// ============================================================================

export const RobotLocationSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number().optional(),
  floor: z.string().optional(),
  zone: z.string().optional(),
  heading: z.number().optional(),
});

export const RobotStatusSchema = z.enum([
  'online',
  'offline',
  'busy',
  'error',
  'charging',
  'maintenance',
]);

// ============================================================================
// SAFE PARSE HELPERS
// ============================================================================

/**
 * Safely parse JSON and validate with a zod schema
 * Returns the validated data or a fallback value on error
 */
export function safeParseJson<T>(
  json: string,
  schema: z.ZodType<T>,
  fallback: T,
  context?: string
): T {
  try {
    const parsed = JSON.parse(json);
    const result = schema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    console.warn(`[Database] Invalid JSON structure${context ? ` for ${context}` : ''}:`, result.error.message);
    return fallback;
  } catch (error) {
    console.warn(`[Database] Failed to parse JSON${context ? ` for ${context}` : ''}:`, error);
    return fallback;
  }
}

/**
 * Safely parse JSON without schema validation
 * Returns the parsed data or a fallback value on error
 * Use for complex types where zod schema is impractical
 */
export function safeParseJsonUntyped<T>(
  json: string,
  fallback: T,
  context?: string
): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    console.warn(`[Database] Failed to parse JSON${context ? ` for ${context}` : ''}:`, error);
    return fallback;
  }
}

/**
 * Safely parse JSON and validate, throwing on error
 * Use when data corruption should be surfaced
 */
export function parseJsonOrThrow<T>(
  json: string,
  schema: z.ZodType<T>,
  context?: string
): T {
  const parsed = JSON.parse(json);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid JSON structure${context ? ` for ${context}` : ''}: ${result.error.message}`);
  }
  return result.data;
}
