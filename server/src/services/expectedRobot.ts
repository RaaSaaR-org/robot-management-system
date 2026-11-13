/**
 * @file expectedRobot.ts
 * @description An "expected robot" (TASK-477): a robot the fleet lists before
 *              its agent has ever registered — hardware that is on site but not
 *              connected yet, or that has not been delivered.
 * @feature robots
 *
 * Until now a robot row could only come from an agent calling in
 * (`POST /api/robots/register`), so a fleet could not show a robot that exists
 * but is not running. An expected robot is a plain row with no agent, no
 * endpoints and `registeredAt = null`; it carries its state in two metadata
 * keys the app reads to say "Not connected" / "Arriving" instead of "Offline".
 *
 * The row belongs to whoever put it there only until an agent registers under
 * the same id. From then on it is that agent's robot: `PUT …/expected` answers
 * 409 and the provisioning keys are gone (`RobotRepository.upsertWithRegistration`).
 */

/** `awaiting_agent`: the hardware is here, its agent is not connected. `arriving`: not delivered yet. */
export const PROVISIONING_STATES = ['awaiting_agent', 'arriving'] as const;
export type ProvisioningState = (typeof PROVISIONING_STATES)[number];

/** Metadata keys that mark a row as expected. Server-owned: a request cannot set them directly. */
export const PROVISIONING_KEY = 'provisioning';
export const PROVISIONING_NOTE_KEY = 'provisioningNote';

export type ExpectedRobotMetadataValue = string | number | boolean;

/** A validated `PUT /api/robots/:id/expected` request. */
export interface ExpectedRobotInput {
  id: string;
  name: string;
  model: string;
  provisioning: ProvisioningState;
  /** One operator-facing sentence, e.g. when the robot is due. */
  note?: string;
  serialNumber?: string;
  capabilities: string[];
  /** Flat facts about the robot (manufacturer, robotType, …). */
  metadata: Record<string, ExpectedRobotMetadataValue>;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_TEXT = 80;
const MAX_NOTE = 240;
const MAX_LIST = 24;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/**
 * Validate a request body. Returns the input, or the sentence that says what
 * is wrong with it (answered as a 400).
 */
export function parseExpectedRobotRequest(id: string, body: unknown): ExpectedRobotInput | string {
  if (!ID_PATTERN.test(id)) {
    return 'robot id must be 1–64 characters: letters, digits, dot, dash or underscore';
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'request body must be an object';
  }
  const b = body as Record<string, unknown>;

  const name = text(b.name, MAX_TEXT);
  if (!name) return `name is required (1–${MAX_TEXT} characters)`;
  const model = text(b.model, MAX_TEXT);
  if (!model) return `model is required (1–${MAX_TEXT} characters)`;

  const provisioning = b.provisioning ?? 'awaiting_agent';
  if (!PROVISIONING_STATES.includes(provisioning as ProvisioningState)) {
    return `provisioning must be one of: ${PROVISIONING_STATES.join(', ')}`;
  }

  let note: string | undefined;
  if (b.note !== undefined && b.note !== null && b.note !== '') {
    const parsed = text(b.note, MAX_NOTE);
    if (!parsed) return `note must be a string of at most ${MAX_NOTE} characters`;
    note = parsed;
  }

  let serialNumber: string | undefined;
  if (b.serialNumber !== undefined && b.serialNumber !== null && b.serialNumber !== '') {
    const parsed = text(b.serialNumber, MAX_TEXT);
    if (!parsed) return `serialNumber must be a string of at most ${MAX_TEXT} characters`;
    serialNumber = parsed;
  }

  const capabilities: string[] = [];
  if (b.capabilities !== undefined) {
    if (!Array.isArray(b.capabilities) || b.capabilities.length > MAX_LIST) {
      return `capabilities must be a list of at most ${MAX_LIST} strings`;
    }
    for (const entry of b.capabilities) {
      const parsed = text(entry, MAX_TEXT);
      if (!parsed) return `capabilities must be a list of at most ${MAX_LIST} strings`;
      capabilities.push(parsed);
    }
  }

  const metadata: Record<string, ExpectedRobotMetadataValue> = {};
  if (b.metadata !== undefined) {
    if (typeof b.metadata !== 'object' || b.metadata === null || Array.isArray(b.metadata)) {
      return 'metadata must be an object of string, number or boolean values';
    }
    const entries = Object.entries(b.metadata as Record<string, unknown>);
    if (entries.length > MAX_LIST) return `metadata holds at most ${MAX_LIST} keys`;
    for (const [key, value] of entries) {
      if (key === PROVISIONING_KEY || key === PROVISIONING_NOTE_KEY) {
        return `metadata.${key} is set from the request's own provisioning and note fields`;
      }
      const ok =
        (typeof value === 'string' && value.length <= MAX_NOTE) ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        typeof value === 'boolean';
      if (!ok) return 'metadata must be an object of string, number or boolean values';
      metadata[key] = value as ExpectedRobotMetadataValue;
    }
  }

  return { id, name, model, provisioning: provisioning as ProvisioningState, note, serialNumber, capabilities, metadata };
}

/** The metadata column of an expected robot: its facts plus the provisioning keys. */
export function expectedRobotMetadata(input: ExpectedRobotInput): Record<string, ExpectedRobotMetadataValue> {
  return {
    ...input.metadata,
    [PROVISIONING_KEY]: input.provisioning,
    ...(input.note ? { [PROVISIONING_NOTE_KEY]: input.note } : {}),
  };
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether a stored row is (still) an expected robot: no agent has ever
 * registered it, and it carries the provisioning marker. Any other row — a
 * registered robot, or one some other seed wrote — is not ours to rewrite.
 */
export function isExpectedRobotRow(row: {
  registeredAt: Date | null;
  baseUrl: string | null;
  metadata: string | null;
}): boolean {
  if (row.registeredAt !== null || row.baseUrl !== null) return false;
  const state = parseMetadata(row.metadata)?.[PROVISIONING_KEY];
  return PROVISIONING_STATES.includes(state as ProvisioningState);
}

/**
 * The metadata column once an agent has claimed the row: the same facts
 * without the provisioning keys, or `null` when nothing is left.
 */
export function metadataWithoutProvisioning(raw: string | null | undefined): string | null {
  const parsed = parseMetadata(raw);
  if (!parsed) return raw ?? null;
  const { [PROVISIONING_KEY]: _state, [PROVISIONING_NOTE_KEY]: _note, ...rest } = parsed;
  return Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
}
