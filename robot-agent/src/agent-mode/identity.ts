/**
 * @file identity.ts
 * @description Who this robot is (`IDENTITY.md`), how it is meant to speak
 *              (`SOUL.md`), what body it actually has (`BODY.md`, regenerated
 *              from the embodiment config), and the per-turn sensorium that
 *              makes a restarted process feel continuous.
 * @feature agentmode
 * @status live
 *
 * THREE FILES, THREE WRITE POLICIES — the one thing worth copying verbatim from
 * the persona-file agents, because a machine that can hurt people must not
 * drift its own persona:
 *
 *  - `IDENTITY.md` is an ID card. Tooling writes back FOUR labels — Name, Emoji,
 *    Operator, Site. Everything else on it is regenerated from configuration.
 *  - `SOUL.md` is voice, tone and boundaries. It is human-authored and there is
 *    NO write path to it in this process at all — {@link IdentityStore.write}
 *    refuses the file name unconditionally, and when the operator has not
 *    written one, {@link DEFAULT_SOUL} (a source constant, reviewed like code)
 *    is used without ever being persisted.
 *  - `BODY.md` is generated at every boot from `embodiment/configs/<tag>.yaml`
 *    plus `robot/joint-configs/`. No model is asked what this robot can do: the
 *    YAML already carries the DOF breakdown, the joint names, the cameras, the
 *    depth sensors and the safety limits.
 *
 * CONFIG WINS ON CONFLICT. `Robot-Id`, `Serial`, `Unit` and the whole of
 * `BODY.md` are rewritten from configuration at load. An identity file must
 * never be able to lie about which body it is — that closes the empty-identity
 * failure and the poisoning path where a rewritten memory would otherwise
 * convince the robot it is a different machine.
 *
 * A MISSING FILE AND A GARBLED FILE ARE DIFFERENT. Missing re-runs bootstrap
 * (the robot asks to be named). Garbled FAILS LOUDLY. Silently substituting a
 * generic self is Hermes's documented "Amnesia Mode" and is the wrong default
 * for a machine that can walk into someone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/config.js';
import type { EmbodimentConfig } from '../embodiment/types.js';
import { getJointConfig } from '../robot/joint-configs/index.js';
import type { RobotType } from '../robot/types.js';
import type { IncarnationRecord } from './incarnations.js';
import { describeNameAloud } from './voice-narrator.js';
import { getWorkspace, listEntries, type JournalRecord, type Workspace } from './workspace.js';
import type { AgentSelfState, ControlOwner, SpokenLanguage } from './types.js';

/** The ID card. Present ⇒ this robot has been named. */
export const IDENTITY_FILE = 'IDENTITY.md';

/** Voice, tone, boundaries. Human-authored; never written by this process. */
export const SOUL_FILE = 'SOUL.md';

/** Regenerated at every boot from the embodiment config. */
export const BODY_FILE = 'BODY.md';

/**
 * The only labels tooling may write back into `IDENTITY.md`.
 *
 * A SET rather than a "not one of the config-owned ones" test, for the same
 * reason {@link import('./workspace.js').DURABLE_TRUST_LEVELS} is: a label
 * added later is refused by default instead of admitted by omission.
 */
export const IDENTITY_WRITABLE_LABELS: ReadonlySet<string> = new Set([
  'Name',
  'Emoji',
  'Operator',
  'Site',
]);

/** Labels regenerated from configuration at every load. The file cannot win these. */
export const IDENTITY_CONFIG_LABELS: readonly string[] = ['Robot-Id', 'Serial', 'Unit'];

/** Longest a written-back label value may be — this is an ID card, not a memory. */
export const IDENTITY_VALUE_MAX_CHARS = 80;

/** How long the journal-derived counts in {@link AgentSelfState} are reused. */
export const SELF_COUNTS_TTL_MS = 60_000;

/** Window the "how did today go" counts cover. */
export const SELF_COUNT_WINDOW_MS = 24 * 60 * 60_000;

/** What the robot calls itself, and who it belongs to. */
export interface RobotIdentity {
  /** Agent-writable. What a person calls this robot. */
  name: string;
  /** Agent-writable. One emoji, or null when nobody picked one. */
  emoji: string | null;
  /** Agent-writable. The named human who operates it. */
  operator: string | null;
  /** Agent-writable. The named place it belongs to. */
  site: string | null;
  /** Config-owned. The robot id every other subsystem keys on. */
  robotId: string;
  /** Config-owned. Serial / device identifier. */
  serial: string;
  /** Config-owned. The machine this is — model string from configuration. */
  unit: string;
}

