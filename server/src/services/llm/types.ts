/**
 * @file types.ts
 * @description Provider-neutral LLM interface shared by the server's three call sites
 * @feature llm
 */

/**
 * Minimal JSON Schema subset used to constrain structured responses.
 *
 * Deliberately provider-neutral: Google's `responseSchema` and OpenAI's
 * `response_format.json_schema` both accept this shape (Google's `SchemaType`
 * enum members are themselves the lowercase strings used here), so call sites
 * declare one schema and each provider adapts it.
 */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  enum?: string[];
  /** OpenAPI-style nullability; translated per provider. */
  nullable?: boolean;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
}

/** An inline image for multimodal requests. */
export interface LlmImage {
  mimeType: string;
  /** Raw base64, without a `data:` prefix. */
  base64: string;
}

export interface LlmTextRequest {
  /** System instruction / persona. */
  system?: string;
  /** The user turn. */
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Caller-owned cancellation (used for the orchestrator's 5s budget). */
  signal?: AbortSignal;
  /**
   * How much chain-of-thought the model may spend before answering.
   *
   * Reasoning models think by default, which on a mechanical task is both slow
   * and actively harmful: a local qwen3.6 asked to name one agent spent ~3.4s
   * and, in one measured run, its entire token budget on reasoning — returning
   * empty content that reads downstream as "no answer". Set `'none'` for
   * routing and extraction; leave unset where deliberation earns its cost.
   *
   * Silently ignored by providers that do not support it.
   */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

export interface LlmJsonRequest extends LlmTextRequest {
  /** Constrains the response shape when the provider supports it. */
  schema?: JsonSchema;
  /** Inline images for vision-capable models. */
  images?: LlmImage[];
}

/**
 * A single LLM backend, resolved once per call site.
 *
 * Implementations must not swallow errors — each call site already owns a
 * documented non-LLM fallback (keyword matching, motion heuristics) and decides
 * for itself when to take it.
 */
export interface LlmProvider {
  /** Provider family, for logs. */
  readonly providerName: LlmProviderName;
  /** Concrete model id — recorded verbatim in EU AI Act audit trails. */
  readonly modelId: string;
  /** Whether this provider/model can accept `images`. */
  readonly supportsVision: boolean;

  generateText(req: LlmTextRequest): Promise<string>;
  generateJson<T>(req: LlmJsonRequest): Promise<T>;
}

export type LlmProviderName = 'gemini' | 'openrouter' | 'ollama';

/** Which capability a call site needs, so the factory picks a sane default model. */
export type LlmRole = 'text' | 'vision';
