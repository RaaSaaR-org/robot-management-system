/**
 * @file RobotMapPanel.test.tsx
 * @description The robot's map on the Agent Mode page (TASK-207): renders the
 *              canvas, footer and peer count from the store; says "does not
 *              publish a map" for a robot that answered 404 and "unavailable"
 *              for one that did not answer — two sentences, never one blank
 *              canvas; polls only while mounted; keeps a stale map and marks it.
 * @feature agentmode
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RobotMapPanel, mapFooterText } from '../RobotMapPanel';
import { KnowledgePanel } from '../KnowledgePanel';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type { RobotMapPayload } from '../../types/agentmode.types';

const GRID = {
  version: 1 as const,
  frame: 'odom' as const,
  frameId: 'boot',
  resolution: 0.1,
  originX: -1,
  originY: -1,
  width: 2,
  height: 2,
  encoding: 'int8-logodds-b64' as const,
  cells: btoa(String.fromCharCode(0, 127, 0, 0)),
  occupiedAbove: 1.2,
  freeBelow: -1.2,
  poseCount: 3,
  lastIntegratedAt: new Date().toISOString(),
  knownCells: 1,
  occupiedCells: 1,
};

const payload = (over: Partial<RobotMapPayload> = {}): RobotMapPayload => ({
  ok: true,
  frame: 'odom',
  frameId: { kind: 'sim', id: 'room' },
  grid: GRID,
  pose: { x: 0, y: 0, yawDeg: 0, source: 'sim', atMs: Date.now() },
  place: null,
  registered: true,
  registrationReason: null,
  keepouts: [{ id: 'TABLE', name: 'Table', polygon: [[1, 0], [2, 0], [2, 1], [1, 1]] }],
  peers: [
    { robotId: 'b', name: 'Bravo', x: 2, y: 0, headingDeg: 90, footprintRadiusM: 0.35, place: null, updatedAt: null },
  ],
  peersDropped: 1,
  peersEnabled: true,
  ...over,
});

beforeEach(() => {
  useAgentModeStore.getState().reset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('mapFooterText', () => {
  it('states frame, peers, dropped and scan age', () => {
    expect(mapFooterText(payload(), null)).toMatch(/^frame: sim · 1 peer · 1 dropped \(different frame\) · scan/);
    expect(mapFooterText(payload({ peersEnabled: false, peersDropped: 0, grid: null }), null)).toBe(
      'frame: sim · peers off · no scan yet',
    );
    expect(mapFooterText(null, null)).toBe('');
  });
});

describe('RobotMapPanel', () => {
  it('polls the map while mounted and stops on unmount', async () => {
    const fetchRobotMap = vi.fn(async () => {});
    useAgentModeStore.setState({ fetchRobotMap });
    const { unmount } = render(<RobotMapPanel robotId="r1" pollMs={1000} />);
    expect(fetchRobotMap).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2050);
    });
    expect(fetchRobotMap).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchRobotMap).toHaveBeenCalledTimes(3);
  });

  it('renders the canvas, footer and unregistered hint from the store', () => {
    useAgentModeStore.setState({
      fetchRobotMap: async () => {},
      robotMap: payload({ registered: false, registrationReason: 'sim frame — no survey' }),
      robotMapStatus: 'ok',
      robotMapFetchedAt: new Date().toISOString(),
    });
    render(<RobotMapPanel robotId="r1" />);
    expect(screen.getByTestId('agent-map-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('agent-map-footer')).toHaveTextContent('1 peer · 1 dropped (different frame)');
    expect(screen.getByTestId('agent-map-unregistered')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-map-empty')).toBeNull();
  });

  it('says the robot does not publish a map on a 404 — no canvas', () => {
    useAgentModeStore.setState({
      fetchRobotMap: async () => {},
      robotMap: null,
      robotMapStatus: 'disabled',
      robotMapError: 'occupancy map is disabled on this agent (AGENT_MAP_ENABLED)',
    });
    render(<RobotMapPanel robotId="r1" />);
    expect(screen.getByTestId('agent-map-empty')).toHaveTextContent('does not publish a map (AGENT_MAP_ENABLED)');
    expect(screen.queryByTestId('agent-map-canvas')).toBeNull();
  });

  it('says unavailable when the robot could not be asked and no map is held', () => {
    useAgentModeStore.setState({
      fetchRobotMap: async () => {},
      robotMap: null,
      robotMapStatus: 'unavailable',
      robotMapError: 'ECONNREFUSED',
    });
    render(<RobotMapPanel robotId="r1" />);
    expect(screen.getByTestId('agent-map-empty')).toHaveTextContent('Map unavailable: ECONNREFUSED');
  });

  it('keeps the last map when a later read fails, and marks it stale', () => {
    useAgentModeStore.setState({
      fetchRobotMap: async () => {},
      robotMap: payload(),
      robotMapStatus: 'unavailable',
      robotMapError: 'timeout',
      robotMapFetchedAt: new Date().toISOString(),
    });
    render(<RobotMapPanel robotId="r1" />);
    expect(screen.getByTestId('agent-map-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('agent-map-footer')).toHaveTextContent('stale');
  });

  it('says "no scan yet" over an empty grid instead of a blank canvas', () => {
    useAgentModeStore.setState({
      fetchRobotMap: async () => {},
      robotMap: payload({ grid: null, peers: [], peersDropped: 0 }),
      robotMapStatus: 'ok',
    });
    render(<RobotMapPanel robotId="r1" />);
    expect(screen.getByTestId('agent-map-empty')).toHaveTextContent('No scan integrated yet');
    expect(screen.getByTestId('agent-map-footer')).toHaveTextContent('no scan yet');
  });
});

describe('KnowledgePanel map tab', () => {
  it('opens on the Map tab when asked and shows the peer count', () => {
    useAgentModeStore.setState({
      fetchRobotMap: async () => {},
      robotMap: payload(),
      robotMapStatus: 'ok',
    });
    render(<KnowledgePanel robotId="r1" initialTab="map" />);
    expect(screen.getByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getByTestId('agent-map-panel')).toBeInTheDocument();
    expect(screen.getByText('1 peer')).toBeInTheDocument();
  });

  it('defaults to Scene, where the map panel is not mounted (and so not polling)', () => {
    const fetchRobotMap = vi.fn(async () => {});
    useAgentModeStore.setState({ fetchRobotMap });
    render(<KnowledgePanel robotId="r1" />);
    expect(screen.getByRole('region', { name: 'Scene' })).toBeInTheDocument();
    expect(screen.queryByTestId('agent-map-panel')).toBeNull();
    expect(fetchRobotMap).not.toHaveBeenCalled();
  });
});