/** What {@link IdentityStore.load} found on disk. */
export interface IdentityLoadResult {
  identity: RobotIdentity;
  /**
   * There is no `IDENTITY.md`. The robot has NOT been named and must ask —
   * the absence of the file IS the bootstrap marker, so writing the file is
   * what clears it. `identity.name` carries the configured fallback so the
   * agent is still addressable while it waits, and nothing pretends the name
   * was chosen by anyone.
   */
  bootstrapRequired: boolean;
  /** The file disagreed with configuration and was rewritten. */
  rewritten: boolean;
}

/**
 * An `IDENTITY.md` that exists but cannot be read as an ID card.
 *
 * Thrown, not swallowed: the alternative is a robot that quietly becomes a
 * generic self after its identity file was corrupted — which is exactly the
 * failure mode this file exists to prevent.
 */
export class IdentityGarbledError extends Error {
  constructor(
    readonly file: string,
    readonly reason: string,
  ) {
    super(
      `${path.basename(file)} exists but could not be read as an identity card: ${reason}. ` +
        `Fix or delete ${file} — deleting it re-runs the naming bootstrap; ` +
        `booting with a generic self instead would be a robot that does not know what it is.`,
    );
    this.name = 'IdentityGarbledError';
  }
}

export interface IdentityStoreDeps {
  workspace?: Workspace;
  robotId?: string;
  /** Serial / device identifier. Config-owned on the card. */
  serial?: string;
  /** Model string. Config-owned on the card. */
  unit?: string;
  /** Name used until an operator names the robot. */
  fallbackName?: string;
}

/**
 * The three files, their load rules and the ONE write chokepoint.
 *
 * All I/O is synchronous, like the rest of the workspace: the readers are a
 * prompt builder and a REST handler, and the writer is the naming ritual —
 * in none of them is an unawaited promise anything but a lost write.
 */
export class IdentityStore {
  private readonly workspace: Workspace;
  private readonly robotId: string;
  private readonly serial: string;
  private readonly unit: string;
  private readonly fallbackName: string;
  /** Last successful load, so the hot paths do not re-read the card per event. */
  private cached: RobotIdentity | null = null;
  private cachedBootstrap = true;

  constructor(deps: IdentityStoreDeps = {}) {
    this.workspace = deps.workspace ?? getWorkspace();
    this.robotId = deps.robotId ?? config.robotId;
    this.serial = deps.serial ?? config.robotId;
    this.unit = deps.unit ?? config.robotModel;
    this.fallbackName = deps.fallbackName ?? config.robotName;
  }

  get identityFile(): string {
    return path.join(this.workspace.root, IDENTITY_FILE);
  }

  get soulFile(): string {
    return path.join(this.workspace.root, SOUL_FILE);
  }

  get bodyFile(): string {
    return path.join(this.workspace.root, BODY_FILE);
  }

  // ── the write chokepoint ──────────────────────────────────────────────────

  /**
   * The only way this module puts bytes on disk.
   *
   * `SOUL.md` is refused here, unconditionally and with no bypass parameter.
   * Persona is the one thing an agent must not be able to rewrite about
   * itself, and a rule that lives in a comment at each call site is a rule that
   * survives exactly until the next call site.
   */
  private write(file: string, content: string): void {
    if (path.basename(file) === SOUL_FILE) {
      throw new Error(
        `refused: ${SOUL_FILE} is human-authored. Nothing in this process writes it — ` +
          'procedures may be self-authored later, persona may not.',
      );
    }
    this.workspace.atomicWrite(file, content);
  }

  // ── IDENTITY.md ───────────────────────────────────────────────────────────

