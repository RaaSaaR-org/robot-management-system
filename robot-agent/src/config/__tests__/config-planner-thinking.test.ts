/**
 * @file config-planner-thinking.test.ts
 * @description Per-model resolution of AGENT_PLANNER_THINKING (TASK-249): an
 * explicit true/false wins, unset falls back to the measured per-model default.
 * @feature agent-mode
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PLANNER_MODELS_THAT_THINK, resolvePlannerThinking } from '../config.js';

const THINKER = PLANNER_MODELS_THAT_THINK[0] ?? 'gemma4:e4b';

describe('resolvePlannerThinking', () => {
  it('lists gemma4:e4b, the model measured to lose its goto without thinking', () => {
    expect(PLANNER_MODELS_THAT_THINK).toContain('gemma4:e4b');
  });

  it('does not list gemma4:12b, which plans the same either way', () => {
    expect(PLANNER_MODELS_THAT_THINK).not.toContain('gemma4:12b');
    expect(resolvePlannerThinking('gemma4:12b', undefined)).toBe(false);
  });

  it('turns thinking on by default for a listed model', () => {
    expect(resolvePlannerThinking(THINKER, undefined)).toBe(true);
  });

  it('keeps thinking off by default for an unlisted model', () => {
    expect(resolvePlannerThinking('gemma3:4b', undefined)).toBe(false);
  });

  it('lets an explicit false switch a listed model off', () => {
    expect(resolvePlannerThinking(THINKER, 'false')).toBe(false);
    expect(resolvePlannerThinking(THINKER, ' FALSE ')).toBe(false);
  });

  it('lets an explicit true switch an unlisted model on', () => {
    expect(resolvePlannerThinking('gemma4:12b', 'true')).toBe(true);
    expect(resolvePlannerThinking('gemma4:12b', 'True')).toBe(true);
  });

  it('treats an empty or unrecognised value as unset, not as false', () => {
    expect(resolvePlannerThinking(THINKER, '')).toBe(true);
    expect(resolvePlannerThinking(THINKER, 'yes')).toBe(true);
    expect(resolvePlannerThinking('gemma4:12b', 'yes')).toBe(false);
  });

  it('ignores case and a :latest suffix when looking the model up', () => {
    expect(resolvePlannerThinking(THINKER.toUpperCase(), undefined)).toBe(true);
    expect(resolvePlannerThinking('gemma3:latest', undefined)).toBe(false);
  });
});

describe('config.agentMode.plannerThinking', () => {
  const saved = {
    model: process.env.AGENT_PLANNER_MODEL,
    thinking: process.env.AGENT_PLANNER_THINKING,
  };

  afterEach(() => {
    for (const [k, v] of [
      ['AGENT_PLANNER_MODEL', saved.model],
      ['AGENT_PLANNER_THINKING', saved.thinking],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  async function load(model: string | undefined, thinking: string | undefined) {
    if (model === undefined) delete process.env.AGENT_PLANNER_MODEL;
    else process.env.AGENT_PLANNER_MODEL = model;
    if (thinking === undefined) delete process.env.AGENT_PLANNER_THINKING;
    else process.env.AGENT_PLANNER_THINKING = thinking;
    vi.resetModules();
    return (await import('../config.js')).config.agentMode.plannerThinking;
  }

  it('resolves for the configured planner model', async () => {
    expect(await load(THINKER, undefined)).toBe(true);
    expect(await load('gemma4:12b', undefined)).toBe(false);
  });

  it('keeps the old default for the default model', async () => {
    expect(await load(undefined, undefined)).toBe(false);
  });

  it('honours an explicit override for the configured model', async () => {
    expect(await load(THINKER, 'false')).toBe(false);
    expect(await load('gemma4:12b', 'true')).toBe(true);
  });
});
