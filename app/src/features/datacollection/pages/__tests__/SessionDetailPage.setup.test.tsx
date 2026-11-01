/**
 * @file SessionDetailPage.setup.test.tsx
 * @description Set up on a created VR session (TASK-427): the robot side is up
 *              read-only and the robot limp, so step 2 is current — open, with
 *              Take control as the page's one lit action. The read-only reason
 *              is said once, the Quest controls exist once (in step 4), step 3
 *              carries the mode buttons behind its own Take control, and Take
 *              control opens the page's lease only on the press. TASK-430: on
 *              stale code step 1 leads with Restart, behind the Stop confirm,
 *              which stops, waits for stopped and starts; while the robot side
 *              runs, Stop waits under step 1's Details. TASK-431: a latched
 *              E-stop, or a protective stop no latch holds, is step 3's blocker
 *              with Reset E-stop as the one lit action; the reset is the VR
 *              window's call, and afterwards step 3 says to stand up again.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { readinessFor } from '@/mocks/readinessDemoHandlers';
import { renderWithProviders } from '@/test/utils';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { useDataCollectionStore } from '../../store/datacollectionStore';
import { SessionDetailPage } from '../SessionDetailPage';
import { RESET_DONE } from '../../utils/robotStop';
import type { TeleoperationSession } from '../../types/datacollection.types';

const leaseCalls = vi.hoisted(() => ({ active: [] as boolean[], acquire: vi.fn(async () => {}) }));

vi.mock('../../hooks/useTeleopEvents', () => ({ useTeleopEvents: () => ({ isConnected: true }) }));
vi.mock('../../../robots/hooks/useTelemetryStream', () => ({
  useTelemetryStream: () => ({ telemetry: null, isConnected: true }),
}));
vi.mock('../../hooks/useSessionControlLease', () => ({
  useSessionControlLease: (_robotId: string, _url: string | undefined, active: boolean) => {
    leaseCalls.active.push(active);
    return {
      lease: {
        enabled: true, state: 'observing', holder: null, notice: null,
        bindSocket: vi.fn(), acquire: leaseCalls.acquire, release: vi.fn(), grant: () => null,
      },
      connected: false,
    };
  },
}));
vi.mock('../../../robots/hooks/useRobotBaseMode', () => ({
  useRobotBaseMode: () => ({
    status: {
      capability: { gate: 'fsm', moveEnabled: false, idsVerified: false, ids: { limp: 1, stand: 4, balance: 501, balanceReported: [501] } },
      base: { fsmId: 1, mode: 'limp', ageS: 0.3, error: null },
      inFlight: null, estopLatched: false, sidecarEstopLatched: false, armed: false, sidecarReachable: true,
    },
    readError: null, readAt: Date.now(), standSince: null, pending: null, lastResult: null,
    request: vi.fn(), refresh: vi.fn(),
  }),
}));
vi.mock('../../hooks/useGamepadJoints', () => ({ useGamepadJoints: () => undefined }));
vi.mock('../../../robots/hooks/useRobotCameras', () => ({
  useRobotCameras: () => ({ cameras: ['head_camera'], source: 'pc2cam', loading: false, refresh: vi.fn() }),
}));
vi.mock('../../components/CameraStreamView', () => ({ CameraStreamView: () => null }));
vi.mock('../../../robots/components/visualization/Robot3DViewer', () => ({ Robot3DViewer: () => null }));
vi.mock('../../../robots/components/tabs/TeleopTab', () => ({ KeyboardTeleopSection: () => null }));
vi.mock('../../../robots/components/tabs/vr/VRTeleopModal', () => ({ VRTeleopModalBody: () => null }));

const READ_ONLY_TEXT = 'The sidecar is read-only. Switch the robot side to arm control.';

const session = {
  id: 'sess-setup', operatorId: 'u', robotId: 'g1', type: 'vr_quest', status: 'created',
  startedAt: null, endedAt: null, frameCount: 0, duration: null, fps: 30, languageInstr: 'Pick up the apple',
  qualityScore: null, exportedDatasetId: null, errorMessage: null, numEpisodes: 3, createdAt: 'x', updatedAt: 'x',
} as TeleoperationSession;

beforeEach(() => {
  leaseCalls.active = [];
  leaseCalls.acquire.mockClear();
  server.use(http.get('/api/robots/:id/readiness', () => HttpResponse.json(readinessFor('g1', 'read_only_ready'))));
  useRobotsStore.setState({
    robots: [{ id: 'g1', name: 'G1 EDU', model: 'Unitree G1', status: 'online', batteryLevel: 80, location: { x: 0, y: 0, zone: '' }, lastSeen: 'x', capabilities: [], createdAt: 'x', updatedAt: 'x' } as never],
    fetchRobots: vi.fn().mockResolvedValue(undefined) as never,
  });
  useDataCollectionStore.setState({
    sessions: [session],
    selectedSession: session,
    episodes: [],
    fetchSession: vi.fn().mockResolvedValue(undefined) as never,
    fetchEpisodes: vi.fn().mockResolvedValue(undefined) as never,
  });
});

const render = () => renderWithProviders(
  <Routes><Route path="/data-collection/:sessionId" element={<SessionDetailPage />} /></Routes>,
  { routerEntries: ['/data-collection/sess-setup'] },
);

/** Enabled kit primaries outside collapsed bodies and closed popovers. */
function litPrimaries(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('button.bg-primary')].filter(
    (b) => !b.disabled && b.closest('[hidden]') === null,
  );
}

