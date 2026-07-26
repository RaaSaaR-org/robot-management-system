/**
 * @file llm.ts
 * @description Thin bridge from Agent Mode to the shared Genkit instance.
 *              Deliberately the ONLY agent-mode module that imports
 *              `agent/genkit.js`, and it is loaded lazily (dynamic import) by
 *              planner.ts / vision.ts so that pulling in the controller — e.g.
 *              from `api/rest-routes.ts` — does not drag the whole Genkit +
 *              GoogleAI plugin graph into every consumer (and every test).
 * @feature agentmode
 * @status live
 */

import type { z } from 'genkit';

/** A single prompt part: plain text, or an inline image as a data URL. */
export type PromptPart = { text: string } | { media: { url: string; contentType?: string } };

export interface GenerateRequest {
  /** Fully-qualified model ref, e.g. `ollama/gemma3:4b`. */
  model: string;
  prompt: PromptPart[];
  /** Optional structured-output schema; the caller re-validates regardless. */
  outputSchema?: z.ZodTypeAny;
  temperature?: number;
  /**
   * Whether the model may think before answering. `false` suppresses it;
   * omitted leaves the model's own default alone. See
   * `config.agentMode.plannerThinking` / `visionThinking` for the measured
   * cost of each setting — this flag only carries the decision, it does not
   * make it.
   */
  thinking?: boolean;
}

/**
 * Genkit `config` for one request. Split out from {@link genkitGenerate} so the
 * mapping is unit-testable without a live Ollama.
 *
 * `reasoning_effort: 'none'` is what actually turns thinking off on the
 * OpenAI-compatible endpoint we talk to (`AGENT_OLLAMA_BASE_URL` ends in /v1).
 * The native `think: false` is NOT a substitute: sent to /v1 Ollama 0.32.3
 * silently ignores it and still spends ~500 tokens thinking. `@genkit-ai/compat-oai`
 * spreads config keys it does not recognise into the OpenAI request body
 * verbatim (`model.js`: `body = { ...body, ...restOfConfig }`), which is how a
 * snake_case field survives a camelCase config object.
 */
export function buildGenerateConfig(req: GenerateRequest): Record<string, unknown> {
  const temperature = req.temperature ?? 0;
  return {
    temperature: temperature === 0 ? NEAR_ZERO_TEMPERATURE : temperature,
    ...(req.thinking === false ? { reasoning_effort: 'none' } : {}),
  };
}

/**
 * What we send instead of a literal `temperature: 0`.
 *
 * `@genkit-ai/compat-oai` finishes building the OpenAI request body with
 *
 *     for (const key in body) { if (!body[key] || ...) delete body[key]; }
 *
 * — a truthiness test, so `temperature: 0` is deleted along with the undefined
 * keys it is meant to clean up (`lib/model.js`, `toOpenAIRequestBody`). Verified
 * against a logging proxy: at 0 the outgoing body carries no `temperature` at
 * all and Ollama applies its own default (0.8 for gemma), so every Agent Mode
 * call has in fact been sampling. At 0.7 the field survives.
 *
 * A value that is tiny but truthy is greedy decoding in practice and survives
 * the strip. Do not "simplify" this back to 0 — the plugin's own
 * `requestBuilder` hook cannot help either, because the strip runs after it.
 */
const NEAR_ZERO_TEMPERATURE = 1e-4;

export interface GenerateResponse {
  /** Raw model text — always present, even when structured output succeeded. */
  text: string;
  /** Genkit's parsed structured output, or null when it could not produce one. */
  output: unknown;
}

/** Injected in tests; the default hits Ollama through Genkit. */
export type GenerateFn = (req: GenerateRequest) => Promise<GenerateResponse>;

/**
 * Build the model ref for an agent-mode model. Uses AGENT_OLLAMA_PREFIX so a
 * separate `AGENT_OLLAMA_BASE_URL` host is honoured.
 */
export async function agentModelRef(model: string): Promise<string> {
  const { AGENT_OLLAMA_PREFIX } = await import('../agent/genkit.js');
  return `${AGENT_OLLAMA_PREFIX}/${model}`;
}

export const genkitGenerate: GenerateFn = async (req) => {
  const { ai } = await import('../agent/genkit.js');
  const response = await ai.generate({
    model: req.model,
    prompt: req.prompt,
    ...(req.outputSchema ? { output: { schema: req.outputSchema } } : {}),
    config: buildGenerateConfig(req),
  });
  return { text: response.text, output: response.output };
};

/**
 * Pull the first balanced JSON object out of an LLM answer. Small local models
 * routinely wrap JSON in ```json fences or add a sentence before it, so this is
 * the difference between "works" and "schema error" on gemma3:4b. Returns null
 * when nothing parseable is found — callers must degrade, never throw.
 */
export function extractJsonObject(text: string): unknown {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