  /**
   * Read the ID card, overwrite what configuration owns, and say whether the
   * robot still needs naming.
   *
   * @throws {IdentityGarbledError} when the file exists but is not an ID card.
   */
  load(): IdentityLoadResult {
    const file = this.identityFile;
    const fromConfig = {
      robotId: this.robotId,
      serial: this.serial,
      unit: this.unit,
    };

    if (!fs.existsSync(file)) {
      // No card ⇒ bootstrap. Nothing is written here: writing a provisional
      // card would clear the very marker that makes the robot ask.
      const identity: RobotIdentity = {
        name: this.fallbackName,
        emoji: null,
        operator: null,
        site: null,
        ...fromConfig,
      };
      this.cached = identity;
      this.cachedBootstrap = true;
      return { identity, bootstrapRequired: true, rewritten: false };
    }

    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch (err) {
      throw new IdentityGarbledError(file, err instanceof Error ? err.message : String(err));
    }

    const fields = parseIdentityMarkdown(raw);
    if (Object.keys(fields).length === 0) {
      throw new IdentityGarbledError(file, 'no "Label: value" lines at all');
    }
    const name = (fields.Name ?? '').trim();
    if (!name) {
      throw new IdentityGarbledError(file, 'no readable "Name"');
    }

    const identity: RobotIdentity = {
      name,
      emoji: optional(fields.Emoji),
      operator: optional(fields.Operator),
      site: optional(fields.Site),
      ...fromConfig,
    };

    // Config wins. A card claiming another Robot-Id/Serial/Unit is not an
    // error the operator has to resolve — it is simply not authoritative, and
    // the file is corrected so the next reader sees the truth.
    const disagreed = IDENTITY_CONFIG_LABELS.some(
      (label) => (fields[label] ?? '').trim() !== configValue(label, identity),
    );
    const rendered = renderIdentityMarkdown(identity);
    const rewritten = disagreed || rendered !== raw;
    if (rewritten) {
      if (disagreed) {
        console.warn(
          `[Identity] ${IDENTITY_FILE} disagreed with configuration ` +
            `(${IDENTITY_CONFIG_LABELS.join(' / ')}) — the file was rewritten. ` +
            'An identity file cannot decide which body it describes.',
        );
      }
      this.write(file, rendered);
    }

    this.cached = identity;
    this.cachedBootstrap = false;
    return { identity, bootstrapRequired: false, rewritten };
  }

  /** The last loaded card, loading it once if nothing has yet. Never throws twice. */
  current(): RobotIdentity {
    if (!this.cached) this.load();
    return this.cached!;
  }

  /** True while there is no `IDENTITY.md` — the robot has not been named. */
  needsBootstrap(): boolean {
    if (!this.cached) this.load();
    return this.cachedBootstrap;
  }

  /**
   * Write back the four agent-writable labels. Anything else in the patch is
   * REFUSED rather than ignored: a caller that thinks it renamed the unit must
   * be told it did not.
   */
  writeIdentityFields(patch: Record<string, string | null | undefined>): RobotIdentity {
    const current = this.current();
    const next: RobotIdentity = { ...current };

    for (const [label, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (!IDENTITY_WRITABLE_LABELS.has(label)) {
        throw new Error(
          `refused: "${label}" is not agent-writable. Only ` +
            `${[...IDENTITY_WRITABLE_LABELS].join(' / ')} may be written back; ` +
            `${IDENTITY_CONFIG_LABELS.join(' / ')} come from configuration at every boot.`,
        );
      }
      const clean = value === null ? null : oneLineValue(value);
      if (label === 'Name') {
        if (!clean) throw new Error('refused: a robot may not be given an empty name.');
        next.name = clean;
      } else if (label === 'Emoji') next.emoji = clean;
      else if (label === 'Operator') next.operator = clean;
      else if (label === 'Site') next.site = clean;
    }

    this.workspace.ensure();
    this.write(this.identityFile, renderIdentityMarkdown(next));
    this.cached = next;
    this.cachedBootstrap = false;
    console.log(`[Identity] ${IDENTITY_FILE} written — this robot is called "${next.name}".`);
    return next;
  }

  // ── SOUL.md ───────────────────────────────────────────────────────────────

  /**
   * Voice, tone and boundaries. The operator's file when there is one, the
   * reviewed source default otherwise — which is deliberately NOT written to
   * disk: a default that materialises as a file is a default an agent can then
   * edit.
   */
  soul(): string {
    try {
      if (fs.existsSync(this.soulFile)) {
        const text = fs.readFileSync(this.soulFile, 'utf-8').trim();
        if (text) return text;
      }
    } catch (err) {
      console.warn(`[Identity] could not read ${SOUL_FILE}:`, err);
    }
    return DEFAULT_SOUL;
  }

  // ── BODY.md ───────────────────────────────────────────────────────────────

  /**
   * Regenerate `BODY.md` from the embodiment config. Returns the markdown it
   * wrote, or null when the write failed — a robot with no body FILE still has
   * a body, and must not fail to boot over it.
   */
  regenerateBody(input: BodyInput): string | null {
    const markdown = renderBodyMarkdown(input);
    try {
      this.workspace.ensure();
      this.write(this.bodyFile, markdown);
      return markdown;
    } catch (err) {
      console.warn(`[Identity] could not write ${BODY_FILE}:`, err);
      return null;
    }
  }

  /** `BODY.md` as it stands on disk, or `''` when it has not been generated. */
  bodyMarkdown(): string {
    try {
      return fs.existsSync(this.bodyFile) ? fs.readFileSync(this.bodyFile, 'utf-8') : '';
    } catch {
      return '';
    }
  }
}

// ---------------------------------------------------------------------------
// IDENTITY.md rendering / parsing
// ---------------------------------------------------------------------------

/** `- **Label**: value`, tolerant of the bullet, the bold markers and spacing. */
const IDENTITY_LINE = /^\s*(?:[-*]\s*)?\*{0,2}([A-Za-z][A-Za-z0-9 _-]*?)\*{0,2}\s*:\s*(.*)$/;

/**
 * Every `Label: value` pair in an ID card. Prose lines simply do not match, so
 * a card may carry explanation without the parser inventing fields from it.
 */
export function parseIdentityMarkdown(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const match = IDENTITY_LINE.exec(line);
    if (!match) continue;
    const label = match[1].trim();
    const value = match[2].trim();
    if (!label || label in fields) continue;
    fields[label] = value;
  }
  return fields;
}

