/**
 * @file vrModeRequest.ts
 * @description The headset's side of a mode request (TASK-417, D1): the desktop
 *              assistant, who watches the robot, asks for Stand up or Balance;
 *              the operator allows it with a one-second hold on the robot panel,
 *              and the headset's page sends the change itself, under its own
 *              lease, through the same lease-checked route the desktop uses.
 *
 *              Pure: a prompt, the facts that may suppress it, and the answers
 *              to send. No React, no socket, no timers — the modal ticks it.
 *
 *              The prompt never shows during a latched E-stop, without the
 *              lease, or for a mode the measured state does not allow next
 *              (Stand up only from limp/damped, Balance only from stand). A
 *              request that cannot be shown is answered `declined` at once, so
 *              the desktop does not wait ten seconds for nothing.
 * @feature robots
 */

import type { HudBaseMode } from './vrHud';
import type { PanelLine } from './vrWhy';
import { PANEL_COLORS } from './vrWhy';

/** The modes the desktop may ask for — never Limp, never walking (D2). */
export type VrRequestedMode = 'stand' | 'balance';

export type VrModeOutcome = 'allowed' | 'declined' | 'expired' | 'failed';

/** How long a prompt stays up, ms, unless the request says less. */
export const VR_MODE_PROMPT_MS = 10_000;

/** The label a mode has everywhere: "Stand up", "Balance". */
export const VR_MODE_LABEL: Record<VrRequestedMode, string> = { stand: 'Stand up', balance: 'Balance' };

/** One request on show. */
export interface VrModePrompt {
  requestId: string;
  mode: VrRequestedMode;
  /** `Date.now()` after which it answers `expired`. */
  expiresAt: number;
}

/** What may suppress a prompt, all read off the rig telemetry and the lease. */
export interface VrModePromptFacts {
  estopLatched: boolean;
  /** This headset holds the bound lease. */
  leaseHeld: boolean;
  /** NeoDEM can change this robot's mode at all. */
  modeControl: 'off' | 'fsm' | 'full';
  baseMode: HudBaseMode;
  baseDamped: boolean;
}

/** One answer to send back to the asker. */
export interface VrModeAnswer {
  requestId: string;
  outcome: VrModeOutcome;
  error?: string;
}

export interface VrModeStep {
  prompt: VrModePrompt | null;
  answers: VrModeAnswer[];
}

/**
 * Why `mode` cannot be offered right now, as the desktop will read it — or null
 * when the prompt may show. The E-stop comes first: nothing else matters then.
 */
export function vrModePromptBlock(mode: VrRequestedMode, facts: VrModePromptFacts): string | null {
  if (facts.estopLatched) return 'the E-stop is latched in the headset';
  if (!facts.leaseHeld) return 'the headset does not hold control';
  if (facts.modeControl !== 'fsm' && facts.modeControl !== 'full') return 'mode control is off on this robot';
  if (mode === 'stand') {
    const limp = facts.baseMode === 'limp' || facts.baseMode === 'zero_torque' || facts.baseDamped;
    return limp ? null : `the robot is ${facts.baseMode}; Stand up needs limp`;
  }
  return facts.baseMode === 'stand' && !facts.baseDamped ? null : `the robot is ${facts.baseMode}; Balance needs Stand`;
}

/** A request arrived: show it, or decline it at once. A newer request replaces an older one. */
export function vrModeArrive(
  current: VrModePrompt | null,
  request: { requestId: string; mode: VrRequestedMode; ttlMs?: number },
  now: number,
  facts: VrModePromptFacts,
): VrModeStep {
  const answers: VrModeAnswer[] = [];
  if (current) answers.push({ requestId: current.requestId, outcome: 'declined', error: 'a newer request replaced it' });
  const blocked = vrModePromptBlock(request.mode, facts);
  if (blocked) {
    answers.push({ requestId: request.requestId, outcome: 'declined', error: blocked });
    return { prompt: null, answers };
  }
  const ttl = request.ttlMs !== undefined && Number.isFinite(request.ttlMs)
    ? Math.min(VR_MODE_PROMPT_MS, Math.max(0, request.ttlMs))
    : VR_MODE_PROMPT_MS;
  return { prompt: { requestId: request.requestId, mode: request.mode, expiresAt: now + ttl }, answers };
}

/** Time passes: expire the prompt, or withdraw it when the facts no longer allow it. */
export function vrModeTick(current: VrModePrompt | null, now: number, facts: VrModePromptFacts): VrModeStep {
  if (!current) return { prompt: null, answers: [] };
  if (now >= current.expiresAt) {
    return { prompt: null, answers: [{ requestId: current.requestId, outcome: 'expired' }] };
  }
  const blocked = vrModePromptBlock(current.mode, facts);
  if (blocked) return { prompt: null, answers: [{ requestId: current.requestId, outcome: 'declined', error: blocked }] };
  return { prompt: current, answers: [] };
}

/**
 * The operator held "allow": the mode to send now, or the answer when it may
 * no longer be sent. The answer for a sent mode follows the route's reply.
 */
export function vrModeAllow(
  current: VrModePrompt | null,
  now: number,
  facts: VrModePromptFacts,
): { prompt: null; send: VrModePrompt | null; answers: VrModeAnswer[] } {
  if (!current) return { prompt: null, send: null, answers: [] };
  const step = vrModeTick(current, now, facts);
  if (!step.prompt) return { prompt: null, send: null, answers: step.answers };
  return { prompt: null, send: current, answers: [] };
}

/** The panel's prompt line: `DESKTOP ASKS: Balance · 7 s`. */
export function vrModePromptLine(prompt: VrModePrompt, now: number): PanelLine {
  const left = Math.max(0, Math.ceil((prompt.expiresAt - now) / 1000));
  return {
    id: 'mode-request',
    text: `DESKTOP ASKS: ${VR_MODE_LABEL[prompt.mode]} · ${left} s`,
    color: PANEL_COLORS.warn,
    bold: true,
  };
}

/** The allow button's label: `Hold to allow Balance`. */
export function vrModeAllowLabel(mode: VrRequestedMode): string {
  return `Hold to allow ${VR_MODE_LABEL[mode]}`;
}