async function ready() {
  render();
  await waitFor(() => expect(screen.getByTestId('setup-step-arm_control')).toHaveAttribute('data-state', 'current'));
}

describe('SessionDetailPage Set up', () => {
  it('opens the current step and lights exactly one action in it', async () => {
    await ready();
    expect(screen.getByTestId('setup-step-robot')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('setup-step-arm_control')).toHaveAttribute('data-expanded', 'true');
    const lit = litPrimaries();
    expect(lit.map((b) => b.dataset.testid)).toEqual(['readiness-take-control']);
    // Start session is secondary while steps are open.
    expect(screen.getByRole('button', { name: 'Start session' }).className).not.toContain('bg-primary');
    expect(screen.getByTestId('setup-start-text')).toHaveTextContent(/4 steps open\. You can start anyway/);
  });

  it('states the read-only reason once, in step 2, and the Quest controls once, in step 4', async () => {
    await ready();
    const body = document.body.textContent ?? '';
    expect(body.split(READ_ONLY_TEXT).length - 1).toBe(1);
    expect(within(screen.getByTestId('setup-step-arm_control')).getByTestId('setup-step-reason')).toHaveTextContent(READ_ONLY_TEXT);
    for (const id of ['quest-connect', 'quest-open', 'quest-copy-viewer-link', 'quest-connect-help']) {
      expect(screen.getAllByTestId(id)).toHaveLength(1);
    }
    expect(within(screen.getByTestId('setup-step-quest')).getByTestId('quest-connect-help')).toHaveAttribute('data-mode', 'live');
    expect(screen.getAllByText('Open on headset')).toHaveLength(1);
    expect(screen.queryByTestId('robot-readiness-compact')).toBeNull();
  });

  it('reaches every step function with one click, and moves the one lit action with the open step', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('setup-step-stance-toggle'));
    expect(screen.getByTestId('setup-step-arm_control')).toHaveAttribute('data-expanded', 'false');
    const stance = screen.getByTestId('setup-step-stance');
    expect(within(stance).getByTestId('robot-mode-stand')).toBeVisible();
    expect(within(stance).getByTestId('robot-mode-limp')).toBeVisible();
    // The step lacks only control, so it offers Take control itself as its one
    // lit action, in place of a reason line naming a button elsewhere.
    expect(within(stance).queryByTestId('robot-mode-reasons')).toBeNull();
    expect(litPrimaries().map((b) => b.dataset.testid)).toEqual(['robot-mode-take-control']);
    expect(within(stance).getByTestId('robot-mode-limp').className).not.toContain('bg-primary');

    fireEvent.click(screen.getByTestId('setup-step-quest-toggle'));
    const quest = screen.getByTestId('setup-step-quest');
    expect(within(quest).getByTestId('quest-connect')).toBeVisible();
    expect(litPrimaries().map((b) => b.dataset.testid)).toEqual(['quest-connect']);

    // Closing a step that is not current returns to the current one.
    fireEvent.click(screen.getByTestId('setup-step-quest-toggle'));
    expect(screen.getByTestId('setup-step-arm_control')).toHaveAttribute('data-expanded', 'true');
  });

  it('opens the page lease only when Take control is pressed', async () => {
    await ready();
    expect(leaseCalls.active.every((a) => a === false)).toBe(true);
    fireEvent.click(screen.getByTestId('readiness-take-control'));
    await waitFor(() => expect(leaseCalls.active[leaseCalls.active.length - 1]).toBe(true));
  });
});

