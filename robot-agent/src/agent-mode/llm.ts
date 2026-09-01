/**
 * @file llm.ts
 * @description Thin bridge from Agent Mode to the shared Genkit instance.
 *              Deliberately the ONLY agent-mode module that imports
 *              `agent/genkit.js`, and it is loaded lazily (dynamic import) by
 *              planner.ts / vision.ts so that pulling in the controller — e.g.
 *              from `api/rest-routes.ts` — does not drag the whole Genkit +
 *              GoogleAI plugin graph into every consumer (and every test).
 *              A `thinking: false` request to an Ollama model skips Genkit
 *              altogether and goes to Ollama's native /api/chat — see
 *              {@link nativeThinkOffCall} and {@link buildGenerateConfig}.
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
  /**
   * Cancels the request. Genkit forwards it to the underlying fetch, so an
   * aborted call releases the socket instead of being abandoned in flight —
   * the difference between a caller that stopped waiting and a request that
   * stopped. A wedged Ollama worker is exactly the case where "abandoned in
   * flight" accumulates.
   */
  signal?: AbortSignal;
}

/**
 * Genkit `config` for one request. Split out from {@link genkitGenerate} so the
 * mapping is unit-testable without a live Ollama.
 *
 * `reasoning_effort: 'none'` is the OpenAI-compatible way to ask for no
 * thinking, and `@genkit-ai/compat-oai` is what gets it onto the wire: it
 * spreads config keys it does not recognise into the OpenAI request body
 * verbatim (`model.js`: `body = { ...body, ...restOfConfig }`), which is how a
 * snake_case field survives a camelCase config object.
 *
 * It is NOT, however, the thing that suppresses thinking for Agent Mode any
 * more: a `thinking: false` request against an Ollama model is rerouted to the
 * native endpoint by {@link genkitGenerate} (see {@link nativeThinkOffCall}),
 * and never reaches this config at all. What is left here serves the requests
 * that do stay on /v1 — a non-Ollama provider, and the media prompt the native
 * path declines.
 *
 * ## What was measured, and what the previous version of this comment claimed
 *
 * This comment used to say that `reasoning_effort` "is what actually turns
 * thinking off" and that native `think: false` "is NOT a substitute … Ollama
 * 0.32.3 silently ignores it". Re-measured 2026-08-30 against the live box
 * (Ollama **0.32.6**, one planner prompt, `temperature: 1e-4`, the JSON schema
 * `toJsonSchema(PlanSchema)` actually produces), that is not what either
 * endpoint does — and the truth is per-model, not per-endpoint:
 *
 * | model (role)                  | /v1 `reasoning_effort:'none'` | native `think:false` |
 * | ----------------------------- | ----------------------------- | -------------------- |
 * | `gemma4:12b` (planner)        | 0 chars of reasoning, 6.5 s   | 0 chars, 6.4 s       |
 * | `qwen3-vl:8b` (vision)        | 10 616 chars — IGNORED        | 8 876 chars — IGNORED|
 *
 * For reference, `gemma4:12b` with neither knob thinks for 8 949 chars / 42 s,
 * so on that model both knobs are doing real work and produce byte-identical
 * answers. The old comment was therefore right about the model it was written
 * against (some gemma on 0.32.3) and wrong to state it as a property of the
 * endpoint. `qwen3-vl:8b` honours neither — no code here can fix that; only
 * `AGENT_VISION_THINKING` budgeting or another model can.
 *
 * We nonetheless route `thinking: false` over the native endpoint, because
 * `think` is Ollama's own documented knob for exactly this and does not depend
 * on an OpenAI-compat shim forwarding an unknown key; `reasoning_effort` only
 * ever worked here by way of the `restOfConfig` spread above.
 */
export function buildGenerateConfig(req: GenerateRequest): Record<string, unknown> {
  return {
    temperature: effectiveTemperature(req),
    ...(req.thinking === false ? { reasoning_effort: 'none' } : {}),
  };
}

/**
 * The temperature both transports send. Never a literal 0 — see
 * {@link NEAR_ZERO_TEMPERATURE}. The native endpoint would in fact honour a 0
 * (it has no truthiness strip), but there is no reason for the two paths to
 * sample differently, and 1e-4 is greedy decoding either way.
 */
