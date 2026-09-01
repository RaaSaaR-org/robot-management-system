/**
 * @file llm.test.ts
 * @description The request Agent Mode builds — the fields that only look right
 *              until you watch the wire: a suppressed thinking pass (which
 *              leaves the OpenAI-compatible path entirely), a temperature of
 *              zero, and an empty answer that must read as "no answer".
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildGenerateConfig,
  buildNativeChatBody,
  nativeOllamaChatUrl,
  nativeThinkOffCall,
  ollamaNativeGenerate,
  toNativeChatMessage,
  type GenerateRequest,
} from '../llm.js';

const prompt = [{ text: 'anything' }];

const URLS = {
  ollamaBaseUrl: 'http://localhost:11434/v1',
  agentOllamaBaseUrl: 'http://agent-host:11434/v1',
};

describe('buildGenerateConfig', () => {
  it('still asks /v1 for no thinking — the requests that stay there need it', () => {
    // Ollama + thinking:false no longer reaches this config (it is rerouted to
    // the native endpoint), but a non-Ollama provider and a remote-URL image
    // still do, and reasoning_effort is the only knob those have.
    const config = buildGenerateConfig({ model: 'googleai/g', prompt, thinking: false });
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

describe('nativeOllamaChatUrl', () => {
  it('derives the native endpoint from the configured /v1 base URL', () => {
    // One knob, two front doors onto the same server — no second env var.
    expect(nativeOllamaChatUrl('http://localhost:11434/v1')).toBe(
      'http://localhost:11434/api/chat'
    );
    expect(nativeOllamaChatUrl('http://localhost:11434/v1/')).toBe(
      'http://localhost:11434/api/chat'
    );
  });

  it('copes with a base URL that never had the /v1 config warns about', () => {
    expect(nativeOllamaChatUrl('http://gpu-box:11434')).toBe('http://gpu-box:11434/api/chat');
  });
});

describe('nativeThinkOffCall', () => {
  it('routes an Ollama request with thinking off to the native endpoint', () => {
    expect(nativeThinkOffCall({ model: 'ollama/gemma4:12b', prompt, thinking: false }, URLS)).toEqual(
      { url: 'http://localhost:11434/api/chat', model: 'gemma4:12b' }
    );
  });

  it('honours the separate Agent Mode host behind the agentollama prefix', () => {
    expect(
      nativeThinkOffCall({ model: 'agentollama/gemma4:12b', prompt, thinking: false }, URLS)
    ).toEqual({ url: 'http://agent-host:11434/api/chat', model: 'gemma4:12b' });
  });

  it('leaves the request on /v1 when thinking is on or unspecified', () => {
    expect(nativeThinkOffCall({ model: 'ollama/m', prompt, thinking: true }, URLS)).toBeNull();
    expect(nativeThinkOffCall({ model: 'ollama/m', prompt }, URLS)).toBeNull();
  });

  it('never reroutes another provider, whatever its thinking flag says', () => {
    expect(nativeThinkOffCall({ model: 'googleai/gemini-2.5-flash', prompt, thinking: false }, URLS)).toBeNull();
    expect(nativeThinkOffCall({ model: 'openrouter/x:free', prompt, thinking: false }, URLS)).toBeNull();
    expect(nativeThinkOffCall({ model: 'bare-model-ref', prompt, thinking: false }, URLS)).toBeNull();
  });

  it('takes a base64 frame — that is what the native endpoint wants', () => {
    const vision: GenerateRequest = {
      model: 'ollama/qwen3-vl:8b',
      prompt: [
        { media: { url: 'data:image/jpeg;base64,AAAA', contentType: 'image/jpeg' } },
        { text: 'what do you see' },
      ],
      thinking: false,
    };
    expect(nativeThinkOffCall(vision, URLS)).not.toBeNull();
  });

  it('keeps a remote-URL image on /v1, which is the only path that can fetch it', () => {
    const remote: GenerateRequest = {
      model: 'ollama/qwen3-vl:8b',
      prompt: [{ media: { url: 'https://example.test/frame.jpg' } }, { text: 'what do you see' }],
      thinking: false,
    };
    expect(nativeThinkOffCall(remote, URLS)).toBeNull();
  });
});

describe('toNativeChatMessage', () => {
  it('sends images as bare base64 alongside the text', () => {
    const message = toNativeChatMessage([
      { media: { url: 'data:image/jpeg;base64,QUJD', contentType: 'image/jpeg' } },
      { text: 'describe it' },
    ]);
    expect(message).toEqual({ role: 'user', content: 'describe it', images: ['QUJD'] });
  });

  it('omits `images` entirely for a text-only prompt', () => {
    expect(toNativeChatMessage([{ text: 'a' }, { text: 'b' }])).toEqual({
      role: 'user',
      content: 'a\n\nb',
    });
  });
});

describe('buildNativeChatBody', () => {
  it('asks Ollama for no thinking, in its own field', () => {
    const body = buildNativeChatBody({ model: 'ollama/m', prompt, thinking: false }, 'm');
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('m');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect((body.options as { temperature: number }).temperature).toBeLessThan(0.01);
    expect((body.options as { temperature: number }).temperature).toBeTruthy();
  });

  it('carries the schema as `format` — without it constrained decoding is off', () => {
    const schema = { type: 'object' };
    expect(buildNativeChatBody({ model: 'ollama/m', prompt, thinking: false }, 'm', schema).format).toBe(
      schema
    );
    expect(buildNativeChatBody({ model: 'ollama/m', prompt, thinking: false }, 'm')).not.toHaveProperty(
      'format'
    );
  });
});

/** A fetch double that answers one native /api/chat body. */
function stubFetch(answer: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: async () => answer,
    text: async () => JSON.stringify(answer),
  })) as unknown as typeof fetch;
}

