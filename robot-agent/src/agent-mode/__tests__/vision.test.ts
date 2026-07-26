/**
 * @file vision.test.ts
 * @description Defensive parsing of the VLM answer (a malformed answer degrades,
 *              never throws) and the data-URL/media prompt shape sent to the
 *              vision model.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { VisionClient, parseVisionAnswer } from '../vision.js';
import type { GenerateRequest, GenerateResponse } from '../llm.js';

describe('parseVisionAnswer', () => {
  it('parses a well-formed answer', () => {
    const observation = parseVisionAnswer(
      JSON.stringify({
        currentView: 'a table with a hat',
        personVisible: false,
        entities: [
          { label: 'table', bearingDeg: -15, distanceEstM: 2.5, confidence: 0.9 },
          { label: 'hat', bearingDeg: -12, distanceEstM: 2.4, confidence: 0.7, note: 'liegt darauf' },
        ],
      })
    );

    expect(observation.degraded).toBe(false);
    expect(observation.currentView).toBe('a table with a hat');
    expect(observation.entities).toEqual([
      { label: 'table', bearingDeg: -15, distanceEstM: 2.5, confidence: 0.9 },
      { label: 'hat', bearingDeg: -12, distanceEstM: 2.4, confidence: 0.7, note: 'liegt darauf' },
    ]);
  });

  it('extracts JSON out of a fenced, chatty answer', () => {
    const observation = parseVisionAnswer(
      'Of course!\n```json\n{"currentView":"leer","entities":[],"personVisible":false}\n```'
    );

    expect(observation.degraded).toBe(false);
    expect(observation.currentView).toBe('leer');
  });

  it('degrades to the raw text instead of throwing on unparseable output', () => {
    const observation = parseVisionAnswer('I see a room with some furniture in it.');

    expect(observation.degraded).toBe(true);
    expect(observation.entities).toEqual([]);
    expect(observation.personVisible).toBe(false);
    expect(observation.currentView).toBe('I see a room with some furniture in it.');
  });

  it('degrades on an empty answer without pretending to see anything', () => {
    const observation = parseVisionAnswer('');

    expect(observation.degraded).toBe(true);
    expect(observation.entities).toEqual([]);
    expect(observation.currentView).toMatch(/returned nothing/);
  });

  it('clamps nonsense bearings, distances and confidences', () => {
    const observation = parseVisionAnswer(
      JSON.stringify({
        currentView: 'x',
        entities: [{ label: 'table', bearingDeg: 5000, distanceEstM: 9999, confidence: 42 }],
      })
    );

    expect(observation.entities[0]).toEqual({
      label: 'table',
      bearingDeg: 90,
      distanceEstM: 50,
      confidence: 1,
    });
  });

  it('keeps a null distance null rather than substituting a number', () => {
    const observation = parseVisionAnswer(
      JSON.stringify({ currentView: 'x', entities: [{ label: 'table', distanceEstM: null }] })
    );

    expect(observation.entities[0].distanceEstM).toBeNull();
  });

  it('infers personVisible from a person entity when the flag is missing', () => {
    const observation = parseVisionAnswer(
      JSON.stringify({ currentView: 'x', entities: [{ label: 'person', bearingDeg: 0 }] })
    );

    expect(observation.personVisible).toBe(true);
  });

  it('drops unlabeled entities and caps the list at 8', () => {
    const observation = parseVisionAnswer(
      JSON.stringify({
        currentView: 'x',
        entities: [
          { label: '  ' },
          'not an object',
          ...Array.from({ length: 12 }, (_, i) => ({ label: `Ding${i}` })),
        ],
      })
    );

    expect(observation.entities).toHaveLength(8);
    expect(observation.entities[0].label).toBe('Ding0');
  });
});

describe('VisionClient', () => {
  function makeClient(response: Partial<GenerateResponse> | Error, b64 = 'QUJD') {
    const requests: GenerateRequest[] = [];
    const generate = vi.fn(async (req: GenerateRequest): Promise<GenerateResponse> => {
      requests.push(req);
      if (response instanceof Error) throw response;
      return { text: response.text ?? '', output: response.output ?? null };
    });
    const client = new VisionClient({
      snapshot: async () => b64,
      generate,
      modelRef: 'test-ollama/gemma3:4b',
      cameraName: 'head_camera',
    });
    return { client, requests, generate };
  }

  it('sends the frame as a base64 JPEG data URL alongside the prompt', async () => {
    const { client, requests } = makeClient({
      text: JSON.stringify({ currentView: 'leer', entities: [], personVisible: false }),
    });

    await client.observe();

    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe('test-ollama/gemma3:4b');
    expect(requests[0].prompt[0]).toEqual({
      media: { url: 'data:image/jpeg;base64,QUJD', contentType: 'image/jpeg' },
    });
    expect(requests[0].prompt[1]).toHaveProperty('text');
  });

  it('propagates a camera failure — a `look` must fail, not invent a scene', async () => {
    const client = new VisionClient({
      snapshot: async () => {
        throw new Error('Sidecar snapshot head_camera failed: HTTP 503');
      },
      generate: async () => ({ text: '', output: null }),
      modelRef: 'test-ollama/gemma3:4b',
    });

    await expect(client.observe()).rejects.toThrow(/HTTP 503/);
  });

  it('degrades — but does not throw — when the vision model itself is down', async () => {
    const { client } = makeClient(new Error('ECONNREFUSED 127.0.0.1:11434'));

    const observation = await client.observe();

    expect(observation.degraded).toBe(true);
    expect(observation.entities).toEqual([]);
    expect(observation.currentView).toMatch(/Vision model unavailable/);
    expect(observation.currentView).toMatch(/ECONNREFUSED/);
  });
});
