/**
 * @file liveSessionDemoHandlers.ts
 * @description MSW handlers for the headset's live-session entry (TASK-412):
 *              sessions created in this page load are listed by robot and
 *              status, and served by id, so `/data-collection/live?robot=<id>`
 *              can be shown waiting and then following a session that appears.
 *              Unknown ids fall through to the other demo handlers. State is
 *              in memory per page load.
 * @feature mocks
 */

import { http, HttpResponse } from 'msw';
import type { TeleoperationSession, TeleoperationStatus } from '@/features/datacollection/types/datacollection.types';

const created = new Map<string, TeleoperationSession>();

/** Test hook: forget every created session. */
export function resetLiveSessionDemo(): void {
  created.clear();
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

export const liveSessionDemoHandlers = [
  http.get('/api/teleoperation/sessions', ({ request }) => {
    const q = new URL(request.url).searchParams;
    const robotId = q.get('robotId');
    const statuses = (q.get('status') ?? '').split(',').filter(Boolean) as TeleoperationStatus[];
    const sessions = [...created.values()]
      .filter((s) => (!robotId || s.robotId === robotId) && (statuses.length === 0 || statuses.includes(s.status)))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return HttpResponse.json({
      sessions,
      pagination: { page: 1, limit: 20, total: sessions.length, totalPages: sessions.length ? 1 : 0 },
    });
  }),

  http.post('/api/teleoperation/sessions', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Partial<TeleoperationSession>;
    if (typeof body.robotId !== 'string' || !body.robotId) {
      return HttpResponse.json({ error: 'robotId is required' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const session = {
      id: newId(),
      operatorId: body.operatorId ?? 'demo-user',
      robotId: body.robotId,
      type: body.type ?? 'vr_quest',
      status: 'created',
      startedAt: null,
      endedAt: null,
      frameCount: 0,
      duration: null,
      fps: body.fps ?? 30,
      languageInstr: body.languageInstr ?? null,
      qualityScore: null,
      exportedDatasetId: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    } as TeleoperationSession;
    created.set(session.id, session);
    return HttpResponse.json({ session, message: 'Teleoperation session created successfully' }, { status: 201 });
  }),

  // Only the sessions made here; any other id falls through (undefined).
  http.get('/api/teleoperation/sessions/:id', ({ params }) => {
    const session = created.get(String(params.id));
    return session ? HttpResponse.json({ session }) : undefined;
  }),
];
