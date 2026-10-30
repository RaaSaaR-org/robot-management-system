/**
 * @file SessionDetailPage.handover.test.tsx
 * @description The lease Set up takes is given back (TASK-427 review): the
 *              server never preempts a held lease, so the operator could not
 *              take control in the headset while the page kept it. With arm
 *              control already on and the robot standing, step 3 offers Take
 *              control itself; while the page holds the lease it shows it with
 *              Release; and it releases on its own once the operator opens VR
 *              with the robot balancing, and when the session starts.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { readinessFor } from '@/mocks/readinessDemoHandlers';
import { renderWithProviders } from '@/test/utils';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { useDataCollectionStore } from '../../store/datacollectionStore';
import { SessionDetailPage } from '../SessionDetailPage';
import type { TeleoperationSession } from '../../types/datacollection.types';

const h = vi.hoisted(() => ({
  active: [] as boolean[],
  acquire: vi.fn(),
  release: vi.fn(),
  mode: 'stand' as string,
}));

vi.mock('../../hooks/useTeleopEvents', () => ({ useTeleopEvents: () => ({ isConnected: true }) }));
vi.mock('../../../robots/hooks/useTelemetryStream', () => ({
  useTelemetryStream: () => ({ telemetry: null, isConnected: true }),
}));
vi.mock('../../hooks/useSessionControlLease', async () => {
  const React = await import('react');
  return {
    // A lease that binds on acquire and drops on release, over a socket open while active.
    useSessionControlLease: (_robotId: string, _url: string | undefined, active: boolean) => {
      const [state, setState] = React.useState('observing');
      h.active.push(active);
      return {
        lease: {
          enabled: true, state, holder: null, notice: null, bindSocket: vi.fn(),
          acquire: async () => { h.acquire(); setState('bound'); },
          release: () => { h.release(); setState('observing'); },
          grant: () => (state === 'bound' ? { leaseId: 'l1', generation: 1 } : null),
        },
        connected: active,
      };
    },
  };
});
vi.mock('../../../robots/hooks/useRobotBaseMode', () => ({
  useRobotBaseMode: () => ({
    status: {
      capability: { gate: 'fsm', moveEnabled: false, idsVerified: true, ids: { limp: 1, stand: 4, balance: 501, balanceReported: [501] } },
      base: { fsmId: h.mode === 'balance' ? 501 : 4, mode: h.mode, ageS: 0.3, error: null },
      inFlight: null, estopLatched: false, sidecarEstopLatched: false, armed: false, sidecarReachable: true,
    },
    readError: null, readAt: Date.now(), standSince: Date.now() - 60_000, pending: null, lastResult: null,
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

const session = {
  id: 'sess-hand', operatorId: 'u', robotId: 'g1', type: 'vr_quest', status: 'created',
  startedAt: null, endedAt: null, frameCount: 0, duration: null, fps: 30, languageInstr: 'Pick up the apple',
  qualityScore: null, exportedDatasetId: null, errorMessage: null, numEpisodes: 3, createdAt: 'x', updatedAt: 'x',
} as TeleoperationSession;

beforeEach(() => {
  h.active = [];
  h.acquire.mockClear();
  h.release.mockClear();
  h.mode = 'stand';
  // Arm control is already on (switched on the Teleop tab); the robot stands.
  server.use(http.get('/api/robots/:id/readiness', () => HttpResponse.json(readinessFor('g1', 'mode_not_balance'))));
  useRobotsStore.setState({
    robots: [{ id: 'g1', name: 'G1 EDU', model: 'Unitree G1', status: 'online', batteryLevel: 80, location: { x: 0, y: 0, zone: '' }, lastSeen: 'x', capabilities: [], createdAt: 'x', updatedAt: 'x' } as never],
    fetchRobots: vi.fn().mockResolvedValue(undefined) as never,
  });
  useDataCollectionStore.setState({
    sessions: [session],
    selectedSession: session,
    episodes: [],
    presence: null,
    fetchSession: vi.fn().mockResolvedValue(undefined) as never,
    fetchEpisodes: vi.fn().mockResolvedValue(undefined) as never,
  });
});

const render = () => renderWithProviders(
  <Routes><Route path="/data-collection/:sessionId" element={<SessionDetailPage />} /></Routes>,
  { routerEntries: ['/data-collection/sess-hand'] },
);

/** Step 3 is current with arm control on: take control there. */
async function takeInStep3() {
  render();
  await waitFor(() => expect(screen.getByTestId('setup-step-stance')).toHaveAttribute('data-state', 'current'));
  expect(screen.getByTestId('setup-step-arm_control')).toHaveAttribute('data-state', 'done');
  const stance = screen.getByTestId('setup-step-stance');
  expect(within(stance).queryByText(/Take control in step 2 first/)).toBeNull();
  fireEvent.click(within(stance).getByTestId('robot-mode-take-control'));
  await waitFor(() => expect(within(stance).getByTestId('setup-lease-held')).toBeInTheDocument());
  expect(h.acquire).toHaveBeenCalledTimes(1);
  expect(within(stance).queryByTestId('robot-mode-take-control')).toBeNull();
  expect(within(stance).getByTestId('robot-mode-balance')).toBeEnabled();
}

const operatorArrives = () => act(() => {
  useDataCollectionStore.setState({
    presence: { sessionId: 'sess-hand', viewers: [{ userId: 'op', displayName: 'Anna Op', role: 'operator', since: 'x' }] },
  });
});

describe('SessionDetailPage Set up hands the lease over', () => {
  it('offers Take control in step 3 when step 2 is already done, and shows the held lease with Release', async () => {
    await takeInStep3();
    fireEvent.click(within(screen.getByTestId('setup-step-stance')).getByTestId('setup-lease-release'));
    expect(h.release).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.active[h.active.length - 1]).toBe(false));
    expect(screen.queryByTestId('setup-lease-held')).toBeNull();
  });

  it('keeps the lease while the robot is not balancing, and releases it once the operator opens VR with it balancing', async () => {
    await takeInStep3();
    operatorArrives();
    // Standing: the assistant still needs control for Balance.
    expect(h.release).not.toHaveBeenCalled();

    h.mode = 'balance';
    act(() => {
      useDataCollectionStore.setState({
        presence: { sessionId: 'sess-hand', viewers: [{ userId: 'op', displayName: 'Anna Op', role: 'operator', since: 'y' }] },
      });
    });
    await waitFor(() => expect(h.release).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.active[h.active.length - 1]).toBe(false));
    expect(screen.queryByTestId('setup-lease-held')).toBeNull();
  });

  it('releases when the operator arrives after the robot already balances', async () => {
    await takeInStep3();
    h.mode = 'balance';
    // Any re-render picks up the measured Balance; the operator is not here yet.
    act(() => { useDataCollectionStore.setState({ episodes: [] }); });
    expect(h.release).not.toHaveBeenCalled();
    operatorArrives();
    await waitFor(() => expect(h.release).toHaveBeenCalledTimes(1));
  });

  it('releases the lease when the session starts', async () => {
    await takeInStep3();
    act(() => {
      const started = { ...session, status: 'recording', startedAt: 'x' } as TeleoperationSession;
      useDataCollectionStore.setState({ sessions: [started], selectedSession: started });
    });
    await waitFor(() => expect(h.release).toHaveBeenCalled());
    await waitFor(() => expect(h.active[h.active.length - 1]).toBe(false));
  });
});
