/**
 * @file SessionDetailPage.armSwitchLease.test.tsx
 * @description TASK-437: Set up step 2's "Switch to arm control" goes out with
 *              control held. The live failure, deterministically: step 2 takes
 *              the lease, the confirm opens, and while it is open the tab stops
 *              running long enough to miss its renewals, so the robot expires
 *              the lease and the page gives it back. Confirming then sent the
 *              switch with no lease and the server refused it with 409
 *              `lease_required`. The confirm is an explicit press: it takes
 *              control again and switches with the new lease, or, when that
 *              fails, sends nothing and says why. The real lease hooks run
 *              here; only the network and the agent's socket are stand-ins.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { readinessFor } from '@/mocks/readinessDemoHandlers';
import { renderWithProviders } from '@/test/utils';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { useReadinessStore } from '@/features/robots/store/readinessStore';
import { useDataCollectionStore } from '../../store/datacollectionStore';
import { SessionDetailPage } from '../SessionDetailPage';
import type { TeleoperationSession } from '../../types/datacollection.types';
import { FakeSocket, binds } from '../../hooks/__tests__/fakeSocket';

vi.mock('../../../robots/api/controlLeaseApi', () => ({
  controlLeaseApi: {
    getControlLease: vi.fn(),
    acquireControlLease: vi.fn(),
    renewControlLease: vi.fn(),
    releaseControlLease: vi.fn(),
  },
}));
vi.mock('../../hooks/useTeleopEvents', () => ({ useTeleopEvents: () => ({ isConnected: true }) }));
vi.mock('../../../robots/hooks/useTelemetryStream', () => ({
  useTelemetryStream: () => ({ telemetry: null, isConnected: true }),
}));
vi.mock('../../../robots/hooks/useRobotBaseMode', () => ({
  useRobotBaseMode: () => ({
    status: {
      capability: { gate: 'off', moveEnabled: false, idsVerified: false, ids: { limp: 1, stand: 4, balance: 501, balanceReported: [501] } },
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

import { controlLeaseApi } from '../../../robots/api/controlLeaseApi';

const api = vi.mocked(controlLeaseApi);
const grant = (generation: number) => ({ leaseId: `lease-${generation}`, generation, ttlMs: 5000, renewEveryMs: 1000 });

const session = {
  id: 'sess-arm', operatorId: 'u', robotId: 'g1', type: 'vr_quest', status: 'created',
  startedAt: null, endedAt: null, frameCount: 0, duration: null, fps: 30, languageInstr: 'Pick up the apple',
  qualityScore: null, exportedDatasetId: null, errorMessage: null, numEpisodes: 3, createdAt: 'x', updatedAt: 'x',
} as TeleoperationSession;

/** The sidecar-mode bodies the page sent; the server's own lease rule answers them. */
let switches: Record<string, unknown>[];

/** The page's other sockets (presence, observers) take listeners too; they stay closed here. */
class PageSocket extends FakeSocket {
  addEventListener() {}
  removeEventListener() {}
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.clearAllMocks();
  vi.stubGlobal('WebSocket', PageSocket);
  useReadinessStore.getState().reset();
  switches = [];
  api.getControlLease.mockResolvedValue({ capability: { version: 1, enabled: true, ttlMs: 5000, renewEveryMs: 1000 }, holder: null });
  // clearAllMocks keeps queued once-values; a test that took only once would hand its 29 to the next.
  api.acquireControlLease.mockReset();
  api.acquireControlLease.mockResolvedValueOnce({ ok: true, grant: grant(28) } as never);
  api.acquireControlLease.mockResolvedValueOnce({ ok: true, grant: grant(29) } as never);
  api.renewControlLease.mockImplementation(async (_robot, _id, generation) =>
    ({ ok: true, generation, expiresAt: new Date(Date.now() + 5000).toISOString(), ttlMs: 5000, renewEveryMs: 1000 }));
  api.releaseControlLease.mockResolvedValue({ released: true });
  server.use(
    http.get('/api/robots/:id/readiness', () => HttpResponse.json(readinessFor('g1', 'read_only_ready'))),
    http.post('/api/robots/:id/bringup/sidecar-mode', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      switches.push(body);
      // robot-bringup.routes.ts: arm_sdk needs the caller's live lease.
      if (body.mode === 'arm_sdk' && typeof body.leaseId !== 'string') {
        return HttpResponse.json(
          { error: 'arm_sdk is the motion path — take control of the robot first', code: 'lease_required' },
          { status: 409 },
        );
      }
      return HttpResponse.json({ status: null }, { status: 202 });
    }),
  );
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

