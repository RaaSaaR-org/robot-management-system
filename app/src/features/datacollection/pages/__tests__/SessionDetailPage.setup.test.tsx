/**
 * @file SessionDetailPage.setup.test.tsx
 * @description Set up on a created VR session (TASK-427): the robot side is up
 *              read-only and the robot limp, so step 2 is current — open, with
 *              Take control as the page's one lit action. The read-only reason
 *              is said once, the Quest controls exist once (in step 4), step 3
 *              carries the mode buttons with one reason line, and Take control
 *              opens the page's lease only on the press.
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
    expect(within(stance).getByTestId('robot-mode-reasons')).toHaveTextContent(/^Take control in step 2 first\.$/);
    // The step's own next button is primary but disabled: nothing is lit.
    expect(litPrimaries()).toHaveLength(0);

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
