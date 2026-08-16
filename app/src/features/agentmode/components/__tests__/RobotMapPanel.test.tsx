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
import { render, screen, act, fireEvent } from '@testing-library/react';
import { RobotMapPanel, decodeGridToImage, drawMap, mapFooterText } from '../RobotMapPanel';
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

describe('decodeGridToImage', () => {
  it('returns null for a 0×0 grid instead of constructing an ImageData of width 0 (which throws in browsers)', () => {
    // Browsers throw IndexSizeError for `new ImageData(0, 0)`; jsdom has no ImageData at all.
    class ThrowingImageData {
      constructor(w: number, h: number) {
        if (!w || !h) throw new DOMException('The source width is zero or not a number.', 'IndexSizeError');
      }
    }
    vi.stubGlobal('ImageData', ThrowingImageData);
    try {
      const empty = { ...GRID, width: 0, height: 0, cells: '' };
      expect(decodeGridToImage(empty, [1, 2, 3])).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('mapFooterText', () => {
  it('states frame, peers, dropped and scan age', () => {
    expect(mapFooterText(payload(), null)).toMatch(/^frame: sim · 1 peer · 1 dropped \(different frame\) · scan/);
    expect(mapFooterText(payload({ peersEnabled: false, peersDropped: 0, grid: null }), null)).toBe(
      'frame: sim · peers off · no scan yet',
    );
    expect(mapFooterText(null, null)).toBe('');
  });

  /**
   * A robot with no sidecar (the default in-process sim) and a robot that just
   * lost its sidecar both report `frameId: null`. Printing "frame: odom" there
   * is byte-identical to a genuinely identified odom frame, and blaming the
   * dropped peers on a "different frame" points the operator at a mismatch on
   * the OTHER robot when the cause is that THIS one cannot say where it is.
   */
  it('says the frame is unknown — and why the peers are hidden — when the robot has no frame at all', () => {
    const noFrame = mapFooterText(payload({ frameId: null }), null);
    expect(noFrame).toMatch(/^frame: unknown · 1 peer · 1 dropped \(this robot has no odometry frame\)/);
    expect(noFrame).not.toContain('frame: odom');
    expect(noFrame).not.toContain('different frame');
    // With a frame, the mismatch really is the reason — unchanged.
    expect(mapFooterText(payload(), null)).toContain('1 dropped (different frame)');
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

describe('drawMap — the occupancy grid orientation (TASK-206/207)', () => {
  const view = { widthPx: 300, heightPx: 300, rangeM: 3, orientation: 'north' as const, occupiedColor: '#000' };

  /**
   * Cell index = row*width+col with row = floor((y-originY)/res): image row 0 is
   * the LOWEST world y. The outer world→screen transform already flips y (north
   * up), so the image is drawn straight at the grid origin. A second flip inside
   * that transform mirrored the whole grid top-to-bottom — walls the robot saw
   * to its north were painted to its south.
   */
  it('draws the grid image once, at the grid origin, without a second y-flip', () => {
    const ctx = recordingContext();
    const scales: unknown[][] = [];
    const draws: unknown[][] = [];
    (ctx as unknown as { scale: (...a: unknown[]) => void }).scale = (...a) => { scales.push(a); };
    (ctx as unknown as { drawImage: (...a: unknown[]) => void }).drawImage = (...a) => { draws.push(a); };
    const image = {} as HTMLCanvasElement;
    const grid = { ...GRID, originX: -1, originY: 2, width: 4, height: 3 };
    drawMap(ctx, payload({ grid, keepouts: [], peers: [] }), view, image);

    expect(draws).toEqual([[image, -1, 2, 4 * GRID.resolution, 3 * GRID.resolution]]);
    // Only the world→screen scale (px per metre, y flipped): no scale(1, -1).
    expect(scales.some(([sx, sy]) => sx === 1 && sy === -1)).toBe(false);
  });
});

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

  /**
   * The store routes the SERVER's 404 (no agent endpoint registered for this
   * robot) to `unavailable`, never to `disabled`, so the panel prints the
   * reason instead of asserting "This robot does not publish a map
   * (AGENT_MAP_ENABLED)" — a configuration claim it cannot know, and one that
   * sends the operator to check a flag that was never off.
   */
  it('never names AGENT_MAP_ENABLED when the server had no agent endpoint to ask', () => {
    useAgentModeStore.setState({
      fetchRobotMap: async () => {},
      robotMap: null,
      robotMapStatus: 'unavailable',
      robotMapError: 'the server has no agent endpoint registered for this robot',
    });
    render(<RobotMapPanel robotId="r1" />);
    const empty = screen.getByTestId('agent-map-empty');
    expect(empty).toHaveTextContent('Map unavailable: the server has no agent endpoint registered for this robot');
    expect(empty).not.toHaveTextContent('AGENT_MAP_ENABLED');
  });

  /**
   * The 1 Hz map poll keeps running under the 3-D view on purpose — the footer
   * and the peer count read that payload — but the canvas is unmounted, so
   * decoding every arriving grid was a full base64 pass plus one RGBA byte per
   * cell, every second, for a picture nobody could see.
   */
  it('stops decoding the occupancy grid while the 3-D view is showing', () => {
    let constructed = 0;
    class CountingImageData {
      data: Uint8ClampedArray;
      constructor(w: number, h: number) {
        constructed++;
        this.data = new Uint8ClampedArray(Math.max(1, w * h * 4));
      }
    }
    vi.stubGlobal('ImageData', CountingImageData);
    try {
      useAgentModeStore.setState({
        fetchRobotMap: async () => {},
        fetchRobotCloud: async () => {},
        robotMap: payload({ grid: { ...GRID } }),
        robotMapStatus: 'ok',
      });
      const { rerender } = render(<RobotMapPanel robotId="r1" pollMs={100000} />);
      expect(constructed).toBeGreaterThan(0);

      act(() => screen.getByRole('button', { name: '3D' }).click());
      const decodedSoFar = constructed;
      // A fresh grid object, as every poll delivers.
      act(() => {
        useAgentModeStore.setState({ robotMap: payload({ grid: { ...GRID } }) });
      });
      rerender(<RobotMapPanel robotId="r1" pollMs={100000} />);
      expect(constructed).toBe(decodedSoFar);

      // Back in 2-D the grid is decoded again — the picture must not go blank.
      act(() => screen.getByRole('button', { name: '2D' }).click());
      expect(constructed).toBeGreaterThan(decodedSoFar);
    } finally {
      vi.unstubAllGlobals();
    }
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

describe('RobotMapPanel export (TASK-210)', () => {
  it('offers PGM+YAML, PNG and JSON once a grid is held, and is disabled without one', () => {
    useAgentModeStore.setState({ fetchRobotMap: async () => {}, robotMap: payload({ grid: null }), robotMapStatus: 'ok' });
    const { unmount } = render(<RobotMapPanel robotId="r1" />);
    expect(screen.getByTestId('agent-map-export')).toBeDisabled();
    unmount();

    useAgentModeStore.setState({ robotMap: payload() });
    render(<RobotMapPanel robotId="r1" />);
    const btn = screen.getByTestId('agent-map-export');
    expect(btn).toBeEnabled();
    act(() => btn.click());
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual([
      'PGM + YAML (ROS map_server)',
      'PNG image',
      'JSON (raw grid)',
      'PCD (CloudCompare, Open3D, PCL)',
      'PLY (MeshLab, Blender)',
    ]);
    // No cloud has been read yet, and the 3-D entries do NOT wait for the 3-D
    // view: the export fetches the full cloud itself. Gating them here made a
    // working download look broken (live, with 32k points on the robot).
    expect(screen.getByRole('menuitem', { name: 'PCD (CloudCompare, Open3D, PCL)' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'PLY (MeshLab, Blender)' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'PGM + YAML (ROS map_server)' })).toBeEnabled();
  });

  it('switches to the 3-D view, which polls the cloud and reports the empty states (TASK-211)', async () => {
    const fetchRobotCloud = vi.fn(async () => {});
    useAgentModeStore.setState({ fetchRobotMap: async () => {}, fetchRobotCloud, robotMap: payload(), robotMapStatus: 'ok' });
    render(<RobotMapPanel robotId="r1" pollMs={100000} />);
    expect(screen.queryByTestId('agent-cloud-view')).toBeNull();
    act(() => screen.getByRole('button', { name: '3D' }).click());
    expect(fetchRobotCloud).toHaveBeenCalledWith('r1', 80000);
    expect(screen.getByTestId('agent-cloud-empty')).toHaveTextContent('Reading the robot’s cloud…');
    // Orientation and zoom belong to the 2-D canvas and leave with it.
    expect(screen.queryByTestId('agent-map-range')).toBeNull();
    act(() => {
      useAgentModeStore.setState({ robotCloudStatus: 'disabled', robotCloudError: 'world cloud is disabled on this agent (AGENT_CLOUD_ENABLED)' });
    });
    expect(screen.getByTestId('agent-cloud-empty')).toHaveTextContent('does not keep a point cloud (AGENT_CLOUD_ENABLED)');
    act(() => {
      useAgentModeStore.setState({ robotCloudStatus: 'disabled', robotCloudError: 'no cloud yet — nothing has been integrated' });
    });
    expect(screen.getByTestId('agent-cloud-empty')).toHaveTextContent('No cloud yet');
    act(() => {
      useAgentModeStore.setState({ robotCloudStatus: 'unavailable', robotCloudError: 'ECONNREFUSED' });
    });
    expect(screen.getByTestId('agent-cloud-empty')).toHaveTextContent('Cloud unavailable: ECONNREFUSED');
  });

  it('downloads the JSON grid from the menu', async () => {
    const saved: string[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    useAgentModeStore.setState({ fetchRobotMap: async () => {}, robotMap: payload(), robotMapStatus: 'ok' });
    render(<RobotMapPanel robotId="r1" />);
    act(() => screen.getByTestId('agent-map-export').click());
    await act(async () => {
      screen.getByRole('menuitem', { name: 'JSON (raw grid)' }).click();
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^map-r1-.*\.json$/);
    expect(screen.queryByTestId('agent-map-export-menu')).toBeNull();
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  /**
   * `role="menu"` promises the keyboard contract, and the menu implemented none
   * of it: focus never entered it, the arrows did nothing, and every close —
   * Escape or a chosen format — unmounted the focused item and dropped focus to
   * <body>, so the operator's next Tab restarted at the top of the page and
   * they had to tab through the whole toolbar again to take a second format.
   */
  it('moves focus into the menu, walks it with the arrows, and gives focus back to the trigger on Escape', () => {
    useAgentModeStore.setState({ fetchRobotMap: async () => {}, robotMap: payload(), robotMapStatus: 'ok' });
    render(<RobotMapPanel robotId="r1" />);
    const trigger = screen.getByTestId('agent-map-export');
    act(() => trigger.click());

    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    // Inside a menu Tab exits and the arrows move: every item is out of the tab ring.
    expect(items.every((el) => el.getAttribute('tabindex') === '-1')).toBe(true);

    const menu = screen.getByTestId('agent-map-export-menu');
    act(() => { fireEvent.keyDown(menu, { key: 'ArrowDown' }); });
    expect(document.activeElement).toBe(items[1]);
    act(() => { fireEvent.keyDown(menu, { key: 'End' }); });
    expect(document.activeElement).toBe(items[items.length - 1]);
    act(() => { fireEvent.keyDown(menu, { key: 'ArrowDown' }); }); // wraps to the top
    expect(document.activeElement).toBe(items[0]);
    act(() => { fireEvent.keyDown(menu, { key: 'ArrowUp' }); }); // and back round the bottom
    expect(document.activeElement).toBe(items[items.length - 1]);
    act(() => { fireEvent.keyDown(menu, { key: 'Home' }); });
    expect(document.activeElement).toBe(items[0]);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByTestId('agent-map-export-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the Export button after a format is chosen, instead of dropping it to <body>', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    useAgentModeStore.setState({ fetchRobotMap: async () => {}, robotMap: payload(), robotMapStatus: 'ok' });
    render(<RobotMapPanel robotId="r1" />);
    const trigger = screen.getByTestId('agent-map-export');
    act(() => trigger.click());
    await act(async () => {
      screen.getByRole('menuitem', { name: 'JSON (raw grid)' }).click();
    });
    expect(screen.queryByTestId('agent-map-export-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('closes when focus leaves the menu — the outside-close listener was mousedown-only', () => {
    useAgentModeStore.setState({ fetchRobotMap: async () => {}, robotMap: payload(), robotMapStatus: 'ok' });
    render(<RobotMapPanel robotId="r1" />);
    act(() => screen.getByTestId('agent-map-export').click());
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => {
      fireEvent.focusOut(screen.getAllByRole('menuitem')[0], { relatedTarget: outside });
    });
    expect(screen.queryByTestId('agent-map-export-menu')).toBeNull();
    outside.remove();
  });

  it('closes the export menu on Escape and on a click outside it', () => {
    useAgentModeStore.setState({ fetchRobotMap: async () => {}, robotMap: payload(), robotMapStatus: 'ok' });
    render(<RobotMapPanel robotId="r1" />);
    act(() => screen.getByTestId('agent-map-export').click());
    expect(screen.getByTestId('agent-map-export-menu')).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByTestId('agent-map-export-menu')).toBeNull();

    act(() => screen.getByTestId('agent-map-export').click());
    expect(screen.getByTestId('agent-map-export-menu')).toBeInTheDocument();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(screen.queryByTestId('agent-map-export-menu')).toBeNull();
  });
});