describe('ollamaNativeGenerate', () => {
  const call = { url: 'http://localhost:11434/api/chat', model: 'gemma4:12b' };
  const req: GenerateRequest = { model: 'ollama/gemma4:12b', prompt, thinking: false };

  it('POSTs think:false to the native endpoint and returns the answer', async () => {
    const fetchImpl = stubFetch({ message: { content: '{"blocks":[]}', thinking: '' } });
    const res = await ollamaNativeGenerate(req, call, undefined, fetchImpl);

    expect(res).toEqual({ text: '{"blocks":[]}', output: null });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(init.body).think).toBe(false);
  });

  it('forwards the abort signal, so a wedged model does not keep the socket', async () => {
    const fetchImpl = stubFetch({ message: { content: 'ok' } });
    const signal = new AbortController().signal;
    await ollamaNativeGenerate({ ...req, signal }, call, undefined, fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.signal).toBe(signal);
  });

  it('surfaces an empty answer as "no answer", never as a valid empty plan', async () => {
    // This is the whole failure this path exists to make legible: a model that
    // spends its budget thinking returns content "". Returning { text: '' }
    // would reach the planner's validator and be reported as an INVALID plan;
    // throwing is what makes it "(no answer — the model call failed)".
    const fetchImpl = stubFetch({ message: { content: '', thinking: 'x'.repeat(8414) } });
    await expect(ollamaNativeGenerate(req, call, undefined, fetchImpl)).rejects.toThrow(
      /returned no content/
    );
  });

  it('treats whitespace-only content the same way', async () => {
    const fetchImpl = stubFetch({ message: { content: '   \n' } });
    await expect(ollamaNativeGenerate(req, call, undefined, fetchImpl)).rejects.toThrow(
      /returned no content/
    );
  });

  it('throws on a transport failure rather than inventing an answer', async () => {
    const fetchImpl = stubFetch({ error: 'model not found' }, false, 404);
    await expect(ollamaNativeGenerate(req, call, undefined, fetchImpl)).rejects.toThrow(/404/);
  });
});

/* -------------------------------------------------------------------------- */

const genkitMock = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('../../agent/genkit.js', () => ({
  ai: { generate: genkitMock.generate },
  AGENT_OLLAMA_PREFIX: 'ollama',
}));

vi.mock('../../config/config.js', () => ({
  config: {
    ollamaBaseUrl: 'http://localhost:11434/v1',
    agentMode: { ollamaBaseUrl: 'http://localhost:11434/v1' },
  },
}));

describe('genkitGenerate — which transport a request takes', () => {
  beforeEach(() => {
    genkitMock.generate.mockReset();
    genkitMock.generate.mockResolvedValue({ text: 'from genkit', output: { ok: true } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends an Ollama thinking:false call to /api/chat, not through Genkit', async () => {
    const fetchImpl = stubFetch({ message: { content: 'from ollama' } });
    vi.stubGlobal('fetch', fetchImpl);
    const { genkitGenerate } = await import('../llm.js');

    const res = await genkitGenerate({ model: 'ollama/gemma4:12b', prompt, thinking: false });

    expect(res).toEqual({ text: 'from ollama', output: null });
    expect(genkitMock.generate).not.toHaveBeenCalled();
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init.body);
    expect(body.think).toBe(false);
    expect(body.model).toBe('gemma4:12b');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('leaves an Ollama call with thinking ON on the Genkit path', async () => {
    const fetchImpl = stubFetch({ message: { content: 'from ollama' } });
    vi.stubGlobal('fetch', fetchImpl);
    const { genkitGenerate } = await import('../llm.js');

    const res = await genkitGenerate({ model: 'ollama/gemma4:12b', prompt, thinking: true });

    expect(res).toEqual({ text: 'from genkit', output: { ok: true } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(genkitMock.generate).toHaveBeenCalledTimes(1);
  });

  it('leaves another provider alone even with thinking off', async () => {
    const fetchImpl = stubFetch({ message: { content: 'from ollama' } });
    vi.stubGlobal('fetch', fetchImpl);
    const { genkitGenerate } = await import('../llm.js');

    await genkitGenerate({ model: 'googleai/gemini-2.5-flash', prompt, thinking: false });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(genkitMock.generate).toHaveBeenCalledTimes(1);
    // …and it still carries the OpenAI-side knob, which is all that path has.
    expect(genkitMock.generate.mock.calls[0][0].config.reasoning_effort).toBe('none');
  });

  it('rejects when the native answer is empty, so the caller reports no answer', async () => {
    vi.stubGlobal('fetch', stubFetch({ message: { content: '', thinking: 'still thinking' } }));
    const { genkitGenerate } = await import('../llm.js');

    await expect(
      genkitGenerate({ model: 'ollama/gemma4:12b', prompt, thinking: false })
    ).rejects.toThrow(/returned no content/);
  });
});
