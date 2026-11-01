/**
 * @file SessionDetailPage.handover.test.tsx
 * @description The lease Set up takes is given back (TASK-427 review): the
 *              server never preempts a held lease, so the operator could not
 *              take control in the headset while the page kept it. With arm
 *              control already on and the robot standing, step 3 offers Take
 *              control itself; while the page holds the lease it shows it with
 *              Release; and it releases on its own once arm control is on and
 *              the robot balances (steps 2 and 3 done), and when the session
 *              starts. The trigger is read off the robot, never off the
 *              headset: a headset publishes the operator role only while in
 *              VR, and it enters VR only once it holds the lease, so a
 *              hand-over waiting for it could never fire. TASK-428: each trigger
 *              — the robot balancing, this page opening its own VR window — is
 *              its own rising edge with its own message.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { readinessFor } from '@/mocks/readinessDemoHandlers';
import { renderWithProviders } from '@/test/utils';
import { dismissToast, getToasts } from '@/shared/components/ui';
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
  dismissToast();
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

/** A re-render that picks up a new measured mode (the base-mode poll). */
const rerender = () => act(() => { useDataCollectionStore.setState({ episodes: [] }); });

describe('SessionDetailPage Set up hands the lease over', () => {
  it('offers Take control in step 3 when step 2 is already done, and shows the held lease with Release', async () => {
    await takeInStep3();
    fireEvent.click(within(screen.getByTestId('setup-step-stance')).getByTestId('setup-lease-release'));
    expect(h.release).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.active[h.active.length - 1]).toBe(false));
    expect(screen.queryByTestId('setup-lease-held')).toBeNull();
  });

  it('keeps the lease while the robot only stands, and gives it back once it balances, with no operator in the session', async () => {
    await takeInStep3();
    rerender();
    // Standing: the assistant still needs control for Balance.
    expect(h.release).not.toHaveBeenCalled();
    // Nobody is in the session: the headset could not be "in VR" while the page holds the lease anyway.
    expect(useDataCollectionStore.getState().presence).toBeNull();

    h.mode = 'balance';
    rerender();
    await waitFor(() => expect(h.release).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.active[h.active.length - 1]).toBe(false));
    // Its own message: the robot's state is why.
    expect(getToasts().map((t) => t.description)).toContain(
      'The robot balances with arm control on. The operator can take control in the headset now.',
    );
    expect(screen.queryByTestId('setup-lease-held')).toBeNull();
    // Step 4 is next, and no Release is left anywhere.
    expect(screen.getByTestId('setup-step-quest')).toHaveAttribute('data-state', 'current');
  });

  it('does not take back a lease taken again after the robot balances, and lights Release in step 4', async () => {
    h.mode = 'balance';
    render();
    await waitFor(() => expect(screen.getByTestId('setup-step-quest')).toHaveAttribute('data-state', 'current'));
    fireEvent.click(screen.getByTestId('setup-step-stance-toggle'));
    const stance = screen.getByTestId('setup-step-stance');
    fireEvent.click(within(stance).getByTestId('robot-mode-take-control'));
    await waitFor(() => expect(h.acquire).toHaveBeenCalledTimes(1));
    rerender();
    expect(h.release).not.toHaveBeenCalled();

    // Back on step 4, the current one: the held lease is its lit action.
    fireEvent.click(screen.getByTestId('setup-step-quest-toggle'));
    const quest = screen.getByTestId('setup-step-quest');
    await waitFor(() => expect(within(quest).getByTestId('setup-lease-held')).toBeInTheDocument());
    const release = within(quest).getByTestId('setup-lease-release');
    expect(release.className).toMatch(/(^| )bg-primary( |$)/);
    fireEvent.click(release);
    expect(h.release).toHaveBeenCalledTimes(1);
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

  it('hands over when this page opens its own VR window, though the robot balanced long before, and says so', async () => {
    // Balancing with arm control on: the balance trigger fired (and found nothing to release) long ago.
    h.mode = 'balance';
    render();
    await waitFor(() => expect(screen.getByTestId('setup-step-quest')).toHaveAttribute('data-state', 'current'));
    // The assistant takes control again on purpose: it stays theirs.
    fireEvent.click(screen.getByTestId('setup-step-stance-toggle'));
    fireEvent.click(within(screen.getByTestId('setup-step-stance')).getByTestId('robot-mode-take-control'));
    await waitFor(() => expect(h.acquire).toHaveBeenCalledTimes(1));
    rerender();
    expect(h.release).not.toHaveBeenCalled();

    // Opening the VR window on this browser is its own rising edge.
    fireEvent.click(screen.getByTestId('session-tools-toggle'));
    fireEvent.click(screen.getByTestId('vr-launch'));
    await waitFor(() => expect(h.release).toHaveBeenCalledTimes(1));
    const said = getToasts().map((t) => t.description);
    expect(said).toContain('The VR window on this browser takes control itself.');
    // Not the balance message: that is not why it happened.
    expect(said).not.toContain('The robot balances with arm control on. The operator can take control in the headset now.');
  });
});
