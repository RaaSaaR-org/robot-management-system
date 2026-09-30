/**
 * @file voice-packs-routes.test.ts
 * @description The voice-pack surface of the voice proxy routes (TASK-229)
 * @feature voice
 *
 * The proxy talks to a real HTTP server standing in for the Python voice
 * service, so what is asserted is what actually crosses the wire: the pack
 * list is relayed rather than re-declared, `voice` is forwarded next to an
 * unchanged `language`, and an unknown or unloaded voice is a 4xx that never
 * reaches (or is never answered by) the default pack.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';

vi.mock('../../services/RobotManager.js', () => ({
  robotManager: {
    getRegisteredRobot: vi.fn(async (id: string) =>
      id === 'g1' ? { id: 'g1', baseUrl: 'http://127.0.0.1:41244' } : undefined
    ),
  },
}));

import { voiceRoutes } from '../voice.routes.js';

const VOICES = {
  active: 'piper_de',
  available: true,
  reason: null,
  voices: [
    {
      id: 'piper_de', label: 'Piper Thorsten (DE)', engine: 'piper', languages: ['de'],
      licence: 'GPL-3.0 (piper-tts)', commercial: false, realtime: true, available: true, reason: null,
    },
    {
      id: 'saar', label: 'Saarländisch (F5 finetune)', engine: 'saar', languages: ['de'],
      licence: 'CC-BY-NC-4.0 (F5-TTS-German base weights)', commercial: false, realtime: false,
      available: false, reason: 'RuntimeError: VOICE_SAAR_SPACE is not set',
    },
  ],
};

/** What the fake voice service received on POST /say. */
const saidBodies: Array<Record<string, unknown>> = [];
let upstream: http.Server;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/robots', voiceRoutes);
  return a;
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/voices') return send(200, VOICES);
    if (req.method === 'POST' && req.url === '/say') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        saidBodies.push(body);
        // Mirrors http_api.py: a declared but unloaded pack is 409 with a reason.
        if (body.voice === 'saar') {
          return send(409, { error: "voice pack 'saar' is not loaded: RuntimeError: VOICE_SAAR_SPACE is not set" });
        }
        send(202, { accepted: true, text: body.text, voice: body.voice ?? VOICES.active });
      });
      return;
    }
    send(404, { error: 'unknown path' });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const { port } = upstream.address() as AddressInfo;
  process.env.VOICE_SERVICE_URL = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  delete process.env.VOICE_SERVICE_URL;
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

beforeEach(() => {
  saidBodies.length = 0;
});

describe('GET /:id/voice/voices', () => {
  it('relays the voice service pack list unchanged', async () => {
    const res = await request(app()).get('/api/robots/g1/voice/voices');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(VOICES);
  });

  it('is 404 for an unknown robot', async () => {
    const res = await request(app()).get('/api/robots/nope/voice/voices');
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/voice/say', () => {
  it('forwards the voice next to the language', async () => {
    const res = await request(app())
      .post('/api/robots/g1/voice/say')
      .send({ text: 'Hallo', language: 'en', voice: 'piper_de' });
    expect(res.status).toBe(202);
    expect(saidBodies).toEqual([{ text: 'Hallo', language: 'en', voice: 'piper_de' }]);
    expect(res.body.voice).toBe('piper_de');
  });

  it('still works without a voice, and sends none', async () => {
    const res = await request(app()).post('/api/robots/g1/voice/say').send({ text: 'Hallo', language: 'de' });
    expect(res.status).toBe(202);
    expect(saidBodies).toEqual([{ text: 'Hallo', language: 'de' }]);
  });

  it('rejects saar as a language — it is a voice', async () => {
    const res = await request(app()).post('/api/robots/g1/voice/say').send({ text: 'Hallo', language: 'saar' });
    expect(res.status).toBe(400);
    expect(saidBodies).toEqual([]);
  });

  it('is 404 for a voice the robot does not declare, and nothing is spoken', async () => {
    const res = await request(app())
      .post('/api/robots/g1/voice/say')
      .send({ text: 'Hallo', voice: 'does-not-exist' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('does-not-exist');
    // The list comes from the robot, not from a union kept in this file.
    expect(res.body.voices).toEqual(['piper_de', 'saar']);
    expect(saidBodies).toEqual([]);
  });

  it("passes a declared-but-unloaded voice's 409 through with its reason", async () => {
    const res = await request(app()).post('/api/robots/g1/voice/say').send({ text: 'Hallo', voice: 'saar' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("voice pack 'saar' is not loaded: RuntimeError: VOICE_SAAR_SPACE is not set");
  });

  it('rejects a voice that is not an id', async () => {
    for (const voice of [42, '', 'a b', 'x'.repeat(65)]) {
      const res = await request(app()).post('/api/robots/g1/voice/say').send({ text: 'Hallo', voice });
      expect(res.status).toBe(400);
    }
    expect(saidBodies).toEqual([]);
  });
});
