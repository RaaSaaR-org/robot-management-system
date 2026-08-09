/**
 * @file index.ts
 * @description Resolves the active LlmProvider from environment configuration
 * @feature llm
 */

import { GeminiProvider } from './GeminiProvider.js';
import { OpenAICompatProvider } from './OpenAICompatProvider.js';
import type { LlmProvider, LlmProviderName, LlmRole } from './types.js';

export * from './types.js';
export { GeminiProvider } from './GeminiProvider.js';
export { OpenAICompatProvider, stripThinking, toOpenAiSchema } from './OpenAICompatProvider.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

/**
 * Per-provider default models, by role.
 *
 * The `gemini` entries reproduce the model ids that were hardcoded at each call
 * site before this abstraction existed, so an unconfigured server behaves
 * exactly as it did — including the `modelUsed` strings written to the EU AI
 * Act audit trail.
 */
const DEFAULT_MODELS: Record<LlmProviderName, Record<LlmRole, string>> = {
  gemini: { text: 'gemini-2.0-flash', vision: 'gemini-2.5-flash' },
  openrouter: {
    text: 'stepfun/step-3.5-flash:free',
    vision: 'stepfun/step-3.5-flash:free',
  },
  ollama: { text: 'qwen3.6', vision: 'qwen3-vl:8b' },
};

export interface ResolveLlmOptions {
  /** Which default model to reach for. */
  role: LlmRole;
  /** Per-call-site model override (e.g. `ORCHESTRATOR_MODEL`), if set. */
  modelOverride?: string;
  /**
   * Providers this call site historically supported, most preferred first.
   * Consulted only when `LLM_PROVIDER` is unset, so existing deployments keep
   * their current behaviour (orchestrator → OpenRouter, the rest → Gemini).
   */
  credentialOrder: LlmProviderName[];
  /** Label for startup logging. */
  label: string;
}

/** Reads `LLM_PROVIDER`, tolerating case and surrounding whitespace. */
function explicitProvider(): LlmProviderName | null {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (raw === 'gemini' || raw === 'openrouter' || raw === 'ollama') return raw;
  if (raw) {
    console.warn(`[LLM] Unknown LLM_PROVIDER "${raw}", ignoring`);
  }
  return null;
}

/** A provider is usable when its credentials are present; Ollama needs none. */
function hasCredentials(name: LlmProviderName): boolean {
  switch (name) {
    case 'gemini':
      return isRealKey(process.env.GOOGLE_API_KEY);
    case 'openrouter':
      return isRealKey(process.env.OPENROUTER_API_KEY);
    case 'ollama':
      return true;
  }
}

/** Treats the shipped `.env.example` placeholders as "not configured". */
function isRealKey(value: string | undefined): boolean {
  const v = value?.trim();
  return !!v && v !== 'your-api-key' && !v.startsWith('your_');
}

/**
 * Resolve the provider for one call site, or `null` when none is configured —
 * in which case the caller uses its own non-LLM fallback.
 */
export function resolveLlmProvider(opts: ResolveLlmOptions): LlmProvider | null {
  const explicit = explicitProvider();
  const name = explicit ?? opts.credentialOrder.find(hasCredentials) ?? null;

  if (!name) return null;

  if (explicit && !hasCredentials(explicit)) {
    console.warn(
      `[LLM:${opts.label}] LLM_PROVIDER=${explicit} but its API key is not set — using fallback`
    );
    return null;
  }

  // Per-call-site override wins, then the server-wide LLM_MODEL (which the
  // robot agent also honours, so one name configures both), then the default.
  // LLM_MODEL is text-only on purpose: pointing every role at one name would
  // silently hand the curation VLM a model that cannot see, and that role
  // already has its own CURATION_VLM_MODEL override.
  const model =
    opts.modelOverride?.trim() ||
    (opts.role === 'text' ? process.env.LLM_MODEL?.trim() : undefined) ||
    DEFAULT_MODELS[name][opts.role];
  const provider = build(name, model, opts.role);

  console.log(`[LLM:${opts.label}] Using ${name} model ${model}`);
  return provider;
}

function build(name: LlmProviderName, model: string, role: LlmRole): LlmProvider {
  switch (name) {
    case 'gemini':
      return new GeminiProvider(process.env.GOOGLE_API_KEY as string, model);
    case 'openrouter':
      return new OpenAICompatProvider(
        'openrouter',
        OPENROUTER_BASE_URL,
        process.env.OPENROUTER_API_KEY as string,
        model,
        role === 'vision'
      );
    case 'ollama':
      return new OpenAICompatProvider(
        'ollama',
        normalizeOllamaBaseUrl(process.env.OLLAMA_BASE_URL),
        // Ollama ignores the key; the OpenAI wire format requires one.
        'ollama',
        model,
        role === 'vision'
      );
  }
}

/**
 * Ollama's OpenAI-compatible surface lives under `/v1`. Pointing at the bare
 * host is the single most common misconfiguration, and it fails as a confusing
 * 404 from `/api/chat/completions`, so fix it here and say so once.
 */
export function normalizeOllamaBaseUrl(raw: string | undefined): string {
  const base = (raw?.trim() || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '');
  if (/\/v\d+$/.test(base)) return base;
  console.warn(`[LLM] OLLAMA_BASE_URL "${base}" has no /v1 suffix — appending it`);
  return `${base}/v1`;
}