describe('SessionDetailPage Set up — step 1 restarts a robot side on stale code (TASK-430)', () => {
  /** The demo robot side in miniature: stale until stopped, stopping once, stopped, then read-only after Start. */
  function staleRobotSide() {
    const posts: string[] = [];
    let phase: 'stale' | 'stopping' | 'stopped' | 'up' = 'stale';
    server.use(
      http.get('/api/robots/:id/readiness', () => {
        if (phase === 'stopping') {
          phase = 'stopped';
          const s = readinessFor('g1', 'bringup_stopped');
          return HttpResponse.json({ ...s, bringup: { ...s.bringup!, overall: 'stopping' } });
        }
        return HttpResponse.json(readinessFor('g1', phase === 'stale' ? 'sidecar_stale_code' : phase === 'stopped' ? 'bringup_stopped' : 'read_only_ready'));
      }),
      http.post('/api/robots/:id/bringup/stop', () => {
        posts.push('stop');
        phase = 'stopping';
        return HttpResponse.json({ status: null, baseMode: null });
      }),
      http.post('/api/robots/:id/bringup/start', async ({ request }) => {
        posts.push(`start:${((await request.json()) as { mode: string }).mode}`);
        phase = 'up';
        return HttpResponse.json({ ok: true });
      }),
    );
    return posts;
  }

  it('makes Restart robot side the one lit action of a current step 1, without the Teleop tab sentence', async () => {
    staleRobotSide();
    render();
    const robot = await screen.findByTestId('setup-step-robot');
    await waitFor(() => expect(robot).toHaveAttribute('data-state', 'current'));
    await waitFor(() => expect(litPrimaries().map((b) => b.dataset.testid)).toEqual(['readiness-restart']));
    expect(within(robot).getByTestId('readiness-restart')).toHaveTextContent('Restart robot side');
    expect(within(robot).queryByTestId('readiness-start')).toBeNull();
    expect(within(robot).getByTestId('setup-step-reason')).toHaveTextContent('The sidecar runs older code than NeoDEM. Restart the robot side.');
    expect(robot.textContent).toContain('Restart stops them and starts them again on the current code, read-only.');
    expect(document.body.textContent).not.toContain('Teleop tab');
    // A restart is the remedy here: Details holds the rows, not a second Stop.
    fireEvent.click(within(robot).getByTestId('setup-step-robot-details-toggle'));
    expect(within(robot).queryByTestId('readiness-stop')).toBeNull();
  });

  it('asks first with the Stop confirm\'s words, then stops, waits for stopped and starts read-only', async () => {
    const posts = staleRobotSide();
    render();
    const restart = await screen.findByTestId('readiness-restart');
    fireEvent.click(restart);
    const dialog = await screen.findByTestId('readiness-restart-confirm');
    expect(dialog).toHaveTextContent('Restart the robot side?');
    expect(dialog).toHaveTextContent('The arms are disarmed first, then the agent, sidecar and bridge stop.');
    expect(dialog).toHaveTextContent('read-only');
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByTestId('readiness-restart-confirm-confirm'));
    await waitFor(() => expect(posts).toEqual(['stop', 'start:read_only']), { timeout: 5_000 });
    // Fresh and read-only: step 1 is done, and the read-only reason is step 2's.
    await waitFor(() => expect(screen.getByTestId('setup-step-robot')).toHaveAttribute('data-state', 'done'), { timeout: 5_000 });
    expect(screen.queryByTestId('readiness-restart')).toBeNull();
    await waitFor(() => expect(litPrimaries().map((b) => b.dataset.testid)).toEqual(['readiness-take-control']));
  });

  it('Cancel restarts nothing', async () => {
    const posts = staleRobotSide();
    render();
    fireEvent.click(await screen.findByTestId('readiness-restart'));
    const dialog = await screen.findByTestId('readiness-restart-confirm');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('readiness-restart-confirm')).toBeNull());
    expect(posts).toEqual([]);
  });

  it('while the robot side runs fine, Stop waits under step 1\'s Details, secondary and confirmed', async () => {
    const posts: string[] = [];
    server.use(http.post('/api/robots/:id/bringup/stop', () => {
      posts.push('stop');
      return HttpResponse.json({ status: null, baseMode: null });
    }));
    await ready();
    const robot = screen.getByTestId('setup-step-robot');
    fireEvent.click(within(robot).getByTestId('setup-step-robot-toggle'));
    expect(robot.textContent).toContain('Stop them under Details when you finish for the day.');
    expect(document.body.textContent).not.toContain('Teleop tab');
    expect(within(robot).queryByTestId('readiness-restart')).toBeNull();
    fireEvent.click(within(robot).getByTestId('setup-step-robot-details-toggle'));
    const stop = within(within(robot).getByTestId('setup-step-robot-details')).getByTestId('readiness-stop');
    expect(stop).toHaveTextContent('Stop robot side');
    expect(stop.className).not.toContain('bg-primary');
    fireEvent.click(stop);
    const dialog = await screen.findByTestId('readiness-stop-confirm');
    expect(dialog).toHaveTextContent('The arms are disarmed first, then the agent, sidecar and bridge stop.');
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByTestId('readiness-stop-confirm-confirm'));
    await waitFor(() => expect(posts).toEqual(['stop']));
  });
});

