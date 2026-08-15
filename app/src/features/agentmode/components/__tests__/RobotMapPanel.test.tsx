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
import { RobotMapPanel, drawMap, mapFooterText } from '../RobotMapPanel';
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

  it('names the navigator\'s route when one is running (TASK-208)', () => {
    const nav = { target: 'table', planned: true, path: [[0, 0], [2, 0]] as Array<[number, number]>, goal: { x: 3, y: 0 }, lengthM: 2.4, segments: 1, reason: null, updatedAt: '' };
    expect(mapFooterText(payload({ nav }), null)).toContain('→ table: 2.4 m planned');
    expect(mapFooterText(payload({ nav: { ...nav, planned: false, path: null, lengthM: null, segments: 0, reason: 'no map' } }), null)).toContain(
      '→ table: by sight',
    );
    expect(mapFooterText(payload({ nav: null }), null)).not.toContain('→');
  });
});

/** A recording 2D context: enough of the API for drawMap, and a log of the calls that matter. */
function recordingContext() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const noop = () => {};
  const rec = (op: string) => (...args: unknown[]) => calls.push({ op, args });
  const ctx = {
    calls,
    clearRect: noop, save: noop, restore: noop, translate: noop, scale: noop, rotate: noop,
    beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'), closePath: noop,
    arc: rec('arc'), fill: noop, stroke: rec('stroke'), setLineDash: rec('setLineDash'), fillText: rec('fillText'),
    drawImage: noop, measureText: () => ({ width: 10 }),
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', strokeStyle: '', fillStyle: '', font: '', textAlign: '', textBaseline: '', imageSmoothingEnabled: true,
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: typeof calls };
}

describe('drawMap — the planned route (TASK-208)', () => {
  const view = { widthPx: 300, heightPx: 300, rangeM: 3, orientation: 'north' as const, occupiedColor: '#000' };

  it('draws the polyline through every waypoint and a ring on the goal when planned', () => {
    const ctx = recordingContext();
    const nav = { target: 'table', planned: true, path: [[0, 0], [1, 0.5], [2, 0.5]] as Array<[number, number]>, goal: { x: 2.8, y: 0.5 }, lengthM: 2.1, segments: 2, reason: null, updatedAt: '' };
    drawMap(ctx, payload({ nav, keepouts: [], peers: [] }), view, null);
    const lineTos = ctx.calls.filter((c) => c.op === 'lineTo').map((c) => c.args);
    expect(lineTos).toEqual(expect.arrayContaining([[1, 0.5], [2, 0.5]]));
    const arcs = ctx.calls.filter((c) => c.op === 'arc').map((c) => c.args.slice(0, 3));
    expect(arcs).toEqual(expect.arrayContaining([[2.8, 0.5, 0.15]]));
  });

  it('draws no route line by sight — only the goal ring, and nothing at all with no navigation', () => {
    const ctx = recordingContext();
    const nav = { target: 'table', planned: false, path: null, goal: { x: 2.8, y: 0.5 }, lengthM: null, segments: 0, reason: 'no map', updatedAt: '' };
    drawMap(ctx, payload({ nav, keepouts: [], peers: [] }), view, null);
    // The self triangle, scale bar and north arrow use lineTo too; the route would add its waypoints.
    const base = recordingContext();
    drawMap(base, payload({ nav: null, keepouts: [], peers: [] }), view, null);
    expect(ctx.calls.filter((c) => c.op === 'lineTo')).toHaveLength(base.calls.filter((c) => c.op === 'lineTo').length);
    expect(ctx.calls.filter((c) => c.op === 'arc').map((c) => c.args.slice(0, 3))).toEqual([[2.8, 0.5, 0.15]]);

    const none = recordingContext();
    drawMap(none, payload({ nav: null, keepouts: [], peers: [] }), view, null);
    expect(none.calls.filter((c) => c.op === 'arc')).toHaveLength(0);
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