afterEach(() => {
  vi.unstubAllGlobals();
});

const render = () => renderWithProviders(
  <Routes><Route path="/data-collection/:sessionId" element={<SessionDetailPage />} /></Routes>,
  { routerEntries: ['/data-collection/sess-arm'] },
);

/** The page's own lease socket to the agent (the teleop proxy), once Take control opened it. */
const teleopSocket = (): FakeSocket | undefined => FakeSocket.instances.find((s) => s.url.endsWith('/teleop/ws'));

/** The agent confirms the bind it was sent, as the keyboard-teleop handler does. */
async function agentBinds(generation: number) {
  await waitFor(() => expect(binds(teleopSocket()!).some((b) => (b.bind as { generation: number }).generation === generation)).toBe(true), { timeout: 3000 });
  act(() => teleopSocket()!.receive({ type: 'lease', state: 'bound', generation }));
}

/** Step 2: Take control, the agent binds generation 28, and the arm-control confirm opens. */
async function takeAndOpenConfirm() {
  render();
  await waitFor(() => expect(screen.getByTestId('setup-step-arm_control')).toHaveAttribute('data-state', 'current'));
  fireEvent.click(within(screen.getByTestId('setup-step-arm_control')).getByTestId('readiness-take-control'));
  await waitFor(() => expect(teleopSocket()).toBeDefined());
  act(() => teleopSocket()!.open());
  await agentBinds(28);
  await screen.findByTestId('readiness-arm-confirm', undefined, { timeout: 3000 });
  expect(within(screen.getByTestId('setup-step-arm_control')).getByTestId('setup-lease-held')).toBeInTheDocument();
}

/** The tab missed its renewals: the agent expires the lease (TTL 5 s), and the page ends it. */
async function robotExpiresLease(generation: number) {
  act(() => teleopSocket()!.receive({ type: 'lease', state: 'expired', generation }));
  await waitFor(() => expect(api.releaseControlLease).toHaveBeenCalledWith('g1', `lease-${generation}`, generation));
}

describe('SessionDetailPage step 2: the arm-control switch goes out with control held (TASK-437)', () => {
  it('keeps the lease through the confirm and switches with it', async () => {
    await takeAndOpenConfirm();
    fireEvent.click(screen.getByTestId('readiness-arm-confirm-confirm'));
    await waitFor(() => expect(switches).toEqual([{ mode: 'arm_sdk', confirm: true, leaseId: 'lease-28', generation: 28 }]));
    expect(api.acquireControlLease).toHaveBeenCalledTimes(1);
    // Nothing gave the lease back: read-only is not the hand-over.
    expect(api.releaseControlLease).not.toHaveBeenCalled();
  });

  it('a lease the robot expired while the confirm was open is taken again before the switch', async () => {
    await takeAndOpenConfirm();
    await robotExpiresLease(28);
    // The step says what happened, not only "Nobody has control".
    expect(within(screen.getByTestId('setup-step-arm_control')).getByTestId('setup-lease-lost')).toHaveTextContent(/expired on the robot/);
    fireEvent.click(screen.getByTestId('readiness-arm-confirm-confirm'));
    await agentBinds(29);
    await waitFor(() => expect(switches).toEqual([{ mode: 'arm_sdk', confirm: true, leaseId: 'lease-29', generation: 29 }]), { timeout: 3000 });
    expect(api.acquireControlLease).toHaveBeenCalledTimes(2);
    expect(api.releaseControlLease).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('readiness-error')).toBeNull();
  });

  it('when control cannot be taken again, nothing is sent and the step says why', async () => {
    api.acquireControlLease.mockReset();
    api.acquireControlLease.mockResolvedValueOnce({ ok: true, grant: grant(28) } as never);
    api.acquireControlLease.mockResolvedValueOnce({
      ok: false, code: 'lease_held', status: 409, holder: { userId: 'op', displayName: 'Anna', state: 'held' },
    } as never);
    await takeAndOpenConfirm();
    await robotExpiresLease(28);
    fireEvent.click(screen.getByTestId('readiness-arm-confirm-confirm'));
    await waitFor(() => expect(api.acquireControlLease).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(await screen.findByTestId('readiness-error', undefined, { timeout: 3000 })).toHaveTextContent(/not switched/);
    expect(switches).toEqual([]);
  });
});
