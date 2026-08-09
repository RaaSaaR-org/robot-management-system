/**
 * @file llm.test.ts
 * @description Unit tests for the LLM provider abstraction and its resolver
 * @feature llm
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GeminiProvider,
  OpenAICompatProvider,
  normalizeOllamaBaseUrl,
  resolveLlmProvider,
  stripThinking,
  toOpenAiSchema,
  type JsonSchema,
} from '../index.js';

const ENV_KEYS = [
  'LLM_PROVIDER',
  'GOOGLE_API_KEY',
  'OPENROUTER_API_KEY',
  'OLLAMA_BASE_URL',
  'ORCHESTRATOR_MODEL',
  'LLM_MODEL',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

/** Builds a fetch mock returning one assistant message. */
function mockChat(content: string, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (status >= 300 ? 'upstream error' : content),
    json: async () => ({ choices: [{ message: { content } }] }),
  });
}

describe('stripThinking', () => {
  it('removes a closed think block', () => {
    expect(stripThinking('<think>weighing options</think>Atlas-G1')).toBe('Atlas-G1');
  });

  it('drops an unterminated think block and everything after it', () => {
    // Token budget ran out mid-thought — there is no answer to salvage.
    expect(stripThinking('<think>still reasoning and then')).toBe('');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripThinking('  SimBot-01 ')).toBe('SimBot-01');
  });
});

describe('toOpenAiSchema', () => {
  it('converts OpenAPI nullable into a JSON Schema type union', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { target: { type: 'string', nullable: true } },
    };
    const out = toOpenAiSchema(schema) as {
      properties: { target: { type: unknown; nullable?: boolean } };
    };
    expect(out.properties.target.type).toEqual(['string', 'null']);
    expect(out.properties.target.nullable).toBeUndefined();
  });

  it('recurses into array items', () => {
    const out = toOpenAiSchema({
      type: 'array',
      items: { type: 'number', nullable: true },
    }) as { items: { type: unknown } };
    expect(out.items.type).toEqual(['number', 'null']);
  });
});

describe('normalizeOllamaBaseUrl', () => {
  it('defaults to the local v1 endpoint', () => {
    expect(normalizeOllamaBaseUrl(undefined)).toBe('http://localhost:11434/v1');
  });

  it('appends the missing /v1 suffix', () => {
    expect(normalizeOllamaBaseUrl('http://gpu-box:11434')).toBe('http://gpu-box:11434/v1');
  });

  it('strips trailing slashes without double-appending', () => {
    expect(normalizeOllamaBaseUrl('http://gpu-box:11434/v1/')).toBe('http://gpu-box:11434/v1');
  });
});

describe('OpenAICompatProvider', () => {
  it('posts to the chat completions endpoint and strips thinking', async () => {
    const fetchMock = mockChat('<think>hmm</think>Router-Bot');
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatProvider(
      'ollama',
      'http://localhost:11434/v1',
      'ollama',
      'qwen3.6',
      false
    );
    const out = await provider.generateText({ system: 'route', prompt: 'go', maxTokens: 50 });

    expect(out).toBe('Router-Bot');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.model).toBe('qwen3.6');
    expect(body.messages).toEqual([
      { role: 'system', content: 'route' },
      { role: 'user', content: 'go' },
    ]);
    expect(body.max_tokens).toBe(50);
  });

  it('sends images as data URLs for vision requests', async () => {
    const fetchMock = mockChat('{"kind":"trim"}');
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatProvider(
      'ollama',
      'http://localhost:11434/v1',
      'ollama',
      'qwen3-vl:8b',
      true
    );
    await provider.generateJson({
      prompt: 'review',
      images: [{ mimeType: 'image/jpeg', base64: 'AAAA' }],
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.messages[0].content[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AAAA' },
    });
  });

  it('retries in json_object mode when the endpoint rejects json_schema', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'response_format.type not supported',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"confidence":0.9}' } }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatProvider(
      'ollama',
      'http://localhost:11434/v1',
      'ollama',
      'qwen3.6',
      false
    );
    const out = await provider.generateJson<{ confidence: number }>({
      prompt: 'interpret',
      system: 'you interpret',
      schema: { type: 'object', properties: { confidence: { type: 'number' } } },
    });

    expect(out.confidence).toBe(0.9);
    const retry = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body);
    expect(retry.response_format).toEqual({ type: 'json_object' });
    // The schema must survive into the prompt, since the server no longer enforces it.
    expect(retry.messages[0].content).toContain('"confidence"');
  });

  it('sends reasoning_effort when the caller asks for it', async () => {
    const fetchMock = mockChat('Atlas-G1');
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatProvider('ollama', 'http://x/v1', 'ollama', 'qwen3.6', false);
    await provider.generateText({ prompt: 'route', reasoningEffort: 'none' });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.reasoning_effort).toBe('none');
  });

  it('omits reasoning_effort entirely when unset, and does not retry', async () => {
    const fetchMock = mockChat('Atlas-G1');
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatProvider('ollama', 'http://x/v1', 'ollama', 'qwen3.6', false);
    await provider.generateText({ prompt: 'route' });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.reasoning_effort).toBeUndefined();
    // Both variants serialize identically, so the second is skipped.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops reasoning_effort when the endpoint rejects it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'unknown param' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Atlas-G1' } }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatProvider('ollama', 'http://x/v1', 'ollama', 'qwen3.6', false);
    expect(await provider.generateText({ prompt: 'route', reasoningEffort: 'none' })).toBe(
      'Atlas-G1'
    );

    const retry = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body);
    expect(retry.reasoning_effort).toBeUndefined();
  });

  it('surfaces a 400 that carries no optional parameters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, text: async () => 'bad model' });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatProvider('ollama', 'http://x/v1', 'ollama', 'nope', false);
    // No response_format and no reasoning_effort — nothing to degrade, so this
    // must reach the caller's fallback rather than being retried.
    await expect(provider.generateText({ prompt: 'x' })).rejects.toThrow(/ollama 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates non-400 upstream failures', async () => {
    vi.stubGlobal('fetch', mockChat('', 503));
    const provider = new OpenAICompatProvider(
      'openrouter',
      'https://openrouter.ai/api/v1',
      'k',
      'm',
      false
    );
    await expect(provider.generateText({ prompt: 'x' })).rejects.toThrow(/openrouter 503/);
  });
});

