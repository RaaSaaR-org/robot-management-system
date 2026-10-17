/**
 * @file LiveSessionRedirect.test.tsx
 * @description `/data-collection/live?robot=<id>` (TASK-412) against MSW: it
 *              replaces itself with the robot's newest live session, waits
 *              ("No live session for <robot>. Waiting…") and follows a session
 *              created after it opened, ignores other robots' and finished
 *              sessions, and keeps trying after a failed read.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { resetLiveSessionDemo } from '@/mocks/liveSessionDemoHandlers';
import { LiveSessionRedirect, newestLiveSession } from '../LiveSessionRedirect';
import type { TeleoperationSession } from '../../types/datacollection.types';

const ROBOT = 'g1-edu-4';

function session(id: string, robotId: string, status: TeleoperationSession['status'], createdAt: string): TeleoperationSession {
  return {
    id, operatorId: 'u', robotId, type: 'vr_quest', status, startedAt: null, endedAt: null, frameCount: 0,
    duration: null, fps: 30, languageInstr: null, qualityScore: null, exportedDatasetId: null, errorMessage: null,
    createdAt, updatedAt: createdAt,
  };
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={['/data-collection', url]} initialIndex={1}>
      <Routes>
        <Route path="/data-collection/live" element={<LiveSessionRedirect pollMs={50} />} />
        <Route path="/data-collection/:sessionId" element={<Where />} />
        <Route path="/data-collection" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetLiveSessionDemo();
});

describe('newestLiveSession', () => {
  it('takes the newest created/recording/paused session of that robot only', () => {
    const list = [
      session('old', ROBOT, 'recording', '2026-10-18T08:00:00Z'),
      session('done', ROBOT, 'completed', '2026-10-18T11:00:00Z'),
      session('other', 'sim-1', 'created', '2026-10-18T12:00:00Z'),
      session('new', ROBOT, 'created', '2026-10-18T10:00:00Z'),
    ];
    expect(newestLiveSession(list, ROBOT)?.id).toBe('new');
    expect(newestLiveSession(list.slice(1, 3), ROBOT)).toBeNull();
  });
});

describe('LiveSessionRedirect', () => {
  it('replaces itself with the newest live session and asks only for live statuses', async () => {
    const asked: URLSearchParams[] = [];
    server.use(
      http.get('/api/teleoperation/sessions', ({ request }) => {
        asked.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          sessions: [
            session('s-old', ROBOT, 'recording', '2026-10-18T08:00:00Z'),
            session('s-new', ROBOT, 'created', '2026-10-18T09:00:00Z'),
          ],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
        });
      }),
    );
    renderAt(`/data-collection/live?robot=${ROBOT}`);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/data-collection/s-new'));
    expect(asked[0].get('robotId')).toBe(ROBOT);
    expect(asked[0].get('status')).toBe('created,recording,paused');
  });

  it('waits, then follows a session created after it opened (MSW demo handlers)', async () => {
    renderAt(`/data-collection/live?robot=${ROBOT}`);
    await waitFor(() => expect(screen.getByTestId('live-session-status')).toHaveTextContent(`No live session for ${ROBOT}. Waiting…`));
    // Another robot's session does not count.
    await act(async () => {
      await fetch('/api/teleoperation/sessions', { method: 'POST', body: JSON.stringify({ robotId: 'sim-1' }), headers: { 'Content-Type': 'application/json' } });
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(screen.queryByTestId('where')).toBeNull();

    let made = { id: '' } as TeleoperationSession;
    await act(async () => {
      const res = await fetch('/api/teleoperation/sessions', {
        method: 'POST',
        body: JSON.stringify({ robotId: ROBOT }),
        headers: { 'Content-Type': 'application/json' },
      });
      made = ((await res.json()) as { session: TeleoperationSession }).session;
    });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/data-collection/${made.id}`));
  });

  it('keeps trying after a failed read', async () => {
    let calls = 0;
    server.use(
      http.get('/api/teleoperation/sessions', () => {
        calls++;
        if (calls === 1) return HttpResponse.json({ error: 'boom' }, { status: 500 });
        return HttpResponse.json({ sessions: [session('s1', ROBOT, 'recording', '2026-10-18T09:00:00Z')], pagination: {} });
      }),
    );
    renderAt(`/data-collection/live?robot=${ROBOT}`);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/data-collection/s1'));
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('says how to call it without ?robot=', () => {
    renderAt('/data-collection/live');
    expect(screen.getByTestId('live-session-status')).toHaveAttribute('data-state', 'no-robot');
  });
});
