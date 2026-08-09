/**
 * @file GeminiProvider.ts
 * @description LlmProvider backed by Google Gemini (@google/generative-ai)
 * @feature llm
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
  JsonSchema,
  LlmJsonRequest,
  LlmProvider,
  LlmProviderName,
  LlmTextRequest,
} from './types.js';

/**
 * Gemini's `responseSchema` is OpenAPI-flavoured and accepts the same lowercase
 * type strings as {@link JsonSchema}, plus `nullable` — so it passes straight
 * through. Kept as an explicit step so the neutral schema stays the source of
 * truth and any future divergence has one place to live.
 */
function toGeminiSchema(schema: JsonSchema): unknown {
  return schema;
}

/**
 * Honour the caller's `signal` by racing it.
 *
 * The Google SDK exposes no cancellation hook — its `RequestOptions` carries a
 * `timeout` but no `signal` — so the in-flight request is not truly cancelled;
 * the caller simply stops waiting on it. That is what the orchestrator's budget
 * needs, and without this the timeout would silently do nothing on Gemini.
 */
function withAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;

  if (signal.aborted) {
    // `work` is already in flight — the caller built it before calling in here.
    // Without a listener its eventual failure surfaces as an unhandled rejection,
    // which Node can escalate to a process exit.
    void work.catch(() => {});
    return Promise.reject(abortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function abortError(): Error {
  const error = new Error('Gemini request aborted');
  error.name = 'AbortError';
  return error;
}

export class GeminiProvider implements LlmProvider {
  readonly providerName: LlmProviderName = 'gemini';
  readonly supportsVision = true;

  private readonly client: GoogleGenerativeAI;

  constructor(
    apiKey: string,
    readonly modelId: string
  ) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generateText(req: LlmTextRequest): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      generationConfig: {
        maxOutputTokens: req.maxTokens,
        temperature: req.temperature,
      },
      ...(req.system ? { systemInstruction: req.system } : {}),
    });

    const result = await withAbort(model.generateContent(req.prompt), req.signal);
    return result.response.text().trim();
  }

  async generateJson<T>(req: LlmJsonRequest): Promise<T> {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      generationConfig: {
        responseMimeType: 'application/json',
        ...(req.schema ? { responseSchema: toGeminiSchema(req.schema) as never } : {}),
        maxOutputTokens: req.maxTokens,
        temperature: req.temperature,
      },
      ...(req.system ? { systemInstruction: req.system } : {}),
    });

    // Text-only requests keep the historical single-string call shape, which the
    // CommandInterpreter tests assert on verbatim.
    const result = await withAbort(
      req.images?.length
        ? model.generateContent([
            ...req.images.map((img) => ({
              inlineData: { mimeType: img.mimeType, data: img.base64 },
            })),
            { text: req.prompt },
          ] as never)
        : model.generateContent(req.prompt),
      req.signal
    );

    return JSON.parse(stripJsonFences(result.response.text())) as T;
  }
}

/** Some Gemini models wrap JSON in markdown fences despite `responseMimeType`. */
export function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}