describe('GeminiProvider abort handling', () => {
  it('rejects once the caller aborts, since the SDK takes no signal', async () => {
    const controller = new AbortController();
    const provider = new GeminiProvider('key', 'gemini-2.0-flash');
    // Never settles — only the signal can end this call.
    (provider as unknown as { client: unknown }).client = {
      getGenerativeModel: () => ({ generateContent: () => new Promise(() => {}) }),
    };

    const pending = provider.generateText({ prompt: 'route', signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow(/aborted/);
  });

  it('rejects immediately when handed an already-aborted signal', async () => {
    const provider = new GeminiProvider('key', 'gemini-2.0-flash');
    // Rejects only after the race is lost — the late failure must stay handled,
    // not surface as an unhandled rejection.
    (provider as unknown as { client: unknown }).client = {
      getGenerativeModel: () => ({
        generateContent: () =>
          new Promise((_resolve, rej) => setTimeout(() => rej(new Error('upstream 503')), 5)),
      }),
    };

    await expect(
      provider.generateText({ prompt: 'route', signal: AbortSignal.abort() })
    ).rejects.toThrow(/aborted/);
  });
});

describe('resolveLlmProvider', () => {
  const orchestrator = {
    role: 'text' as const,
    credentialOrder: ['openrouter' as const],
    label: 'test',
  };

  it('returns null when nothing is configured', () => {
    expect(resolveLlmProvider(orchestrator)).toBeNull();
  });

  it('uses the credential order when LLM_PROVIDER is unset', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-real';
    const p = resolveLlmProvider(orchestrator);
    expect(p?.providerName).toBe('openrouter');
    expect(p?.modelId).toBe('stepfun/step-3.5-flash:free');
  });

  it('lets LLM_PROVIDER override the credential order', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-real';
    process.env.LLM_PROVIDER = 'ollama';
    const p = resolveLlmProvider(orchestrator);
    expect(p?.providerName).toBe('ollama');
    expect(p?.modelId).toBe('qwen3.6');
  });

  it('picks the vision default model for vision roles', () => {
    process.env.LLM_PROVIDER = 'ollama';
    expect(resolveLlmProvider({ ...orchestrator, role: 'vision' })?.modelId).toBe('qwen3-vl:8b');
  });

  it('honours LLM_MODEL for text roles', () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.LLM_MODEL = 'gemma4:12b';
    expect(resolveLlmProvider(orchestrator)?.modelId).toBe('gemma4:12b');
  });

  it('ignores LLM_MODEL for vision roles, which need a model that can see', () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.LLM_MODEL = 'qwen3.6';
    expect(resolveLlmProvider({ ...orchestrator, role: 'vision' })?.modelId).toBe('qwen3-vl:8b');
  });

  it('lets a per-call-site override beat LLM_MODEL', () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.LLM_MODEL = 'gemma4:12b';
    expect(resolveLlmProvider({ ...orchestrator, modelOverride: 'qwen3.6' })?.modelId).toBe('qwen3.6');
  });

  it('honours a per-call-site model override', () => {
    process.env.LLM_PROVIDER = 'ollama';
    const p = resolveLlmProvider({ ...orchestrator, modelOverride: 'gemma4:12b' });
    expect(p?.modelId).toBe('gemma4:12b');
  });

  it('treats .env.example placeholders as unconfigured', () => {
    process.env.GOOGLE_API_KEY = 'your-api-key';
    expect(
      resolveLlmProvider({ ...orchestrator, credentialOrder: ['gemini'] })
    ).toBeNull();
  });

  it('falls back when LLM_PROVIDER names a provider with no key', () => {
    process.env.LLM_PROVIDER = 'gemini';
    expect(resolveLlmProvider(orchestrator)).toBeNull();
  });

  it('ignores an unrecognised LLM_PROVIDER value', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-real';
    process.env.LLM_PROVIDER = 'llama-cpp';
    expect(resolveLlmProvider(orchestrator)?.providerName).toBe('openrouter');
  });
});
