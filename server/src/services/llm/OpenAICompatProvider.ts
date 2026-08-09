/**
 * @file OpenAICompatProvider.ts
 * @description LlmProvider for any OpenAI-compatible /chat/completions endpoint (OpenRouter, local Ollama)
 * @feature llm
 */

import { stripJsonFences } from './GeminiProvider.js';
import type {
  JsonSchema,
  LlmJsonRequest,
  LlmProvider,
  LlmProviderName,
  LlmTextRequest,
} from './types.js';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Reasoning models (qwen3.6, gemma4, gpt-oss) emit chain-of-thought when
 * thinking is enabled — which it is by default in Ollama 0.32. Well-behaved
 * builds put it in a separate `reasoning` field, but several leak a
 * `<think>…</think>` block into `content`, which would break JSON.parse and
 * corrupt the orchestrator's exact-name match. Strip it before anything else
 * looks at the text.
 */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // An unterminated block means the model ran out of tokens mid-thought;
    // there is no answer after it, so drop the remainder rather than parse it.
    .replace(/<think>[\s\S]*$/i, '')
    .trim();
}

/**
 * Translate the neutral schema to strict-mode JSON Schema.
 *
 * `nullable: true` is OpenAPI, not JSON Schema — OpenAI-compatible servers
 * either reject it or ignore it, so it becomes a `["type", "null"]` union.
 */
export function toOpenAiSchema(schema: JsonSchema): Record<string, unknown> {
  const { nullable, properties, items, ...rest } = schema;
  const out: Record<string, unknown> = { ...rest };

  if (nullable) {
    out.type = [schema.type, 'null'];
  }
  if (properties) {
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([k, v]) => [k, toOpenAiSchema(v)])
    );
  }
  if (items) {
    out.items = toOpenAiSchema(items);
  }
  return out;
}

export class OpenAICompatProvider implements LlmProvider {
  constructor(
    readonly providerName: LlmProviderName,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly modelId: string,
    readonly supportsVision: boolean
  ) {}

  async generateText(req: LlmTextRequest): Promise<string> {
    const raw = await this.degrade(req, [
      { jsonMode: undefined, reasoning: true },
      { jsonMode: undefined, reasoning: false },
    ]);
    return stripThinking(raw);
  }

  async generateJson<T>(req: LlmJsonRequest): Promise<T> {
    // Most capable request first; each 400 drops one optional feature.
    // `json_object` is universally supported, so it outranks `reasoning_effort`
    // — a model that rejects both still gets schema guidance via the prompt.
    const raw = await this.degrade(req, [
      { jsonMode: 'json_schema', reasoning: true },
      { jsonMode: 'json_object', reasoning: true },
      { jsonMode: 'json_object', reasoning: false },
    ]);
    return JSON.parse(stripJsonFences(stripThinking(raw))) as T;
  }

  /**
   * Try each variant in order, stepping down only on the 400s that indicate an
   * unsupported optional parameter. Variants whose features the request never
   * asked for are skipped rather than retried identically.
   */
  private async degrade(req: LlmJsonRequest, variants: RequestVariant[]): Promise<string> {
    let lastError: unknown;
    let previousBody: string | undefined;

    for (const variant of variants) {
      const body = this.buildBody(req, variant.jsonMode, variant.reasoning);
      const serialized = JSON.stringify(body);
      // Nothing was actually dropped — retrying would just repeat the failure.
      if (serialized === previousBody) continue;
      previousBody = serialized;

      try {
        return await this.chat(body, req.signal);
      } catch (error) {
        if (!(error instanceof UnsupportedRequestError)) throw error;
        lastError = error;
        console.warn(
          `[LLM:${this.providerName}] ${this.modelId} rejected an optional parameter, retrying with fewer`
        );
      }
    }

    throw lastError ?? new Error(`${this.providerName}: no request variant succeeded`);
  }

  private buildBody(
    req: LlmJsonRequest,
    jsonMode: 'json_schema' | 'json_object' | undefined,
    reasoning: boolean
  ): Record<string, unknown> {
    let system = req.system;

    // In json_object mode the schema is not enforced by the server, so it has
    // to reach the model some other way.
    if (jsonMode === 'json_object' && req.schema) {
      system = `${system ? `${system}\n\n` : ''}Respond with JSON matching this schema (no markdown fences):\n${JSON.stringify(
        toOpenAiSchema(req.schema)
      )}`;
    }

    const userContent = req.images?.length
      ? [
          ...req.images.map((img) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
          })),
          { type: 'text' as const, text: req.prompt },
        ]
      : req.prompt;

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: userContent },
      ],
    };

    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (reasoning && req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;

    if (jsonMode === 'json_schema' && req.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema: toOpenAiSchema(req.schema),
        },
      };
    } else if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    return body;
  }

  private async chat(
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const detail = await response.text();
      // Only optional parameters are worth degrading over; a 400 without any
      // is a genuine bad request and must surface to the caller's fallback.
      if (response.status === 400 && (body.response_format || body.reasoning_effort)) {
        throw new UnsupportedRequestError(`${this.providerName} ${response.status}: ${detail}`);
      }
      throw new Error(`${this.providerName} ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    return (data.choices?.[0]?.message?.content ?? '').trim();
  }
}

/** Signals that the endpoint rejected an optional request parameter. */
export class UnsupportedRequestError extends Error {}

/** One rung of the request-degradation ladder. */
interface RequestVariant {
  jsonMode: 'json_schema' | 'json_object' | undefined;
  reasoning: boolean;
}
