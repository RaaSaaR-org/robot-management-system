/**
 * @file SessionDetailPage.vrLease.test.tsx
 * @description A VR session has one "Take control", in the VR window
 *              (TASK-396): without "Simulate VR input" the page holds no
 *              lease and shows no Control panel; with it on, the page's lease
 *              comes up and "Launch VR" is disabled.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { useDataCollectionStore } from '../../store/datacollectionStore';
import { SessionDetailPage } from '../SessionDetailPage';
import type { TeleoperationSession } from '../../types/datacollection.types';

const leaseCalls = vi.hoisted(() => ({ active: [] as boolean[] }));

vi.mock('../../hooks/useTeleopEvents', () => ({ useTeleopEvents: () => ({ isConnected: true }) }));
vi.mock('../../../robots/hooks/useTelemetryStream', () => ({
  useTelemetryStream: () => ({ telemetry: null, isConnected: true }),
}));
vi.mock('../../hooks/useSessionControlLease', () => ({
  useSessionControlLease: (_robotId: string, _url: string | undefined, active: boolean) => {
    leaseCalls.active.push(active);
    return {
      lease: { enabled: true, state: 'observing', bindSocket: vi.fn(), acquire: vi.fn(), release: vi.fn() },
      connected: true,
    };
  },
}));
vi.mock('../../../robots/components/tabs/ControlLeaseBar', () => ({
  ControlLeaseBar: () => <div data-testid="lease-bar" />,
}));
vi.mock('../../hooks/useSimulatedVrInput', () => ({ useSimulatedVrInput: () => 'awaiting_control' }));
vi.mock('../../hooks/useGamepadJoints', () => ({ useGamepadJoints: () => undefined }));
vi.mock('../../../robots/hooks/useRobotCameras', () => ({
  useRobotCameras: () => ({ cameras: ['head_camera'], source: 'pc2cam', loading: false, refresh: vi.fn() }),
}));
vi.mock('../../components/CameraStreamView', () => ({ CameraStreamView: () => null }));
vi.mock('../../../robots/components/visualization/Robot3DViewer', () => ({ Robot3DViewer: () => null }));
vi.mock('../../../robots/components/tabs/TeleopTab', () => ({ KeyboardTeleopSection: () => null }));
vi.mock('../../../robots/components/tabs/vr/VRTeleopModal', () => ({ VRTeleopModalBody: () => null }));

const session = {
  id: 'sess-vr', operatorId: 'u', robotId: 'g1', type: 'vr_quest', status: 'recording',
  startedAt: 'x', endedAt: null, frameCount: 0, duration: null, fps: 10, languageInstr: 'Pick',
  qualityScore: null, exportedDatasetId: null, errorMessage: null, numEpisodes: 3, createdAt: 'x', updatedAt: 'x',
} as TeleoperationSession;

beforeEach(() => {
  leaseCalls.active = [];
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
  { routerEntries: ['/data-collection/sess-vr'] },
);

describe('SessionDetailPage control lease in a VR session', () => {
  it('holds no page lease and shows no Control panel while the headset path is in use', async () => {
    render();
    expect(await screen.findByTestId('vr-session-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('session-control-lease')).not.toBeInTheDocument();
    expect(leaseCalls.active.length).toBeGreaterThan(0);
    expect(leaseCalls.active.every((a) => a === false)).toBe(true);
    expect(screen.getByTestId('vr-launch')).toBeEnabled();
  });

  it('takes the page lease for simulated input and closes the headset path', async () => {
    render();
    fireEvent.click(await screen.findByTestId('simulate-vr-toggle'));
    expect(await screen.findByTestId('session-control-lease')).toBeInTheDocument();
    expect(leaseCalls.active[leaseCalls.active.length - 1]).toBe(true);
    expect(screen.getByTestId('vr-launch')).toBeDisabled();
    expect(screen.getByTestId('vr-launch-hint')).toHaveTextContent(/Switch it off to use a headset/);

    fireEvent.click(screen.getByTestId('simulate-vr-toggle'));
    expect(screen.queryByTestId('session-control-lease')).not.toBeInTheDocument();
    expect(leaseCalls.active[leaseCalls.active.length - 1]).toBe(false);
  });
});
