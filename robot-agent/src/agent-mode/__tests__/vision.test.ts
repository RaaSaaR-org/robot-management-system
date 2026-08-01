/**
 * @file vision.test.ts
 * @description Defensive parsing of the VLM answer (a malformed answer degrades,
 *              never throws) and the data-URL/media prompt shape sent to the
 *              vision model.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { VisionClient, parseVisionAnswer, bearingFromImageX } from '../vision.js';
import type { GenerateRequest, GenerateResponse } from '../llm.js';

/** The sim `head_camera`: fovy 89 at 4:3. */
const HFOV = 105.3;

describe('bearingFromImageX', () => {
  it('puts the image centre dead ahead', () => {
    expect(bearingFromImageX(0.5, HFOV)).toBeCloseTo(0, 6);
  });

  it('maps the edges to ±hfov/2 — left edge is the robot LEFT, i.e. positive', () => {
    expect(bearingFromImageX(0, HFOV)).toBeCloseTo(HFOV / 2, 3);
    expect(bearingFromImageX(1, HFOV)).toBeCloseTo(-HFOV / 2, 3);
  });

  it('is a projection, not a linear ramp — a quarter across is not a quarter of the FOV', () => {
    // tan(b) = -0.5·tan(52.65°) → 33.2°, where linear would say 26.3°. The
    // difference is 7° at a metre or two, which is the whole point of doing
    // the arithmetic instead of asking the model for the angle.
    expect(bearingFromImageX(0.25, HFOV)).toBeCloseTo(33.2, 1);
  });

  it('clamps a fraction outside the frame instead of inventing a wider camera', () => {
    expect(bearingFromImageX(-3, HFOV)).toBeCloseTo(HFOV / 2, 3);
    expect(bearingFromImageX(9, HFOV)).toBeCloseTo(-HFOV / 2, 3);
  });
});

describe('parseVisionAnswer', () => {
  it('parses a well-formed answer, converting image x to a bearing', () => {
    const observation = parseVisionAnswer(
      JSON.stringify({
        currentView: 'a table with a hat',
        personVisible: false,
        entities: [
          { label: 'table', x: 0.75, distanceEstM: 2.5, confidence: 0.9 },
          { label: 'hat', x: 0.5, distanceEstM: 2.4, confidence: 0.7, note: 'liegt darauf' },
        ],
      }),
      HFOV
    );

    expect(observation.degraded).toBe(false);
    expect(observation.currentView).toBe('a table with a hat');
    expect(observation.entities).toEqual([
      // Right of centre → negative, and by the projection, not 0.25·105.3.
      // `imageX` is the model's own answer, kept alongside the bearing derived
      // from it: the derivation is one-way, and a depth image is indexed by
      // pixels, not by bearings.
      { label: 'table', bearingDeg: -33.2, imageX: 0.75, distanceEstM: 2.5, confidence: 0.9 },
      {
        label: 'hat',
        bearingDeg: 0,
        imageX: 0.5,
        distanceEstM: 2.4,
        confidence: 0.7,
        note: 'liegt darauf',
      },
    ]);
  });

  it('keeps no imageX at all when the model answered a bearing instead of a position', () => {
    // Absent, not 0.5: a fabricated "dead centre" would read as an answer the
    // model never gave, and it is the one field a depth association would trust.
    const observation = parseVisionAnswer(
      JSON.stringify({ currentView: 'x', entities: [{ label: 'table', bearingDeg: -15 }] }),
      HFOV
    );

    expect(observation.entities[0]).not.toHaveProperty('imageX');
  });

  it('scales the bearing with the camera FOV, not with the number alone', () => {
    const answer = JSON.stringify({ currentView: 'x', entities: [{ label: 'table', x: 0.25 }] });

    // Same frame position, narrower lens → the object really is closer to ahead.
    expect(parseVisionAnswer(answer, 105.3).entities[0].bearingDeg).toBeCloseTo(33.2, 1);
    expect(parseVisionAnswer(answer, 69).entities[0].bearingDeg).toBeCloseTo(19.0, 1);
  });

  it('still accepts a bearingDeg answer from a model that ignored the schema', () => {
    const observation = parseVisionAnswer(
      JSON.stringify({ currentView: 'x', entities: [{ label: 'table', bearingDeg: -15 }] }),
      HFOV
    );

    expect(observation.entities[0].bearingDeg).toBe(-15);
  });

  it('prefers x over bearingDeg when a model sends both', () => {
    const observation = parseVisionAnswer(
      JSON.stringify({ currentView: 'x', entities: [{ label: 'table', x: 0.5, bearingDeg: 47 }] }),
      HFOV
    );

    expect(observation.entities[0].bearingDeg).toBe(0);
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
      }),
      HFOV
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
