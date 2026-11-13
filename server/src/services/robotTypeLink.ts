/**
 * @file robotTypeLink.ts
 * @description Which robot type (the dataset configuration: state / action
 *              widths) a fleet robot is one of (TASK-485).
 * @feature robots
 *
 * A robot row and a robot type are two tables with no foreign key between
 * them; until now the only link was the robot's model string happening to be
 * spelled like the type's name. The demo MicroDuck's model is "Pollen Robotics
 * Microduck" and its type is "Microduck", so the link was simply absent.
 *
 * The link is now explicit first and tolerant second:
 *   1. `metadata.robotTypeId`, then `metadata.robotTypeName` — said outright
 *      by whoever put the robot on the fleet (`linkedBy: 'explicit'`);
 *   2. the model equal to the type's name or model key, ignoring case and
 *      punctuation (`linkedBy: 'model'`);
 *   3. the type's name appearing as whole words in the model, with the
 *      longest name winning and a tie answering nothing rather than guessing.
 *
 * Pure: the caller supplies the robot types.
 */

import type { RobotType } from '../types/vla.types.js';

export interface RobotTypeLinkSubject {
  model?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RobotTypeLink {
  robotType: RobotType;
  /** `explicit`: named in the robot's metadata. `model`: read off its model string. */
  linkedBy: 'explicit' | 'model';
}

/** A robot row's metadata as an object: the column is a JSON string, the domain type an object. */
export function parseRobotMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Lower-case words of a label: "Unitree G1 EDU (Dex3-1)" → unitree g1 edu dex3 1. */
function words(value: unknown): string[] {
  return typeof value === 'string' ? value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) : [];
}

const key = (value: unknown): string => words(value).join('');

function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((word, i) => haystack[start + i] === word)) return true;
  }
  return false;
}

/** The link a robot's metadata states outright, or null. */
export function explicitRobotTypeLink(
  robot: RobotTypeLinkSubject,
  types: readonly RobotType[],
): RobotTypeLink | null {
  const metadata = robot.metadata ?? {};

  const wantedId = typeof metadata.robotTypeId === 'string' ? metadata.robotTypeId : '';
  const byId = wantedId ? types.find((t) => t.id === wantedId) : undefined;
  if (byId) return { robotType: byId, linkedBy: 'explicit' };

  const wantedName = key(metadata.robotTypeName);
  const byName = wantedName ? types.find((t) => key(t.name) === wantedName) : undefined;
  return byName ? { robotType: byName, linkedBy: 'explicit' } : null;
}

/** The link read off the model string: an exact match, else the type's name as whole words in it. */
export function modelRobotTypeLink(
  robot: RobotTypeLinkSubject,
  types: readonly RobotType[],
): RobotTypeLink | null {
  const model = key(robot.model);
  if (!model) return null;
  const exact = types.find((t) => key(t.name) === model) ?? types.find((t) => key(t.model) === model);
  if (exact) return { robotType: exact, linkedBy: 'model' };

  const modelWords = words(robot.model);
  const contained = types
    .map((type) => ({ type, length: words(type.name).length }))
    .filter(({ type }) => containsRun(modelWords, words(type.name)))
    .sort((a, b) => b.length - a.length);
  if (contained.length === 0) return null;
  // Two equally long names both fit: saying nothing beats picking one.
  if (contained.length > 1 && contained[0].length === contained[1].length) return null;
  return { robotType: contained[0].type, linkedBy: 'model' };
}

/** The robot type this robot is one of, or null when nothing says so unambiguously. */
export function linkRobotToType(
  robot: RobotTypeLinkSubject,
  types: readonly RobotType[],
): RobotTypeLink | null {
  return explicitRobotTypeLink(robot, types) ?? modelRobotTypeLink(robot, types);
}
