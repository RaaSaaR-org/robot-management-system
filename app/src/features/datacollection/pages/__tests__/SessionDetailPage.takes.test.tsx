/**
 * @file SessionDetailPage.takes.test.tsx
 * @description The session page with explicit takes (TASK-410): the E-STOP
 *              is in the header in every session state and stops the robot;
 *              a recording session with takes offers Start take (no Pause);
 *              the HUD reads the live take; E still ends through a confirm,
 *              and opens no second End while one is pending (TASK-450).
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { confirm } from '@/shared/components/ui';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { useDataCollectionStore } from '../../store/datacollectionStore';
import { SessionDetailPage } from '../SessionDetailPage';
import type { LiveState, TeleoperationSession, TeleoperationStatus } from '../../types/datacollection.types';

vi.mock('@/shared/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/components/ui')>()),
  confirm: vi.fn(),
}));
vi.mock('../../../safety/api/safetyApi', () => ({ triggerRobotEStop: vi.fn().mockResolvedValue({}) }));
vi.mock('../../hooks/useTeleopEvents', () => ({ useTeleopEvents: () => ({ isConnected: true }) }));
vi.mock('../../../robots/hooks/useTelemetryStream', () => ({ useTelemetryStream: () => ({ telemetry: null, isConnected: false }) }));
vi.mock('../../hooks/useSessionControlLease', () => ({
  useSessionControlLease: () => ({ lease: { enabled: false, state: 'observing', bindSocket: vi.fn() }, connected: false }),
}));
vi.mock('../../hooks/useGamepadJoints', () => ({ useGamepadJoints: () => undefined }));
vi.mock('../../../robots/hooks/useRobotCameras', () => ({
  useRobotCameras: () => ({ cameras: [], source: null, loading: false, refresh: vi.fn() }),
}));
vi.mock('../../components/CameraStreamView', () => ({ CameraStreamView: () => null }));
vi.mock('../../../robots/components/visualization/Robot3DViewer', () => ({ Robot3DViewer: () => null }));
vi.mock('../../../robots/components/tabs/TeleopTab', () => ({ KeyboardTeleopSection: () => null }));

import { triggerRobotEStop } from '../../../safety/api/safetyApi';
const confirmMock = vi.mocked(confirm);

const base = {
  id: 'sess-1', operatorId: 'u', robotId: 'g1', type: 'keyboard_mouse', status: 'recording',
  startedAt: '2026-10-17T12:00:00.000Z', endedAt: null, frameCount: 0, duration: null, fps: 30, languageInstr: 'Wave',
  qualityScore: null, exportedDatasetId: null, errorMessage: null, createdAt: 'x', updatedAt: 'x',
} as TeleoperationSession;

function live(over: Partial<LiveState> = {}): LiveState {
  return {
    sessionId: 'sess-1', status: 'recording', phase: 'between', take: null, takeStartedAt: null, takeElapsedS: null,
    takeFrames: 0, totalFrames: 0, kept: 0, discarded: 0, fpsTarget: 30, fpsActual: 30, degraded: false,
    lastDropReason: null, elapsedS: 5, autoStopS: null, lastTake: null, at: new Date().toISOString(), ...over,
  };
}

const startTake = vi.fn().mockResolvedValue(true);
const endSession = vi.fn().mockResolvedValue(undefined);

function setup(status: TeleoperationStatus, liveState: LiveState | null = null) {
  const session = { ...base, status };
  useDataCollectionStore.setState({
    sessions: [session],
    selectedSession: session,
    episodes: [],
    live: liveState,
    lastQuickCheck: null,
    startTake: startTake as never,
    endSession: endSession as never,
    fetchSession: vi.fn().mockResolvedValue(undefined) as never,
    fetchEpisodes: vi.fn().mockResolvedValue(undefined) as never,
    fetchLive: vi.fn().mockResolvedValue(undefined) as never,
  });
  return renderWithProviders(
    <Routes><Route path="/data-collection/:sessionId" element={<SessionDetailPage />} /></Routes>,
    { routerEntries: ['/data-collection/sess-1'] },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(false);
  useRobotsStore.setState({
    robots: [{ id: 'g1', name: 'G1 EDU', model: 'Unitree G1', status: 'online', batteryLevel: 80, location: { x: 0, y: 0, zone: '' }, lastSeen: 'x', capabilities: [], createdAt: 'x', updatedAt: 'x' } as never],
    fetchRobots: vi.fn().mockResolvedValue(undefined) as never,
  });
});

describe('SessionDetailPage E-STOP', () => {
  it.each<TeleoperationStatus>(['created', 'recording', 'paused', 'completed', 'failed'])(
    'is in the header of a %s session and stops the robot',
    async (status) => {
      setup(status, status === 'recording' ? live() : null);
      const button = await screen.findByTestId('session-estop');
      expect(button).toBeVisible();
      fireEvent.click(button);
      await waitFor(() => expect(triggerRobotEStop).toHaveBeenCalledWith('g1', expect.anything()));
    },
  );
});

describe('SessionDetailPage takes', () => {
  it('a recording session with takes is Ready, offers Start take and no Pause', async () => {
    setup('recording', live());
    expect(await screen.findByTestId('hud-phase')).toHaveTextContent('READY');
    expect(screen.getByTestId('hud-take')).toHaveTextContent('Take 1');
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByTestId('take-primary'));
    expect(startTake).toHaveBeenCalledWith('sess-1', 'desktop');
  });

  it('Space starts a take', async () => {
    setup('recording', live());
    await screen.findByTestId('take-primary');
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(startTake).toHaveBeenCalledTimes(1);
  });

  it('reads ● REC with the live take', async () => {
    setup('recording', live({ phase: 'capturing', take: 2, takeStartedAt: new Date().toISOString() }));
    expect(await screen.findByTestId('hud-phase')).toHaveTextContent('● REC');
    expect(screen.getByTestId('hud-take')).toHaveTextContent('Take 3');
    expect(screen.getByTestId('take-primary')).toHaveTextContent('Stop take');
  });

  it('a recorder without explicit takes keeps Pause', async () => {
    setup('recording', live({ phase: null }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('E still ends the session through a confirm', async () => {
    confirmMock.mockResolvedValue(true);
    setup('recording', live());
    await screen.findByTestId('take-primary');
    fireEvent.keyDown(window, { key: 'e' });
    await waitFor(() => expect(endSession).toHaveBeenCalledWith('sess-1'));
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'End this session?' }));
  });

  it('E opens no second End while the robot is still saving the takes (TASK-450)', async () => {
    confirmMock.mockResolvedValue(true);
    endSession.mockReturnValueOnce(new Promise(() => {}));
    setup('recording', live());
    await screen.findByTestId('take-primary');
    fireEvent.keyDown(window, { key: 'e' });
    await waitFor(() => expect(endSession).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(window, { key: 'e' });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledTimes(1);
  });
});
