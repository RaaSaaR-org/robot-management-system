/**
 * @file vision.ts
 * @description One camera frame → a structured scene observation, via the local
 *              `AGENT_VISION_MODEL`. Stateless with respect to people: "is a
 *              person in the frame" plus a rough bearing, no faces, no
 *              identities, no image retention.
 * @feature agentmode
 * @status live
 */

import { config } from '../config/config.js';
import { hardwareClient } from '../hardware/HardwareClient.js';
import { extractJsonObject, genkitGenerate, agentModelRef, type GenerateFn } from './llm.js';
import { VISION_PROMPT } from './prompts.js';

/** One thing the VLM claims to see, with an image-relative bearing. */
export interface VisionEntity {
  label: string;
  /** Degrees from the image centre; POSITIVE = to the robot's left (CCW). */
  bearingDeg: number;
  distanceEstM: number | null;
  confidence: number;
  note?: string;
}

export interface VisionObservation {
  currentView: string;
  entities: VisionEntity[];
  personVisible: boolean;
  /** Raw model text, kept for debugging a malformed answer. */
  raw: string;
  /** True when the answer could not be parsed as JSON and was degraded. */
  degraded: boolean;
}

export interface VisionDeps {
  /** Grab a base64 JPEG. Default: the sidecar camera named by AGENT_CAMERA_NAME. */
  snapshot?: (cameraName: string) => Promise<string>;
  generate?: GenerateFn;
  /** Override the model ref (tests). Default: `<prefix>/<AGENT_VISION_MODEL>`. */
  modelRef?: string;
  cameraName?: string;
}

/** Bearings outside this fan are almost certainly hallucinated for a single frame. */
const MAX_RELATIVE_BEARING_DEG = 90;
const MAX_ENTITIES = 8;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Defensive parse of the VLM answer. A malformed answer NEVER throws: it
 * degrades to "no entities, currentView = the raw text", which is honest — we
 * saw something, we just could not structure it.
 */
export function parseVisionAnswer(text: string): VisionObservation {
  const degraded: VisionObservation = {
    currentView: text.trim().slice(0, 500) || '(the vision model returned nothing)',
    entities: [],
    personVisible: false,
    raw: text,
    degraded: true,
  };

  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== 'object') return degraded;

  const obj = parsed as Record<string, unknown>;
  const rawEntities = Array.isArray(obj.entities) ? obj.entities : [];
  const entities: VisionEntity[] = [];

  for (const item of rawEntities) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const label = typeof e.label === 'string' ? e.label.trim() : '';
    if (!label) continue;

    const bearingRaw = Number(e.bearingDeg);
    const bearingDeg = Number.isFinite(bearingRaw)
      ? clamp(bearingRaw, -MAX_RELATIVE_BEARING_DEG, MAX_RELATIVE_BEARING_DEG)
      : 0;

    const distRaw = Number(e.distanceEstM);
    const distanceEstM =
      e.distanceEstM === null || !Number.isFinite(distRaw) ? null : clamp(distRaw, 0, 50);

    const confRaw = Number(e.confidence);
    const confidence = Number.isFinite(confRaw) ? clamp(confRaw, 0, 1) : 0.5;

    const entity: VisionEntity = { label, bearingDeg, distanceEstM, confidence };
    if (typeof e.note === 'string' && e.note.trim()) entity.note = e.note.trim();
    entities.push(entity);
    if (entities.length >= MAX_ENTITIES) break;
  }

  const currentView =
    typeof obj.currentView === 'string' && obj.currentView.trim()
      ? obj.currentView.trim()
      : entities.length > 0
        ? entities.map((e) => e.label).join(', ')
        : '(the vision model described nothing)';

  // A person entity implies personVisible even if the flag was omitted — the
  // idle watcher must not miss a person because the model forgot one field.
  const personFromEntities = entities.some((e) => /person|mensch|human|people|frau|mann/i.test(e.label));

  return {
    currentView,
    entities,
    personVisible: obj.personVisible === true || personFromEntities,
    raw: text,
    degraded: false,
  };
}

export class VisionClient {
  private readonly snapshotFn: (cameraName: string) => Promise<string>;
  private readonly generate: GenerateFn;
  private readonly cameraName: string;
  private readonly modelRefOverride: string | undefined;

  constructor(deps: VisionDeps = {}) {
    this.snapshotFn = deps.snapshot ?? ((name) => hardwareClient.snapshot(name));
    this.generate = deps.generate ?? genkitGenerate;
    this.cameraName = deps.cameraName ?? config.agentMode.cameraName;
    this.modelRefOverride = deps.modelRef;
  }

  /**
   * Take one frame and ask the VLM about it.
   *
   * Throws only when the FRAME could not be obtained (camera/sidecar down) —
   * that must fail the block loudly rather than produce an invented scene. A
   * malformed model answer is degraded instead (see {@link parseVisionAnswer}).
   */
  async observe(): Promise<VisionObservation> {
    const b64 = await this.snapshotFn(this.cameraName);
    const model = this.modelRefOverride ?? (await agentModelRef(config.agentMode.visionModel));

    let text: string;
    try {
      const res = await this.generate({
        model,
        // `@genkit-ai/compat-oai` turns a `media` part into an OpenAI
        // `image_url` content part; a dynamically-resolved model carries
        // GENERIC_MODEL_INFO, which declares `media: true`.
        prompt: [
          { media: { url: `data:image/jpeg;base64,${b64}`, contentType: 'image/jpeg' } },
          { text: VISION_PROMPT },
        ],
        temperature: 0,
        thinking: config.agentMode.visionThinking,
      });
      text = res.text ?? '';
    } catch (err) {
      // The model call failing is not the same as the camera failing: report it
      // as a degraded observation so `look` can still record "I saw a frame but
      // the VLM did not answer" instead of pretending the camera is broken.
      const message = err instanceof Error ? err.message : String(err);
      return {
        currentView: `Vision model unavailable: ${message}`,
        entities: [],
        personVisible: false,
        raw: '',
        degraded: true,
      };
    }

    return parseVisionAnswer(text);
  }
}