function effectiveTemperature(req: GenerateRequest): number {
  const temperature = req.temperature ?? 0;
  return temperature === 0 ? NEAR_ZERO_TEMPERATURE : temperature;
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

/* --------------------------------------------------------------------------
 * Ollama's native endpoint, used only for `thinking: false`.
 * ------------------------------------------------------------------------ */

/**
 * The Genkit plugin names registered against an Ollama host in
 * `agent/genkit.ts`: `ollama` always, plus `agentollama` when Agent Mode points
 * at a different host (that file's `AGENT_OLLAMA_PREFIX`). Anything else —
 * `googleai/…`, `openrouter/…` — is a different provider and must never be
 * rerouted. Kept as a literal rather than imported so this module can decide
 * without pulling in the Genkit plugin graph.
 */
const OLLAMA_BASE_URL_BY_PREFIX = {
  ollama: (urls: OllamaBaseUrls) => urls.ollamaBaseUrl,
  agentollama: (urls: OllamaBaseUrls) => urls.agentOllamaBaseUrl,
} as const;

/** The two Ollama hosts config knows about; see `agent/genkit.ts`. */
export interface OllamaBaseUrls {
  /** `OLLAMA_BASE_URL` — the main agent's host. */
  ollamaBaseUrl: string;
  /** `AGENT_OLLAMA_BASE_URL` — Agent Mode's host; equal to the above unless split. */
  agentOllamaBaseUrl: string;
}

/** Where a native call goes, and under what bare model name. */
export interface NativeChatCall {
  url: string;
  model: string;
}

/**
 * The native chat endpoint on the same host as an OpenAI-compatible base URL.
 *
 * `AGENT_OLLAMA_BASE_URL` points at `…/v1` (config warns when it does not, and
 * every /v1 call 404s without it). Ollama serves its own API alongside that, at
 * `/api/chat` on the same origin — so this is a rewrite of the existing knob,
 * not a second one to configure and get out of sync.
 */
export function nativeOllamaChatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/api/chat`;
}

/** The base64 payload of a `data:…;base64,…` URL, or null for anything else. */
function base64FromDataUrl(url: string): string | null {
  const match = /^data:[^,]*;base64,([\s\S]+)$/i.exec(url);
  return match ? match[1]! : null;
}

/**
 * Decide whether one request should leave the OpenAI-compatible path.
 *
 * Returns null — i.e. "stay on /v1, unchanged" — unless ALL of:
 *   * thinking was explicitly switched off (the only thing this path is for);
 *   * the model ref names an Ollama plugin (a Gemini or OpenRouter call is
 *     untouched, and so is Ollama with thinking left on);
 *   * every image in the prompt is a base64 data URL. Native `/api/chat` takes
 *     images as bare base64 in `images`, which the vision prompt's
 *     `data:image/jpeg;base64,…` supplies directly — but it cannot fetch a
 *     remote URL the way the OpenAI `image_url` part can, so a prompt carrying
 *     one keeps its existing transport rather than silently losing the frame.
 */
export function nativeThinkOffCall(
  req: GenerateRequest,
  urls: OllamaBaseUrls
): NativeChatCall | null {
  if (req.thinking !== false) return null;

  const slash = req.model.indexOf('/');
  if (slash <= 0) return null;
  const prefix = req.model.slice(0, slash);
  const model = req.model.slice(slash + 1);
  if (!model) return null;
  const baseUrlOf = OLLAMA_BASE_URL_BY_PREFIX[prefix as keyof typeof OLLAMA_BASE_URL_BY_PREFIX];
  if (!baseUrlOf) return null;
  const baseUrl = baseUrlOf(urls);
  if (!baseUrl) return null;

  for (const part of req.prompt) {
    if ('media' in part && base64FromDataUrl(part.media.url) === null) return null;
  }

  return { url: nativeOllamaChatUrl(baseUrl), model };
}

/**
 * The prompt as one native `messages` entry. Text parts are concatenated and
 * images travel as bare base64 in `images`, which is Ollama's own multimodal
 * shape — the equivalent of the `image_url` content parts `@genkit-ai/compat-oai`
 * builds for /v1.
 */
export function toNativeChatMessage(prompt: PromptPart[]): {
  role: 'user';
  content: string;
  images?: string[];
} {
  const text: string[] = [];
  const images: string[] = [];
  for (const part of prompt) {
    if ('text' in part) text.push(part.text);
    else {
      const b64 = base64FromDataUrl(part.media.url);
      // nativeThinkOffCall has already refused anything else.
      if (b64) images.push(b64);
    }
  }
  return { role: 'user', content: text.join('\n\n'), ...(images.length > 0 ? { images } : {}) };
}

/**
 * The native request body. `format` carries the same JSON schema Genkit would
 * have put in `response_format.json_schema` — dropping it would quietly turn
 * constrained decoding off, and measurably changes what a small model answers
 * (gemma4:12b returns fenced ```json prose without it).
 */
