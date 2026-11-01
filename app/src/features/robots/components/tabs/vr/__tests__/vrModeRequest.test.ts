/**
 * @file vrModeRequest.test.ts
 * @description TASK-417: the headset's prompt for a desktop mode request —
 *              arrive, allow, expire, and suppressed during a latched E-stop,
 *              without the lease, or for a mode that is not next.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import {
  VR_MODE_PROMPT_MS,
  vrModeAllow,
  vrModeAllowLabel,
  vrModeArrive,
  vrModePromptBlock,
  vrModePromptLine,
  vrModeTick,
  type VrModePromptFacts,
} from '../vrModeRequest';

const NOW = 50_000;
const LIMP: VrModePromptFacts = { estopLatched: false, leaseHeld: true, modeControl: 'fsm', baseMode: 'limp', baseDamped: true };
const STAND: VrModePromptFacts = { ...LIMP, baseMode: 'stand', baseDamped: false };

describe('vrModePromptBlock — when the prompt may show', () => {
  it('Stand up only from limp or damped, Balance only from stand', () => {
    expect(vrModePromptBlock('stand', LIMP)).toBeNull();
    expect(vrModePromptBlock('stand', { ...LIMP, baseMode: 'zero_torque' })).toBeNull();
    expect(vrModePromptBlock('balance', LIMP)).toMatch(/Balance needs Stand/);
    expect(vrModePromptBlock('balance', STAND)).toBeNull();
    expect(vrModePromptBlock('stand', STAND)).toMatch(/Stand up needs limp/);
    expect(vrModePromptBlock('balance', { ...STAND, baseMode: 'balance' })).not.toBeNull();
  });

  it('never during a latched E-stop, without the lease, or without mode control', () => {
    expect(vrModePromptBlock('stand', { ...LIMP, estopLatched: true })).toMatch(/E-stop/);
    expect(vrModePromptBlock('stand', { ...LIMP, leaseHeld: false })).toMatch(/control/);
    expect(vrModePromptBlock('stand', { ...LIMP, modeControl: 'off' })).toMatch(/mode control is off/);
  });
});

describe('the prompt state machine', () => {
  it('arrives with a 10 s expiry and its line and button', () => {
    const step = vrModeArrive(null, { requestId: 'r1', mode: 'stand', ttlMs: 10_000 }, NOW, LIMP);
    expect(step).toEqual({ prompt: { requestId: 'r1', mode: 'stand', expiresAt: NOW + VR_MODE_PROMPT_MS }, answers: [] });
    expect(vrModePromptLine(step.prompt!, NOW + 2_400).text).toBe('DESKTOP ASKS: Stand up · 8 s');
    expect(vrModeAllowLabel('balance')).toBe('Hold to allow Balance');
  });

  it('is declined at once, and never shown, during a latched E-stop', () => {
    const step = vrModeArrive(null, { requestId: 'r1', mode: 'stand' }, NOW, { ...LIMP, estopLatched: true });
    expect(step.prompt).toBeNull();
    expect(step.answers).toEqual([{ requestId: 'r1', outcome: 'declined', error: 'the E-stop is latched in the headset' }]);
  });

  it('expires after 10 s unanswered', () => {
    const { prompt } = vrModeArrive(null, { requestId: 'r1', mode: 'stand' }, NOW, LIMP);
    expect(vrModeTick(prompt, NOW + 9_999, LIMP)).toEqual({ prompt, answers: [] });
    expect(vrModeTick(prompt, NOW + 10_000, LIMP)).toEqual({ prompt: null, answers: [{ requestId: 'r1', outcome: 'expired' }] });
  });

  it('is withdrawn the moment an E-stop latches or the lease goes', () => {
    const { prompt } = vrModeArrive(null, { requestId: 'r1', mode: 'stand' }, NOW, LIMP);
    expect(vrModeTick(prompt, NOW + 1_000, { ...LIMP, estopLatched: true }).answers[0]).toMatchObject({ outcome: 'declined' });
    expect(vrModeTick(prompt, NOW + 1_000, { ...LIMP, leaseHeld: false }).prompt).toBeNull();
  });

  it('allowing it hands back the mode to send; the route answers allowed or failed', () => {
    const { prompt } = vrModeArrive(null, { requestId: 'r1', mode: 'balance' }, NOW, STAND);
    expect(vrModeAllow(prompt, NOW + 3_000, STAND)).toEqual({ prompt: null, send: prompt, answers: [] });
    // Too late, or no longer allowed: nothing is sent.
    expect(vrModeAllow(prompt, NOW + 10_000, STAND)).toMatchObject({ send: null, answers: [{ outcome: 'expired' }] });
    expect(vrModeAllow(prompt, NOW + 1_000, { ...STAND, estopLatched: true })).toMatchObject({ send: null, answers: [{ outcome: 'declined' }] });
    expect(vrModeAllow(null, NOW, STAND)).toEqual({ prompt: null, send: null, answers: [] });
  });

  it('a newer request replaces an older one, which is declined', () => {
    const first = vrModeArrive(null, { requestId: 'r1', mode: 'stand' }, NOW, LIMP).prompt;
    const step = vrModeArrive(first, { requestId: 'r2', mode: 'stand' }, NOW + 2_000, LIMP);
    expect(step.prompt?.requestId).toBe('r2');
    expect(step.answers).toEqual([{ requestId: 'r1', outcome: 'declined', error: 'a newer request replaced it' }]);
  });
});