/** The ID card, in the one shape {@link parseIdentityMarkdown} reads back. */
export function renderIdentityMarkdown(identity: RobotIdentity): string {
  return [
    '# Identity',
    '',
    `- **Name**: ${identity.name}`,
    `- **Emoji**: ${identity.emoji ?? ''}`,
    `- **Operator**: ${identity.operator ?? ''}`,
    `- **Site**: ${identity.site ?? ''}`,
    `- **Robot-Id**: ${identity.robotId}`,
    `- **Serial**: ${identity.serial}`,
    `- **Unit**: ${identity.unit}`,
    '',
    'Name, Emoji, Operator and Site are yours to change. Robot-Id, Serial and',
    'Unit are regenerated from this machine\'s configuration at every boot, and',
    'so is BODY.md: an identity file must never be able to lie about which body',
    'it describes.',
    '',
  ].join('\n');
}

/** `''` reads as "not set", never as the empty string. */
function optional(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  return text ? text : null;
}

function configValue(label: string, identity: RobotIdentity): string {
  if (label === 'Robot-Id') return identity.robotId;
  if (label === 'Serial') return identity.serial;
  return identity.unit;
}

/** One line, clamped. An ID card field is a label, not a paragraph. */
function oneLineValue(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > IDENTITY_VALUE_MAX_CHARS
    ? flat.slice(0, IDENTITY_VALUE_MAX_CHARS).trimEnd()
    : flat;
}

/**
 * The reviewed default voice. Source, not data: it ships in the binary, is code
 * reviewed, and — unlike a seeded file — cannot be edited by anything running
 * on the robot. An operator who wants a different voice writes `SOUL.md` into
 * the workspace and it wins.
 */
export const DEFAULT_SOUL = `# Soul

## Voice
Plain, short, first person. State what you did and what you measured. Prefer a
number over an adjective.

## Boundaries
- Never claim a motion you did not measure. "I walked 0.98 m" and "I was told to
  walk 1 m" are different sentences.
- Never claim to know where you are when the place is unknown.
- You are a machine that can hurt people. When you are unsure, stop and say so;
  do not improvise around a safety refusal.
- You do not decide your own name, your operator or your site. A human does.`;

// ---------------------------------------------------------------------------
// BODY.md — generated, never hand-written
// ---------------------------------------------------------------------------

export interface BodyInput {
  /** The Zod-validated embodiment config. Absent ⇒ the file says so plainly. */
  embodiment?: EmbodimentConfig | undefined;
  /** Which `robot/joint-configs/` table this agent drives. */
  robotType: RobotType;
  /** Tag that was asked for, for the "not found" case. */
  embodimentTag: string;
}

/** Joint-name groups, derived from the names themselves — nothing is guessed. */
export interface JointGroups {
  leg: number;
  waist: number;
  arm: number;
  hand: number;
  other: number;
}

/**
 * Count joints per body region from their names.
 *
 * Prefix matching on the actual `joint_names` list, so the breakdown a reader
 * sees ("12 leg, 3 waist, 14 arm, 14 hand") is arithmetic over the config, not
 * a sentence someone typed next to it that can go stale.
 */
export function groupJointNames(names: readonly string[]): JointGroups {
  const groups: JointGroups = { leg: 0, waist: 0, arm: 0, hand: 0, other: 0 };
  for (const name of names) {
    const n = name.toLowerCase();
    if (/hip|knee|ankle/.test(n)) groups.leg++;
    else if (/waist|torso/.test(n)) groups.waist++;
    else if (/hand|thumb|finger|index|middle|ring|pinky|gripper/.test(n)) groups.hand++;
    else if (/shoulder|elbow|wrist/.test(n)) groups.arm++;
    else groups.other++;
  }
  return groups;
}

/** The "12 leg, 3 waist, 14 arm, 14 hand" clause, omitting empty regions. */
export function describeJointGroups(groups: JointGroups): string {
  const parts: string[] = [];
  if (groups.leg) parts.push(`${groups.leg} leg`);
  if (groups.waist) parts.push(`${groups.waist} waist`);
  if (groups.arm) parts.push(`${groups.arm} arm`);
  if (groups.hand) parts.push(`${groups.hand} hand`);
  if (groups.other) parts.push(`${groups.other} other`);
  return parts.join(', ');
}

