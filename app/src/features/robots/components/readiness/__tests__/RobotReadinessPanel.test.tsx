/**
 * @file RobotReadinessPanel.test.tsx
 * @description The robot readiness panel (TASK-411) against MSW: each reason
 *              line and the row it highlights, Start always read-only, the
 *              lease-gated arm switch behind its dialog, Stop's Limp first that
 *              waits for the MEASURED limp, Adopt/Leave with nothing
 *              destructive, the variants, and the logs drawer.
 * @feature robots
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { READINESS_FIXTURES, readinessFor, type ReadinessFixtureName } from '@/mocks/readinessDemoHandlers';
import { useReadinessStore } from '../../../store/readinessStore';
import { RobotReadinessPanel } from '../RobotReadinessPanel';
import { BringupLogsDrawer } from '../BringupLogsDrawer';
import type { RobotReadiness } from '../../../api/readinessApi';

const ROBOT = 'r1';
const BOUND = { enabled: true, state: 'bound', grant: () => ({ leaseId: 'lease-secret', generation: 7 }) };
const UNBOUND = { enabled: true, state: 'idle', grant: () => null };

function serve(snapshot: RobotReadiness) {
  server.use(http.get(`/api/robots/${ROBOT}/readiness`, () => HttpResponse.json(snapshot)));
}

beforeEach(() => {
  useReadinessStore.getState().reset();
});

/** reason fixture → the row it must highlight */
const CASES: Array<[ReadinessFixtureName, string]> = [
  ['bringup_stopped', 'link'],
  ['bringup_failed:link', 'link'],
  ['bringup_foreign:bridge', 'bridge'],
  ['agent_unreachable', 'agent'],
  ['mode_not_balance', 'mode'],
  ['hand_fault', 'hand_right'],
  ['lease_duplicate', 'control'],
  ['not_engaged', 'arms'],
];

describe('RobotReadinessPanel — one reason, the row that explains it', () => {
  for (const [name, row] of CASES) {
    it(`${name}: shows the reason and highlights the ${row} row`, async () => {
      const snap = readinessFor(ROBOT, name);
      serve(snap);
      render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
      await waitFor(() => expect(screen.getByTestId('readiness-reason')).toHaveAttribute('data-code', snap.reason.code));
      expect(screen.getByTestId('readiness-reason')).toHaveTextContent(snap.reason.text);
      expect(screen.getByTestId(`readiness-row-${row}`)).toHaveAttribute('data-highlighted', 'true');
      const highlighted = document.querySelectorAll('[data-highlighted="true"]');
      expect(highlighted).toHaveLength(1);
    });
  }

  it('colours the line by severity', async () => {
    serve(readinessFor(ROBOT, 'lease_duplicate'));
    render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    await waitFor(() => expect(screen.getByTestId('readiness-reason')).toHaveAttribute('data-severity', 'warn'));
  });

  it('writes each hand fault as joint + code, and the bound-sockets warning', async () => {
    serve(readinessFor(ROBOT, 'hand_fault'));
    const { unmount } = render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    await waitFor(() => expect(screen.getByTestId('readiness-row-hand_right')).toHaveTextContent('thumb_1 0x200'));
    unmount();
    useReadinessStore.getState().reset();
    serve(readinessFor(ROBOT, 'lease_duplicate'));
    render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    await waitFor(() => expect(screen.getByTestId('readiness-row-control')).toHaveTextContent('2 sockets bound'));
  });

  it('without a supervisor hides the bringup rows and buttons; the agent rows still work', async () => {
    serve({ ...readinessFor(ROBOT, 'not_engaged'), bringup: null, supervisor: null });
    render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    await screen.findByTestId('readiness-row-arms');
    expect(screen.queryByTestId('readiness-row-link')).toBeNull();
    expect(screen.queryByTestId('readiness-row-bridge')).toBeNull();
    expect(screen.queryByTestId('readiness-start')).toBeNull();
    expect(screen.queryByTestId('readiness-stop')).toBeNull();
    expect(screen.getByTestId('readiness-row-sidecar')).toBeInTheDocument();
    expect(screen.getByTestId('readiness-row-agent')).toBeInTheDocument();
  });

  it('the compact variant shows the reason and only the failing rows', async () => {
    serve(readinessFor(ROBOT, 'hand_fault'));
    render(<RobotReadinessPanel robotId={ROBOT} variant="compact" />);
    await waitFor(() => expect(screen.getByTestId('readiness-row-hand_right')).toBeInTheDocument());
    expect(screen.queryByTestId('readiness-row-hand_left')).toBeNull();
    expect(screen.queryByTestId('readiness-row-sidecar')).toBeNull();
    expect(screen.queryByTestId('readiness-stop')).toBeNull();
  });

  it('the line variant is the reason only', async () => {
    serve(readinessFor(ROBOT, 'mode_not_balance'));
    render(<RobotReadinessPanel robotId={ROBOT} variant="line" />);
    await waitFor(() => expect(screen.getByTestId('readiness-reason')).toHaveTextContent('Switch it to Balance'));
    expect(screen.queryByRole('list', { name: 'Readiness checklist' })).toBeNull();
  });
});

