/**
 * @file SessionDetailPage.preflight.test.tsx
 * @description A created session shows the pre-flight checklist (TASK-392);
 *              an offline robot disables Start recording and its Space hotkey,
 *              a warning does not.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { confirm } from '@/shared/components/ui';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { useDataCollectionStore } from '../../store/datacollectionStore';
import { SessionDetailPage } from '../SessionDetailPage';
import type { TeleoperationSession } from '../../types/datacollection.types';

vi.mock('@/shared/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/components/ui')>()),
  confirm: vi.fn(),
}));
const confirmMock = vi.mocked(confirm);

vi.mock('../../hooks/useTeleopEvents', () => ({ useTeleopEvents: () => ({ isConnected: true }) }));
vi.mock('../../../robots/hooks/useTelemetryStream', () => ({
  useTelemetryStream: () => ({ telemetry: null, isConnected: telemetryConnected.value }),
}));
vi.mock('../../hooks/useSessionControlLease', () => ({
  useSessionControlLease: () => ({ lease: { enabled: false, state: 'observing', bindSocket: vi.fn() }, connected: false }),
}));
vi.mock('../../hooks/useGamepadJoints', () => ({ useGamepadJoints: () => undefined }));
vi.mock('../../../robots/hooks/useRobotCameras', () => ({
  useRobotCameras: () => ({ cameras: ['head_camera'], source: 'pc2cam', loading: false, refresh: vi.fn() }),
}));
vi.mock('../../components/CameraStreamView', () => ({
  CameraStreamView: ({ label }: { label: string }) => <div data-testid="camera">{label}</div>,
}));
vi.mock('../../../robots/components/visualization/Robot3DViewer', () => ({ Robot3DViewer: () => null }));
vi.mock('../../../robots/components/tabs/TeleopTab', () => ({ KeyboardTeleopSection: () => null }));

const telemetryConnected = vi.hoisted(() => ({ value: true }));

const session: TeleoperationSession = {
  id: 'sess-1', operatorId: 'u', robotId: 'g1', type: 'keyboard_mouse', status: 'created',
  startedAt: null, endedAt: null, frameCount: 0, duration: null, fps: 10, languageInstr: 'Wave',
  qualityScore: null, exportedDatasetId: null, errorMessage: null, numEpisodes: 3, createdAt: 'x', updatedAt: 'x',
} as TeleoperationSession;

const startSession = vi.fn();

function setRobot(status: string) {
  useRobotsStore.setState({
    robots: [{ id: 'g1', name: 'G1 EDU', model: 'Unitree G1', status, batteryLevel: 80, location: { x: 0, y: 0, zone: '' }, lastSeen: 'x', capabilities: [], createdAt: 'x', updatedAt: 'x' } as never],
    fetchRobots: vi.fn().mockResolvedValue(undefined) as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  telemetryConnected.value = true;
  confirmMock.mockResolvedValue(false);
  useDataCollectionStore.setState({
    sessions: [session],
    selectedSession: session,
    episodes: [],
    startSession: startSession as never,
    fetchSession: vi.fn().mockResolvedValue(undefined) as never,
    fetchEpisodes: vi.fn().mockResolvedValue(undefined) as never,
  });
});

const render = () => renderWithProviders(
  <Routes><Route path="/data-collection/:sessionId" element={<SessionDetailPage />} /></Routes>,
  { routerEntries: ['/data-collection/sess-1'] },
);

describe('SessionDetailPage pre-flight', () => {
  it('blocks Start recording and the Space hotkey while the robot is offline', async () => {
    setRobot('offline');
    render();
    expect(await screen.findByTestId('preflight')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-robot')).toHaveAttribute('data-level', 'blocking');
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
    fireEvent.keyDown(window, { code: 'Space' });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('lets a warning through: Start stays enabled and Space asks to start', async () => {
    telemetryConnected.value = false;
    setRobot('online');
    render();
    expect(await screen.findByTestId('preflight-recorder')).toHaveAttribute('data-level', 'warning');
    expect(screen.getByTestId('preflight-camera')).toHaveTextContent('head_camera (pc2cam)');
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled();
    fireEvent.keyDown(window, { code: 'Space' });
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('shows the cameras the robot serves', async () => {
    setRobot('online');
    render();
    expect(await screen.findByText('Head camera')).toBeInTheDocument();
    expect(screen.queryByText('Top camera')).not.toBeInTheDocument();
  });
});