const BODY_HEADER = [
  '# Body',
  '',
  '<!-- GENERATED AT EVERY BOOT — DO NOT EDIT.',
  '     Source: embodiment/configs/<tag>.yaml + robot/joint-configs/.',
  '     Edits here are overwritten; change the YAML instead. -->',
  '',
].join('\n');

/**
 * Render `BODY.md` from configuration.
 *
 * PURE, and deliberately free of any model call. The URDF→ontology step is
 * already done in this repo as YAML: the DOF breakdown, the joint names, the
 * cameras, the depth sensors and the safety limits are all there. Asking a
 * language model to describe the body instead would be inventing capabilities
 * for a machine that then acts on them.
 */
export function renderBodyMarkdown(input: BodyInput): string {
  const { embodiment } = input;
  const jointTable = getJointConfig(input.robotType);
  const lines: string[] = [BODY_HEADER];

  if (!embodiment) {
    // Honest, and still useful: the joint table is compiled in and is real.
    lines.push(
      `No embodiment configuration is loaded for tag \`${input.embodimentTag}\`.`,
      '',
      `- **Robot type**: ${input.robotType}`,
      `- **Joint table**: ${jointTable.length} joint(s) from robot/joint-configs/`,
      '',
      'Everything else about this body is UNKNOWN. Do not assume a sensor,',
      'a reach or a payload that is not listed here.',
      '',
    );
    return lines.join('\n');
  }

  const groups = groupJointNames(embodiment.proprioception.joint_names);
  const breakdown = describeJointGroups(groups);

  lines.push(
    '## Unit',
    '',
    `- **Manufacturer**: ${embodiment.manufacturer}`,
    `- **Model**: ${embodiment.model}`,
    `- **Embodiment tag**: ${embodiment.embodiment_tag}`,
    `- **Config version**: ${embodiment.version ?? 'unknown'}`,
    ...(embodiment.description ? [`- **Description**: ${embodiment.description}`] : []),
    '',
    '## Joints',
    '',
    `- **Actuated DOF**: ${embodiment.action.dim}${breakdown ? ` (${breakdown})` : ''}`,
    `- **Named joints**: ${embodiment.proprioception.joint_names.length}`,
    `- **Proprioception dim**: ${embodiment.proprioception.dim}`,
    `- **Joint table (robot/joint-configs/${input.robotType})**: ${jointTable.length}`,
    '',
  );

  // A disagreement between the two sources is stated, never averaged away: one
  // of them is wrong and the operator is the only one who can say which.
  if (jointTable.length > 0 && jointTable.length !== embodiment.action.dim) {
    lines.push(
      `> MISMATCH: the embodiment config says ${embodiment.action.dim} DOF and the joint`,
      `> table for \`${input.robotType}\` has ${jointTable.length}. Treat the DOF count as`,
      '> unverified until the two agree.',
      '',
    );
  }

  const cameras = embodiment.cameras ?? [];
  lines.push('## Cameras', '');
  if (cameras.length === 0) {
    lines.push('- none configured', '');
  } else {
    for (const cam of cameras) {
      lines.push(
        `- **${cam.name}**: ${cam.resolution[0]}x${cam.resolution[1]}` +
          `${cam.fov ? `, ${cam.fov}° FOV` : ''} — ${cam.enabled ? 'enabled' : 'disabled'}`,
      );
    }
    lines.push('');
  }

  const depth = embodiment.depth_sensors ?? [];
  lines.push('## Depth / 3D sensors', '');
  if (depth.length === 0) {
    lines.push('- none configured', '');
  } else {
    for (const sensor of depth) {
      const fov =
        sensor.fov_horizontal || sensor.fov_vertical
          ? `${sensor.fov_horizontal ?? '?'}°x${sensor.fov_vertical ?? '?'}°`
          : null;
      const range = sensor.range ? `${sensor.range[0]}–${sensor.range[1]} m` : null;
      const rate = sensor.frame_rate ? `${sensor.frame_rate} Hz` : null;
      lines.push(
        `- **${sensor.name}** (${sensor.type}): ` +
          [fov, range, rate].filter(Boolean).join(', ') +
          ` — ${sensor.enabled ? 'enabled' : 'disabled'}`,
      );
    }
    lines.push('');
  }

  lines.push('## Safety limits', '');
  const safety = embodiment.safety;
  if (!safety) {
    lines.push('- none configured — assume nothing', '');
  } else {
    lines.push(`- **Max speed**: ${safety.max_speed} m/s`);
    if (safety.force_limit !== undefined) {
      lines.push(`- **Force limit**: ${safety.force_limit} N`);
    }
    if (safety.collision_margin !== undefined) {
      lines.push(`- **Collision margin**: ${safety.collision_margin} m`);
    }
    const ws = safety.workspace;
    if (ws?.min && ws.max) {
      lines.push(
        `- **Workspace (${ws.type})**: [${ws.min.join(', ')}] .. [${ws.max.join(', ')}] m`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** RobotType → the embodiment tag its YAML declares. */
export const EMBODIMENT_TAG_BY_ROBOT_TYPE: Readonly<Record<RobotType, string>> = {
  g1_edu: 'unitree_g1_edu_dex3',
  g1: 'unitree_g1',
  h1: 'unitree_h1',
  so101: 'so101_arm',
  generic: 'generic',
};

// ---------------------------------------------------------------------------
// The sensorium
// ---------------------------------------------------------------------------

/** Everything {@link computeSelfState} needs. Assembled per turn, zero tool calls. */
export interface SelfStateInput {
  identity: RobotIdentity;
  bootstrapRequired: boolean;
  /** Every line of `incarnations.jsonl`, oldest first (TASK-196). */
  incarnations: readonly IncarnationRecord[];
  /** This process's boot id, or null before `recordBoot`. */
  bootId: string | null;
  /** When this process came up (epoch ms). */
  startedAtMs: number;
  nowMs: number;
  /** Journal records from the last calendar days (TASK-197). */
  journal: readonly JournalRecord[];
  /** `MEMORY.md` as it stands, for the entry count. */
  memoryMarkdown: string;
  place: string | null;
  poseSource: string | null;
  batteryPct: number | null;
  controlOwner: ControlOwner;
  damped: boolean;
  estopLatched: boolean;
}

/**
 * The per-turn sensorium: what this robot is, which life it is on, and how the
 * last one ended.
 *
 * It spans restarts, which is the whole point — the lineage and the journal are
 * both on disk, so a process that came up thirty seconds ago can still say
 * "this is my 47th start and the last one crashed". Removing episodic memory is
 * what made a robot's self-assessment oscillate incoherently in the study this
 * task is built on; this function is the cheapest thing that stops that.
 */
export function computeSelfState(input: SelfStateInput): AgentSelfState {
  const { incarnations, bootId } = input;
  const index = bootId === null ? -1 : incarnations.findIndex((r) => r.bootId === bootId);
  const mine = index >= 0 ? incarnations[index] : null;
  // The lifetime ordinal is written INTO our own line (TASK-198 follow-up), so
  // it survives the ring buffer rotating past INCARNATION_MAX_LINES. The old
  // reading — the line's INDEX in the file — decreased whenever rotation ate a
  // line (observed: 199 → 197 across a restart), and a count of starts that
  // goes down is not a count of starts.
  const { incarnation, incarnationExact } = lifetime(mine, index, incarnations);
  const previous = index > 0 ? incarnations[index - 1] : index === -1 ? last(incarnations) : null;

  const since = input.nowMs - SELF_COUNT_WINDOW_MS;
  const recent = input.journal.filter((r) => {
    const t = Date.parse(r.t);
    return Number.isFinite(t) && t >= since;
  });
  const plans = new Set<string>();
  let failures = 0;
  for (const record of recent) {
    if (record.planId) plans.add(record.planId);
    if (record.ok === false) failures++;
  }

  return {
    name: input.identity.name,
    emoji: input.identity.emoji,
    unit: input.identity.unit,
    robotId: input.identity.robotId,
    operator: input.identity.operator,
    site: input.identity.site,
    bootstrapRequired: input.bootstrapRequired,
    bootId,
    incarnation,
    incarnationExact,
    uptimeS: Math.max(0, Math.round((input.nowMs - input.startedAtMs) / 1000)),
    lastShutdown: previous ? shutdownOf(previous) : null,
    place: input.place,
    poseSource: input.poseSource,
    batteryPct: input.batteryPct,
    controlOwner: input.controlOwner,
    damped: input.damped,
    estopLatched: input.estopLatched,
    plansLast24h: plans.size,
    failuresLast24h: failures,
    memoryEntries: listEntries(input.memoryMarkdown).length,
  };
}

/**
 * Which life this is, and whether that number is exact.
 *
 * The ordinal comes off our OWN line, where `IncarnationLog.open` wrote it — it
 * is the only source that survives the ring buffer rotating. Everything else
 * here is fallback, and every fallback is a FLOOR:
 *
 *  - Our line has no ordinal (a lineage written before the counter existed):
 *    its index in the file, i.e. the boots the file still holds.
 *  - We are not in the file at all (no `bootId` yet, or the lineage could not be
 *    read): the last line's ordinal when there is one — the count of boots
 *    BEFORE this one, which is the honest lower bound for "which life is this" —
 *    otherwise the number of lines.
 *
 * A floor is never rendered as an ordinal: `incarnationExact: false` is what
 * makes the header say "at least N starts" instead of "incarnation N".
 */
function lifetime(
  mine: IncarnationRecord | null,
  index: number,
  incarnations: readonly IncarnationRecord[],
): { incarnation: number; incarnationExact: boolean } {
  if (mine && isCount(mine.seq)) {
    return { incarnation: mine.seq, incarnationExact: mine.seqExact === true };
  }
  if (index >= 0) return { incarnation: index + 1, incarnationExact: false };
  const previous = last(incarnations);
  const floor = previous && isCount(previous.seq) ? previous.seq : incarnations.length;
  return { incarnation: floor, incarnationExact: false };
}

/** A whole, positive, safe integer — anything else is damage, not a count. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * How one incarnation ended. A line with no `endedAt` never reached the
 * shutdown handler, which is the entire crash-detection mechanism (TASK-196) —
 * so `'crash'` is a statement about the SOFTWARE's exit, not about the robot
 * falling over.
 */
function shutdownOf(record: IncarnationRecord): NonNullable<AgentSelfState['lastShutdown']> {
  return {
    at: record.endedAt,
    exit: record.endedAt === null ? 'crash' : (record.exit ?? 'unknown').toLowerCase(),
    place: record.lastPlace,
  };
}

function last<T>(items: readonly T[]): T | null {
  return items.length > 0 ? items[items.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Answering "who are you?" — no model call, every clause checkable
// ---------------------------------------------------------------------------

/**
 * Utterances that are a question about the robot's own identity, and nothing
 * else.
 *
 * Matched against the WHOLE utterance, exactly like `isStopWord`: "walk to the
 * table and tell me who you are" is a command with a clause in it and belongs
 * to the planner, while "who are you?" must never spend an LLM round-trip or a
 * navigation plan on being answered.
 */
const IDENTITY_QUESTIONS: readonly RegExp[] = [
  /^who are you$/,
  /^what are you$/,
  /^who am i (?:talking|speaking) (?:to|with)$/,
  /^what(?:'| i)?s your name$/,
  /^what is your name$/,
  /^whats your name$/,
  /^introduce yourself$/,
  /^tell me about yourself$/,
  /^wer bist du$/,
  /^was bist du$/,
  /^wie hei(?:ß|ss)t du$/,
  /^wie ist dein name$/,
  /^stell dich (?:mal )?vor$/,
];

/** Lower-case and strip the surrounding punctuation an utterance arrives with. */
function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[\s!.?,;:]+/, '')
    .replace(/[\s!.?,;:]+$/, '')
    .replace(/\s+/g, ' ');
}

/** Whether the whole utterance is a question about who the robot is. */
export function isIdentityQuestion(text: string): boolean {
  const normalized = normalizeUtterance(text);
  if (!normalized) return false;
  return IDENTITY_QUESTIONS.some((re) => re.test(normalized));
}

/**
 * "call yourself Nova" / "dein Name ist Nova" — the naming ritual's utterance.
 *
 * The robot ASKS for a name and does not choose one, so this is the only path
 * by which `IDENTITY.md` gains a Name from a conversation. Returns null when
 * the utterance is not a naming, which is the common case.
 */
const NAMING_PATTERNS: readonly RegExp[] = [
  /^your name is (.+)$/,
  /^you are called (.+)$/,
  /^call yourself (.+)$/,
  /^i(?:'| a)?m going to call you (.+)$/,
  /^dein name ist (.+)$/,
  /^du hei(?:ß|ss)t (.+)$/,
  /^ich nenne dich (.+)$/,
];

export function parseNamingUtterance(text: string): string | null {
  const normalized = normalizeUtterance(text);
  for (const re of NAMING_PATTERNS) {
    const match = re.exec(normalized);
    if (!match) continue;
    // Take the name from the ORIGINAL text so its capitalisation survives.
    const start = text.toLowerCase().indexOf(match[1]);
    const name = (start >= 0 ? text.slice(start, start + match[1].length) : match[1]).trim();
    if (name) return name;
  }
  return null;
}

/** Rough, honest English for "20 minutes ago". */
export function humanizeAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'at an unknown time';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export interface SelfReportInput {
  self: AgentSelfState;
  /** DOF count from `BODY.md`'s source, or null when no embodiment is loaded. */
  dof: number | null;
  /** "Dex3-1 hands", when the body has any. Null when it has none to claim. */
  hands: string | null;
  nowMs: number;
}

/**
 * The self-report — one paragraph, every clause of which is checkable against a
 * file on this disk.
 *
 * Templated, not generated. The DOF count comes from `g1_edu.yaml`, the
 * incarnation number from `incarnations.jsonl`, the crash from a line with no
 * `endedAt`, the place from the place resolver. A model asked to phrase this
 * would be free to round 43 to "about forty" or to call a SIGTERM a crash, and
 * the whole point of the file split is that it cannot.
 */
export function describeSelf(input: SelfReportInput, language: SpokenLanguage = 'en'): string {
  const { self } = input;
  const de = language === 'de';

  // What it is. Only the parts configuration actually states — an absent DOF
  // count or an absent manipulator is simply not mentioned, never guessed.
  const parts: string[] = [];
  if (input.dof !== null) parts.push(de ? `${input.dof} Gelenken` : `${input.dof} joints`);
  if (input.hands) parts.push(input.hands);
  const body =
    parts.length === 0
      ? self.unit
      : `${self.unit} ${de ? 'mit' : 'with'} ${parts.join(de ? ' und ' : ' and ')}`;

  // The bare name comes from the narrator's phrasebook (the same template the
  // spoken path uses); the unit clause is appended to it rather than being a
  // second sentence, so a robot with no name still says something sensible.
  const sentences: string[] = self.name.trim()
    ? [de ? `Ich bin ${self.name}, ein ${body}.` : `I am ${self.name}, a ${body}.`]
    : [describeNameAloud(self.name, language), de ? `Ich bin ein ${body}.` : `I am a ${body}.`];

  if (self.bootstrapRequired) {
    sentences.push(
      de
        ? `Ich habe noch keinen richtigen Namen — "${self.name}" steht nur in der Konfiguration. Sag mir, wie ich heißen soll.`
        : `I have not been named yet — "${self.name}" is only what the configuration calls me. Tell me what to call myself.`,
    );
  }

  // Which life this is, and how the last one ended. An inexact count is a floor
  // (the lineage rotated past lines nothing can account for), and a floor is
  // said as a floor — the robot does not claim an ordinal it cannot support.
  const startClause = self.incarnationExact
    ? de
      ? `Das ist mein ${self.incarnation}. Start`
      : `This is my ${ordinal(self.incarnation)} start`
    : de
      ? `Das ist mindestens mein ${self.incarnation}. Start`
      : `I have started at least ${self.incarnation} times`;
  const shutdown = self.lastShutdown;
  if (!shutdown) {
    sentences.push(de ? `${startClause}.` : `${startClause}.`);
  } else {
    const crashed = shutdown.exit === 'crash';
    const where = shutdown.place
      ? de
        ? ` in ${shutdown.place}`
        : ` in ${shutdown.place}`
      : '';
    const when = shutdown.at
      ? de
        ? ''
        : `, ${humanizeAgo(input.nowMs - Date.parse(shutdown.at))}`
      : '';
    sentences.push(
      de
        ? `${startClause}; der letzte endete ${crashed ? 'mit einem Absturz' : `mit ${shutdown.exit}`}${where}.`
        : `${startClause}; the last one ended ${crashed ? 'in a crash' : `with ${shutdown.exit}`}${where}${when}.`,
    );
  }

  // Where it is now, and whether it can move — the two facts an operator acts on.
  if (self.place) {
    sentences.push(de ? `Ich stehe in ${self.place}.` : `I am standing in ${self.place}.`);
  }
  if (self.estopLatched) {
    sentences.push(
      de
        ? 'Der Not-Aus ist eingerastet — ich fahre nicht, bis ihn jemand zurücksetzt.'
        : 'My E-Stop is latched — I will not drive until someone resets it.',
    );
  } else if (self.damped) {
    sentences.push(
      de
        ? 'Meine Basis ist gedämpft; sag `posture stand`, bevor ich laufe.'
        : 'My base is damped; send `posture stand` before I walk.',
    );
  }

  return sentences.join(' ');
}

/** `47` → `47th`. English only; the German sentence uses the ordinal dot. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let singleton: IdentityStore | null = null;

/**
 * Process-wide store — one robot, one identity. Lazily constructed and doing no
 * I/O until something asks it to load, so a unit test that never touches
 * identity never creates a workspace directory.
 */
export function getIdentityStore(): IdentityStore {
  if (!singleton) singleton = new IdentityStore();
  return singleton;
}

/** Test seam: point the singleton at a temp workspace (or reset it with `null`). */
export function setIdentityStore(store: IdentityStore | null): void {
  singleton = store;
}
