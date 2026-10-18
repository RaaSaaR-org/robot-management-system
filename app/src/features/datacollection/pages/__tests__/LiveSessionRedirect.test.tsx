/**
 * @file LiveSessionRedirect.test.tsx
 * @description `/data-collection/live?robot=<id>` (TASK-412, TASK-416) against
 *              MSW: `liveCandidates` drops READY sessions older than 4 h; the
 *              page replaces itself with the single candidate, lists several
 *              instead of guessing, names a stale one it ignores, waits
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
import { LIVE_CREATED_MAX_AGE_MS, LiveSessionRedirect, createdAgo, liveCandidates } from '../LiveSessionRedirect';
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

const NOW = Date.parse('2026-10-18T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe('liveCandidates', () => {
  it('ignores a 2-day-old created session', () => {
    const r = liveCandidates([session('appely', ROBOT, 'created', ago(2 * DAY))], ROBOT, NOW);
    expect(r.candidates).toEqual([]);
    expect(r.ignored.map((s) => s.id)).toEqual(['appely']);
  });

  it('keeps a 2-day-old recording (and paused) session', () => {
    const r = liveCandidates(
      [session('rec', ROBOT, 'recording', ago(2 * DAY)), session('pau', 'sim-1', 'paused', ago(2 * DAY))],
      ROBOT,
      NOW,
    );
    expect(r.candidates.map((s) => s.id)).toEqual(['rec']);
    expect(r.ignored).toEqual([]);
  });

  it('returns two fresh candidates newest first, so the page lists them', () => {
    const r = liveCandidates(
      [
        session('older', ROBOT, 'paused', ago(30 * MIN)),
        session('newer', ROBOT, 'created', ago(5 * MIN)),
        session('stale', ROBOT, 'created', ago(LIVE_CREATED_MAX_AGE_MS + MIN)),
      ],
      ROBOT,
      NOW,
    );
    expect(r.candidates.map((s) => s.id)).toEqual(['newer', 'older']);
    expect(r.ignored.map((s) => s.id)).toEqual(['stale']);
  });

  it('returns exactly one candidate when only one counts, so the page redirects', () => {
    const r = liveCandidates(
      [
        session('one', ROBOT, 'created', ago(LIVE_CREATED_MAX_AGE_MS - MIN)),
        session('done', ROBOT, 'completed', ago(MIN)),
        session('other', 'sim-1', 'created', ago(MIN)),
      ],
      ROBOT,
      NOW,
    );
    expect(r.candidates.map((s) => s.id)).toEqual(['one']);
  });
});

describe('createdAgo', () => {
  it('spells the age out the way the headset reads it', () => {
    const at = (ms: number) => createdAgo(session('x', ROBOT, 'created', ago(ms)), NOW);
    expect(at(20_000)).toBe('created just now');
    expect(at(12 * MIN)).toBe('created 12 min ago');
    expect(at(60 * MIN)).toBe('created 1 hour ago');
    expect(at(5 * 60 * MIN)).toBe('created 5 hours ago');
    expect(at(DAY)).toBe('created 1 day ago');
    expect(at(2 * DAY)).toBe('created 2 days ago');
    expect(at(9 * DAY)).toMatch(/^created \S/);
    expect(at(9 * DAY)).not.toContain('ago');
    expect(createdAgo(session('x', ROBOT, 'created', 'not a date'), NOW)).toBe('created at an unknown time');
  });
});

describe('LiveSessionRedirect', () => {
  it('replaces itself with the single live session and asks only for live statuses', async () => {
    const asked: URLSearchParams[] = [];
    server.use(
      http.get('/api/teleoperation/sessions', ({ request }) => {
        asked.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          sessions: [
            session('s-stale', ROBOT, 'created', new Date(Date.now() - 2 * DAY).toISOString()),
            session('s-new', ROBOT, 'created', new Date(Date.now() - 2 * MIN).toISOString()),
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

  it('lists several live sessions instead of guessing, and opens the one tapped', async () => {
    server.use(
      http.get('/api/teleoperation/sessions', () =>
        HttpResponse.json({
          sessions: [
            { ...session('s-a', ROBOT, 'recording', new Date(Date.now() - 40 * MIN).toISOString()), languageInstr: 'pick the apple' },
            { ...session('s-b', ROBOT, 'created', new Date(Date.now() - 12 * MIN).toISOString()), languageInstr: 'stack cups' },
          ],
          pagination: {},
        }),
      ),
    );
    renderAt(`/data-collection/live?robot=${ROBOT}`);
    await waitFor(() => expect(screen.getByTestId('live-session-status')).toHaveAttribute('data-state', 'choose'));
    const choices = screen.getAllByTestId('live-session-choice');
    expect(choices.map((c) => c.getAttribute('data-session-id'))).toEqual(['s-b', 's-a']);
    expect(choices[0]).toHaveTextContent('Stack cups');
    expect(choices[0]).toHaveTextContent('created 12 min ago');
    // It keeps polling while the list is up, and never jumps on its own.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(screen.queryByTestId('where')).toBeNull();
    await act(async () => {
      choices[1].click();
    });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/data-collection/s-a'));
  });

  it('waits past a stale READY session and names it', async () => {
    server.use(
      http.get('/api/teleoperation/sessions', () =>
        HttpResponse.json({
          sessions: [{ ...session('appely', ROBOT, 'created', new Date(Date.now() - 2 * DAY).toISOString()), languageInstr: 'Appely' }],
          pagination: {},
        }),
      ),
    );
    renderAt(`/data-collection/live?robot=${ROBOT}`);
    await waitFor(() =>
      expect(screen.getByTestId('live-session-ignored')).toHaveTextContent(
        "Ignoring ‘Appely’ (created 2 days ago, never started). End it on the desktop if it is not needed.",
      ),
    );
    expect(screen.queryByTestId('where')).toBeNull();
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
