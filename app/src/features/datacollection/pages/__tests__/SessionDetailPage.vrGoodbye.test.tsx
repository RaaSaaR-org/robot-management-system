/**
 * @file SessionDetailPage.vrGoodbye.test.tsx
 * @description TASK-418 (D4): when the session ends while the page's VR modal
 *              is open, the VR panel (and with it the modal and the immersive
 *              session) stays mounted for VR_GOODBYE_MS, then goes as before.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import { useDataCollectionStore } from '../../store/datacollectionStore';
import { SessionDetailPage, VR_GOODBYE_MS, endsUnderVr } from '../SessionDetailPage';
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

const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../components/VRSessionPanel', () => ({
  VRSessionPanel: ({ onVrOpenChange }: { onVrOpenChange?: (open: boolean) => void }) => {
    // The wearer's page: the VR modal is open from the start.
    useEffect(() => {
      mounts.count += 1;
      onVrOpenChange?.(true);
      return () => onVrOpenChange?.(false);
    }, [onVrOpenChange]);
    return <div data-testid="vr-session-panel" />;
  },
}));

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

describe('endsUnderVr', () => {
  it('is a live → ended transition under an open VR modal only', () => {
    expect(endsUnderVr('recording', 'completed', true)).toBe(true);
    expect(endsUnderVr('paused', 'failed', true)).toBe(true);
    expect(endsUnderVr('recording', 'completed', false)).toBe(false);
    expect(endsUnderVr(undefined, 'completed', true)).toBe(false);
    expect(endsUnderVr('completed', 'completed', true)).toBe(false);
  });
});

describe('SessionDetailPage VR goodbye (TASK-418 D4)', () => {
  it('keeps the VR panel mounted for 5 s after the session ends, then unmounts it', async () => {
    render();
    expect(await screen.findByTestId('vr-session-panel')).toBeInTheDocument();
    const mountedBefore = mounts.count;
    vi.useFakeTimers();
    try {
      act(() => {
        useDataCollectionStore.setState({ selectedSession: { ...session, status: 'completed', frameCount: 1523 } });
      });
      // The very commit that shows the session ended still has the VR panel —
      // the SAME one: an unmount and remount would have ended the immersive session.
      expect(screen.getByTestId('vr-session-panel')).toBeInTheDocument();
      expect(mounts.count).toBe(mountedBefore);
      act(() => { vi.advanceTimersByTime(VR_GOODBYE_MS - 100); });
      expect(screen.getByTestId('vr-session-panel')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByTestId('vr-session-panel')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