export function buildNativeChatBody(
  req: GenerateRequest,
  model: string,
  formatSchema?: unknown
): Record<string, unknown> {
  return {
    model,
    messages: [toNativeChatMessage(req.prompt)],
    // One answer, not a token stream: the caller wants a plan, not a UI.
    stream: false,
    think: false,
    options: { temperature: effectiveTemperature(req) },
    ...(formatSchema ? { format: formatSchema } : {}),
  };
}

/**
 * One native `/api/chat` call, shaped to look exactly like a Genkit one to the
 * caller.
 *
 * `output` is always null: Genkit is not involved, so there is no Genkit-parsed
 * structured output. Every caller already falls back to
 * `res.output ?? extractJsonObject(res.text)` because small models ignore
 * constrained decoding often enough that the fallback is the normal path.
 *
 * An empty answer THROWS rather than returning `{ text: '' }`. That is the
 * behaviour /v1 has today — with an output schema Genkit raises
 * "Schema validation failed … Provided data: null" — and it is the difference
 * the callers depend on: a throw is "no answer" (planner logs
 * "(no answer — the model call failed)", vision degrades), whereas an empty
 * string would be handed to the validator and reported as an invalid plan.
 */
export async function ollamaNativeGenerate(
  req: GenerateRequest,
  call: NativeChatCall,
  formatSchema?: unknown,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<GenerateResponse> {
  const response = await fetchImpl(call.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildNativeChatBody(req, call.model, formatSchema)),
    // Same contract as the /v1 path: an abandoned call releases its socket.
    ...(req.signal ? { signal: req.signal } : {}),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Ollama ${call.url} answered ${response.status} ${response.statusText}` +
        (detail ? `: ${detail.slice(0, 300)}` : '')
    );
  }
  const body = (await response.json()) as {
    message?: { content?: string; thinking?: string };
  };
  const text = body.message?.content ?? '';
  if (!text.trim()) {
    const thought = body.message?.thinking?.length ?? 0;
    throw new Error(
      `Ollama ${call.model} returned no content` +
        (thought > 0
          ? ` — it spent the answer on ${thought} characters of thinking despite think:false, ` +
            'which this model does not honour'
          : '')
    );
  }
  return { text, output: null };
}

export const genkitGenerate: GenerateFn = async (req) => {
  // Ollama + thinking explicitly off: take Ollama's own endpoint, where `think`
  // is a first-class field. See buildGenerateConfig for the measurements.
  if (req.thinking === false) {
    const { config } = await import('../config/config.js');
    const call = nativeThinkOffCall(req, {
      ollamaBaseUrl: config.ollamaBaseUrl,
      agentOllamaBaseUrl: config.agentMode.ollamaBaseUrl,
    });
    if (call) {
      // Imported here, not at module scope, and only when there is a schema:
      // `genkit/schema` is a corner of @genkit-ai/core, and the point of this
      // path is to answer without loading the plugin graph.
      let formatSchema: unknown;
      if (req.outputSchema) {
        const { toJsonSchema } = await import('genkit/schema');
        formatSchema = toJsonSchema({ schema: req.outputSchema });
      }
      return ollamaNativeGenerate(req, call, formatSchema);
    }
  }

  const { ai } = await import('../agent/genkit.js');
  const response = await ai.generate({
    model: req.model,
    prompt: req.prompt,
    ...(req.outputSchema ? { output: { schema: req.outputSchema } } : {}),
    // A sibling of `config`, deliberately NOT inside it: `buildGenerateConfig`
    // is spread into the OpenAI request body verbatim by `@genkit-ai/compat-oai`,
    // so an AbortSignal put there would be serialised into the wire payload
    // instead of cancelling anything.
    ...(req.signal ? { abortSignal: req.signal } : {}),
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
