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

    const result = await model.generateContent(req.prompt);
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
    const result = req.images?.length
      ? await model.generateContent([
          ...req.images.map((img) => ({
            inlineData: { mimeType: img.mimeType, data: img.base64 },
          })),
          { text: req.prompt },
        ] as never)
      : await model.generateContent(req.prompt);

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