describe('SessionDetailPage Set up — a stop blocks step 3 (TASK-431)', () => {
  const G1 = { id: 'g1', name: 'G1 EDU', model: 'Unitree G1', batteryLevel: 80, location: { x: 0, y: 0, zone: '' }, lastSeen: 'x', capabilities: [], createdAt: 'x', updatedAt: 'x' };

  it('a latched E-stop: step 3 is current with Reset E-stop as the one lit action, the VR window\'s reset, then "stand up again"', async () => {
    let fixture: 'estop_latched' | 'estop_reset_limp' = 'estop_latched';
    const resets: string[] = [];
    server.use(
      http.get('/api/robots/:id/readiness', () => HttpResponse.json(readinessFor('g1', fixture))),
      http.post('/api/safety/robots/:id/estop/reset', ({ params }) => {
        resets.push(String(params.id));
        fixture = 'estop_reset_limp';
        return HttpResponse.json({ robotId: params.id, status: 'armed', robotStatus: 'online' });
      }),
    );
    render();
    await waitFor(() => expect(screen.getByTestId('setup-step-stance')).toHaveAttribute('data-state', 'current'));
    const stance = screen.getByTestId('setup-step-stance');
    expect(stance).toHaveAttribute('data-expanded', 'true');
    expect(within(stance).getByTestId('setup-step-reason')).toHaveTextContent('E-stop is latched.');
    expect(within(stance).getByTestId('take-dock-estop-reset')).toHaveTextContent(
      'Reset E-stop clears the latch in the robot agent and in the sidecar. It does not move the robot. The operator can also reset it in the headset. Then stand the robot up again: Limp, Stand up, Balance.',
    );
    expect(litPrimaries().map((b) => b.dataset.testid)).toEqual(['estop-reset']);
    // The readiness line does not repeat the stop, and nothing says "at the robot".
    expect(document.body.textContent).not.toContain('E-stop is latched. Reset it');
    expect(document.body.textContent).not.toContain('at the robot');
    expect(screen.getByTestId('setup-step-quest')).toHaveAttribute('data-state', 'waits');
    expect(screen.getByTestId('setup-step-operator')).toHaveAttribute('data-state', 'waits');

    fireEvent.click(within(stance).getByTestId('estop-reset'));
    await waitFor(() => expect(resets).toEqual(['g1']));
    await waitFor(() => expect(within(stance).queryByTestId('estop-recovery')).toBeNull());
    expect(stance).toHaveTextContent(RESET_DONE);
    expect(screen.getByTestId('setup-step-quest')).not.toHaveAttribute('data-state', 'waits');
  });

  it('a failed reset says why and leaves the stop in place', async () => {
    server.use(
      http.get('/api/robots/:id/readiness', () => HttpResponse.json(readinessFor('g1', 'estop_latched'))),
      http.post('/api/safety/robots/:id/estop/reset', () =>
        HttpResponse.json({ error: 'Failed to reset E-stop: Cannot reset E-stop - safety conditions not met' }, { status: 400 })),
    );
    render();
    const reset = await screen.findByTestId('estop-reset');
    fireEvent.click(reset);
    const error = await screen.findByTestId('estop-reset-error');
    expect(error).toHaveTextContent(/^Reset failed: .*The robot is still stopped\.$/);
    expect(screen.getByTestId('estop-recovery')).toBeInTheDocument();
  });

  it('protective_stop with no latch: "Protective stop." and the same reset, which clears the status', async () => {
    let status: 'protective_stop' | 'online' = 'protective_stop';
    const resets: string[] = [];
    useRobotsStore.setState({ robots: [{ ...G1, status: 'protective_stop' } as never] });
    server.use(
      http.get('/api/robots/:id/readiness', () => HttpResponse.json(readinessFor('g1', 'protective_stop_unlatched'))),
      http.get('/api/robots/:id', () => HttpResponse.json({ ...G1, status })),
      http.post('/api/safety/robots/:id/estop/reset', ({ params }) => {
        resets.push(String(params.id));
        status = 'online';
        return HttpResponse.json({ robotId: params.id, status: 'armed', robotStatus: 'online' });
      }),
    );
    render();
    await waitFor(() => expect(screen.getByTestId('setup-step-stance')).toHaveAttribute('data-state', 'current'));
    const stance = screen.getByTestId('setup-step-stance');
    expect(within(stance).getByTestId('setup-step-reason')).toHaveTextContent('Protective stop.');
    expect(within(stance).getByTestId('estop-recovery')).toHaveAttribute('data-kind', 'status');
    expect(within(stance).getByTestId('take-dock-estop-reset')).toHaveTextContent('The robot reports a protective stop, but no latch holds it.');
    expect(litPrimaries().map((b) => b.dataset.testid)).toEqual(['estop-reset']);

    fireEvent.click(within(stance).getByTestId('estop-reset'));
    await waitFor(() => expect(resets).toEqual(['g1']));
    // The page reads the robot's status again after the reset.
    await waitFor(() => expect(within(stance).queryByTestId('estop-recovery')).toBeNull());
  });

  it('reads the robot\'s status on open, not the one the app loaded', async () => {
    server.use(
      http.get('/api/robots/:id/readiness', () => HttpResponse.json(readinessFor('g1', 'protective_stop_unlatched'))),
      http.get('/api/robots/:id', () => HttpResponse.json({ ...G1, status: 'protective_stop' })),
    );
    render();
    await waitFor(() => expect(screen.getByTestId('setup-step-stance')).toHaveTextContent('Protective stop'));
  });
});