describe('RobotReadinessPanel — robot-side actions', () => {
  it('Start posts start {mode: read_only} without a confirmation', async () => {
    serve(readinessFor(ROBOT, 'bringup_stopped'));
    const bodies: unknown[] = [];
    server.use(
      http.post(`/api/robots/${ROBOT}/bringup/start`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    render(<RobotReadinessPanel robotId={ROBOT} lease={UNBOUND} />);
    fireEvent.click(await screen.findByTestId('readiness-start'));
    await waitFor(() => expect(bodies).toEqual([{ mode: 'read_only' }]));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Switch to arm control is disabled without the lease and says why', async () => {
    serve(readinessFor(ROBOT, 'read_only_ready'));
    render(<RobotReadinessPanel robotId={ROBOT} lease={UNBOUND} />);
    expect(await screen.findByTestId('readiness-arm-control')).toBeDisabled();
    expect(screen.getByTestId('readiness-arm-blocked')).toHaveTextContent('Take control first');
  });

  it('Switch to arm control posts sidecar-mode {arm_sdk, confirm} with the lease after the dialog', async () => {
    serve(readinessFor(ROBOT, 'read_only_ready'));
    const bodies: unknown[] = [];
    server.use(
      http.post(`/api/robots/${ROBOT}/bringup/sidecar-mode`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    fireEvent.click(await screen.findByTestId('readiness-arm-control'));
    const dialog = await screen.findByTestId('readiness-arm-confirm');
    expect(dialog).toHaveTextContent('arm_sdk');
    expect(dialog).toHaveTextContent('xr_teleoperate must not run');
    expect(dialog).toHaveTextContent('Balance');
    expect(bodies).toEqual([]);
    fireEvent.click(screen.getByTestId('readiness-arm-confirm-confirm'));
    await waitFor(() =>
      expect(bodies).toEqual([{ mode: 'arm_sdk', confirm: true, leaseId: 'lease-secret', generation: 7 }]),
    );
  });

  it('shows a refused POST inline under the buttons', async () => {
    serve(readinessFor(ROBOT, 'bringup_stopped'));
    server.use(
      http.post(`/api/robots/${ROBOT}/bringup/start`, () =>
        HttpResponse.json({ code: 'supervisor_unreachable', error: 'the robot supervisor did not answer' }, { status: 503 }),
      ),
    );
    render(<RobotReadinessPanel robotId={ROBOT} />);
    fireEvent.click(await screen.findByTestId('readiness-start'));
    expect(await screen.findByTestId('readiness-error')).toHaveTextContent('the robot supervisor did not answer (supervisor_unreachable)');
  });

  it('Stop with a measured balance offers Limp first; Limp waits for the measured limp, then stops', async () => {
    serve(readinessFor(ROBOT, 'following'));
    const events: string[] = [];
    let limpPosted = false;
    let readsAfterLimp = 0;
    server.use(
      http.get(`/api/robots/${ROBOT}/base-mode`, () => {
        let mode = 'balance';
        if (limpPosted) {
          readsAfterLimp += 1;
          mode = readsAfterLimp >= 3 ? 'limp' : 'balance';
        }
        events.push(`get:${mode}`);
        return HttpResponse.json({
          capability: { gate: 'fsm', moveEnabled: false, idsVerified: true, ids: null },
          base: { mode, fsmId: null, ageS: 0.1, error: null },
          inFlight: null, estopLatched: false, armed: false,
        });
      }),
      http.post(`/api/robots/${ROBOT}/base-mode`, async ({ request }) => {
        const body = (await request.json()) as { mode: string; leaseId: string; generation: number };
        events.push(`post-mode:${body.mode}:${body.leaseId}:${body.generation}`);
        limpPosted = true;
        return HttpResponse.json({ ok: true, fsm_id: 0, took_ms: 200 });
      }),
      http.post(`/api/robots/${ROBOT}/bringup/stop`, () => {
        events.push('post-stop');
        return HttpResponse.json({ status: null, baseMode: null });
      }),
    );
    render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    fireEvent.click(await screen.findByTestId('readiness-stop'));
    const dialog = await screen.findByTestId('readiness-stop-confirm');
    expect(within(dialog).getByTestId('readiness-limp-offer')).toHaveTextContent('balance');
    fireEvent.click(within(dialog).getByTestId('readiness-limp-first'));
    await waitFor(() => expect(events).toContain('post-stop'), { timeout: 5000 });
    expect(events[0]).toBe('post-mode:limp:lease-secret:7');
    const stopAt = events.indexOf('post-stop');
    const limpAt = events.indexOf('get:limp');
    expect(limpAt).toBeGreaterThan(0);
    expect(stopAt).toBeGreaterThan(limpAt);
    expect(events.filter((e) => e === 'post-stop')).toHaveLength(1);
  });

  it('Stop never limps on its own: confirming stop posts only stop', async () => {
    serve(readinessFor(ROBOT, 'following'));
    const events: string[] = [];
    server.use(
      http.post(`/api/robots/${ROBOT}/base-mode`, () => {
        events.push('post-mode');
        return HttpResponse.json({ ok: true });
      }),
      http.post(`/api/robots/${ROBOT}/bringup/stop`, () => {
        events.push('post-stop');
        return HttpResponse.json({ status: null, baseMode: null });
      }),
    );
    render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    fireEvent.click(await screen.findByTestId('readiness-stop'));
    fireEvent.click(await screen.findByTestId('readiness-stop-confirm-confirm'));
    await waitFor(() => expect(events).toEqual(['post-stop']));
  });

  it('Stop while the robot is limp offers no Limp first', async () => {
    const snap = readinessFor(ROBOT, 'following');
    const ar = snap.agent.readiness!;
    serve({ ...snap, agent: { ...snap.agent, readiness: { ...ar, base: { ...ar.base!, mode: 'limp' } } } });
    render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    fireEvent.click(await screen.findByTestId('readiness-stop'));
    await screen.findByTestId('readiness-stop-confirm');
    expect(screen.queryByTestId('readiness-limp-offer')).toBeNull();
  });

  it('a foreign step shows its process with Adopt and Leave, and nothing destructive', async () => {
    serve(readinessFor(ROBOT, 'bringup_foreign:bridge'));
    const posted: string[] = [];
    server.use(
      http.post(`/api/robots/${ROBOT}/bringup/steps/:step/:action`, ({ params }) => {
        posted.push(`${String(params.step)}/${String(params.action)}`);
        return HttpResponse.json({ ok: true });
      }),
    );
    render(<RobotReadinessPanel robotId={ROBOT} lease={BOUND} />);
    const box = await screen.findByTestId('readiness-foreign-bridge');
    expect(box).toHaveTextContent('31337');
    expect(box).toHaveTextContent('g1_state_bridge.py');
    expect(within(box).getByRole('button', { name: 'Adopt' })).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Leave' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /kill|terminate|force/i })).toBeNull();
    fireEvent.click(within(box).getByRole('button', { name: 'Adopt' }));
    await waitFor(() => expect(posted).toEqual(['bridge/adopt']));
  });

  it('offers Bring up LAN when the carrier is up but the address is missing', async () => {
    serve(readinessFor(ROBOT, 'bringup_failed:link'));
    let called = 0;
    server.use(
      http.post(`/api/robots/${ROBOT}/bringup/lan-up`, () => {
        called += 1;
        return HttpResponse.json({ ok: true });
      }),
    );
    render(<RobotReadinessPanel robotId={ROBOT} />);
    fireEvent.click(await screen.findByTestId('readiness-lan-up'));
    await waitFor(() => expect(called).toBe(1));
  });

  it('a running step shows a spinner with its detail', async () => {
    const snap = readinessFor(ROBOT, 'bringup_stopped');
    const steps = snap.bringup!.steps.map((s) =>
      s.id === 'link' ? { ...s, state: 'running' as const, detail: 'waiting for the simulator' } : s,
    );
    serve({
      ...snap,
      bringup: { ...snap.bringup!, overall: 'starting', steps },
      reason: { code: 'bringup_busy', severity: 'warn', text: 'Robot side is starting: link…', source: 'server' },
    });
    render(<RobotReadinessPanel robotId={ROBOT} />);
    const row = await screen.findByTestId('readiness-row-link');
    await waitFor(() => expect(row).toHaveAttribute('data-status', 'pending'));
    expect(row).toHaveTextContent('waiting for the simulator');
    expect(within(row).getByRole('status')).toBeInTheDocument();
    expect(row).toHaveAttribute('data-highlighted', 'true');
  });
});

describe('BringupLogsDrawer', () => {
  it('renders the tail, skips the stream’s replay, and appends new SSE lines', async () => {
    let push: ((line: string) => void) | null = null;
    const api = {
      getBringupLogs: vi.fn(async () => ['boot', 'listening on :8767']),
      streamBringupLogs: vi.fn((_r: string, _p: string, onLine: (l: string) => void) => {
        push = onLine;
        return () => {};
      }),
    };
    render(<BringupLogsDrawer robotId={ROBOT} api={api} />);
    await waitFor(() => expect(screen.getByTestId('bringup-logs-lines')).toHaveTextContent('listening on :8767'));
    expect(api.getBringupLogs).toHaveBeenCalledWith(ROBOT, 'bridge', 200);
    act(() => {
      push!('boot');
      push!('listening on :8767');
      push!('lowstate 500 Hz');
    });
    const text = screen.getByTestId('bringup-logs-lines').textContent ?? '';
    expect(text.split('\n')).toEqual(['boot', 'listening on :8767', 'lowstate 500 Hz']);
  });

  it('holds lines while paused and flushes them on resume', async () => {
    let push: ((line: string) => void) | null = null;
    const api = {
      getBringupLogs: vi.fn(async () => []),
      streamBringupLogs: vi.fn((_r: string, _p: string, onLine: (l: string) => void) => {
        push = onLine;
        return () => {};
      }),
    };
    render(<BringupLogsDrawer robotId={ROBOT} api={api} />);
    await waitFor(() => expect(push).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => push!('while paused'));
    expect(screen.getByTestId('bringup-logs-lines')).not.toHaveTextContent('while paused');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.getByTestId('bringup-logs-lines')).toHaveTextContent('while paused'));
  });

  it('reads the real SSE route through MSW (tail + data: frames)', async () => {
    server.use(
      http.get(`/api/robots/${ROBOT}/bringup/logs/sidecar`, () => HttpResponse.json({ proc: 'sidecar', lines: ['tail line'] })),
      http.get(`/api/robots/${ROBOT}/bringup/logs/sidecar/stream`, () => {
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(enc.encode('data: "tail line"\n\n: keep-alive\n\n'));
            c.enqueue(enc.encode('data: "streamed line"\n\n'));
            c.close();
          },
        });
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );
    render(<BringupLogsDrawer robotId={ROBOT} procs={['sidecar']} />);
    await waitFor(() => expect(screen.getByTestId('bringup-logs-lines')).toHaveTextContent('streamed line'));
    const text = screen.getByTestId('bringup-logs-lines').textContent ?? '';
    expect(text.split('\n')).toEqual(['tail line', 'streamed line']);
  });

  it('opens from the panel’s Logs button with the tabs bridge / sidecar / agent', async () => {
    serve(readinessFor(ROBOT, 'following'));
    server.use(http.get(`/api/robots/${ROBOT}/bringup/logs/:proc`, () => HttpResponse.json({ lines: [] })));
    render(<RobotReadinessPanel robotId={ROBOT} logsApi={{ getBringupLogs: async () => [], streamBringupLogs: () => () => {} }} />);
    fireEvent.click(await screen.findByTestId('readiness-logs'));
    const tabs = within(await screen.findByTestId('bringup-logs')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['bridge', 'sidecar', 'agent']);
  });
});

it('every fixture is a complete snapshot', () => {
  for (const f of Object.values(READINESS_FIXTURES)) {
    expect(f.reason.text.length).toBeGreaterThan(0);
  }
});
