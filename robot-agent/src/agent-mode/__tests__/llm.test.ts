/**
 * @file llm.test.ts
 * @description The Genkit request config Agent Mode builds — the two fields
 *              that only look right until you watch the wire: a suppressed
 *              thinking pass, and a temperature of zero.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { buildGenerateConfig } from '../llm.js';

const prompt = [{ text: 'anything' }];

describe('buildGenerateConfig', () => {
  it('suppresses thinking with reasoning_effort, which is what the /v1 endpoint honours', () => {
    const config = buildGenerateConfig({ model: 'ollama/m', prompt, thinking: false });
    expect(config.reasoning_effort).toBe('none');
  });

  it('leaves the model default alone when thinking is on or unspecified', () => {
    expect(buildGenerateConfig({ model: 'ollama/m', prompt, thinking: true })).not.toHaveProperty(
      'reasoning_effort'
    );
    expect(buildGenerateConfig({ model: 'ollama/m', prompt })).not.toHaveProperty(
      'reasoning_effort'
    );
  });

  it('never emits a literal temperature 0 — compat-oai deletes falsy body keys', () => {
    // The plugin ends toOpenAIRequestBody with `if (!body[key]) delete body[key]`,
    // so a 0 here silently becomes "no temperature sent" and Ollama samples at
    // its own default. Verified against a logging proxy before this test existed.
    const zero = buildGenerateConfig({ model: 'ollama/m', prompt, temperature: 0 });
    expect(zero.temperature).toBeTruthy();
    expect(zero.temperature).toBeLessThan(0.01);

    const defaulted = buildGenerateConfig({ model: 'ollama/m', prompt });
    expect(defaulted.temperature).toBeTruthy();
    expect(defaulted.temperature).toBeLessThan(0.01);
  });

  it('passes a non-zero temperature through untouched', () => {
    expect(buildGenerateConfig({ model: 'ollama/m', prompt, temperature: 0.7 }).temperature).toBe(
      0.7
    );
  });
});
