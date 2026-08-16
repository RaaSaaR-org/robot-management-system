/**
 * @file agentmodeStore.mapDiagnostics.test.ts
 * @description The map/cloud read paths of the Agent Mode store, where a wrong
 *              diagnosis costs an operator a trip to the robot: the SERVER's
 *              404 ("no agent endpoint registered for this robot") must never
 *              be reported as the ROBOT's 404 ("my map is switched off"), and
 *              an unchanged cloud must not be republished as a new object.
 * @feature agentmode
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentModeStore } from '../agentmodeStore';
import type { RobotCloudPayload, RobotMapPayload } from '../../types/agentmode.types';

vi.mock('../../api/agentmodeApi', () => ({
  agentmodeApi: {
    getMap: vi.fn(),
    getCloud: vi.fn(),
  },
}));

import { agentmodeApi } from '../../api/agentmodeApi';

const mockedApi = vi.mocked(agentmodeApi);
const ROBOT_ID = 'demo-g1-001';

/** The api client rejects with a plain object carrying the server's `code`. */
const apiError = (statusCode: number, message: string, code = 'ERR') => ({ code, message, statusCode });

const MAP: RobotMapPayload = {
  ok: true,
  frame: 'odom',
  frameId: { kind: 'sim', id: 'room' },
  grid: null,
  pose: null,
  place: null,
  registered: false,
  registrationReason: null,
  keepouts: [],
  peers: [],
  peersDropped: 0,
  peersEnabled: true,
};

const CLOUD: RobotCloudPayload = {
  ok: true,
  frame: 'odom',
  frameId: 'boot',
  voxelM: 0.05,
  pointCount: 2,
  returned: 2,
  encoding: 'f32-xyz-b64',
  positions: 'AAAAAAAAAAAAAAAA',
  frames: 7,
  lastIntegratedAt: '2026-01-01T00:00:00.000Z',
  pose: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAgentModeStore.getState().reset();
  useAgentModeStore.getState().selectRobot(ROBOT_ID);
});

describe('fetchRobotMap — whose 404 is it', () => {
  it('does not blame AGENT_MAP_ENABLED when the SERVER has no agent endpoint for this robot', async () => {
    // A robot row that exists in the fleet list (cloned tenant, seed, or an
    // agent that has not registered yet) makes the proxy answer 404
    // ROBOT_NOT_FOUND. Folded into "disabled", the panel told the operator
    // "This robot does not publish a map (AGENT_MAP_ENABLED)" — a false claim
    // about that robot's configuration that sends them to SSH in and check a
    // flag that was never off.
    mockedApi.getMap.mockRejectedValueOnce(apiError(404, 'Robot not found', 'ROBOT_NOT_FOUND'));
    await useAgentModeStore.getState().fetchRobotMap(ROBOT_ID);
    const s = useAgentModeStore.getState();
    expect(s.robotMapStatus).not.toBe('disabled');
    expect(s.robotMapStatus).toBe('unavailable');
    expect(s.robotMapError).toBe('the server has no agent endpoint registered for this robot');
  });

  it('still records the ROBOT’s own 404 as "disabled" — that one IS an answer', async () => {
    mockedApi.getMap.mockResolvedValueOnce(MAP);
    await useAgentModeStore.getState().fetchRobotMap(ROBOT_ID);
    mockedApi.getMap.mockRejectedValueOnce(apiError(404, 'occupancy map is disabled on this agent (AGENT_MAP_ENABLED)'));
    await useAgentModeStore.getState().fetchRobotMap(ROBOT_ID);
    const s = useAgentModeStore.getState();
    expect(s.robotMapStatus).toBe('disabled');
    expect(s.robotMap).toBeNull();
    expect(s.robotMapError).toContain('AGENT_MAP_ENABLED');
  });
});

describe('fetchRobotCloud', () => {
  it('does not blame AGENT_CLOUD_ENABLED when the SERVER has no agent endpoint for this robot', async () => {
    mockedApi.getCloud.mockRejectedValueOnce(apiError(404, 'Robot not found', 'ROBOT_NOT_FOUND'));
    await useAgentModeStore.getState().fetchRobotCloud(ROBOT_ID, 80_000);
    const s = useAgentModeStore.getState();
    expect(s.robotCloudStatus).toBe('unavailable');
    expect(s.robotCloudError).toBe('the server has no agent endpoint registered for this robot');
  });

  it('still records the ROBOT’s own 404 as "disabled"', async () => {
    mockedApi.getCloud.mockRejectedValueOnce(apiError(404, 'world cloud is disabled on this agent (AGENT_CLOUD_ENABLED)'));
    await useAgentModeStore.getState().fetchRobotCloud(ROBOT_ID, 80_000);
    expect(useAgentModeStore.getState().robotCloudStatus).toBe('disabled');
    expect(useAgentModeStore.getState().robotCloudError).toContain('AGENT_CLOUD_ENABLED');
  });

  it('keeps the cloud object identity when the robot integrated nothing since the last poll', async () => {
    // A fresh object every 3 s costs the 3-D view a ~1.3 MB base64 decode, two
    // ~1 MB typed arrays and a whole new three.js geometry — for identical
    // points. An idle robot must cost the browser nothing.
    mockedApi.getCloud.mockResolvedValueOnce({ ...CLOUD });
    await useAgentModeStore.getState().fetchRobotCloud(ROBOT_ID, 80_000);
    const first = useAgentModeStore.getState().robotCloud;
    expect(first).not.toBeNull();

    mockedApi.getCloud.mockResolvedValueOnce({ ...CLOUD });
    await useAgentModeStore.getState().fetchRobotCloud(ROBOT_ID, 80_000);
    expect(useAgentModeStore.getState().robotCloud).toBe(first);
    expect(useAgentModeStore.getState().robotCloudStatus).toBe('ok');

    // …but a cloud that actually grew replaces it.
    mockedApi.getCloud.mockResolvedValueOnce({ ...CLOUD, frames: 8, positions: 'AAAAAAAAAAAAAAAB' });
    await useAgentModeStore.getState().fetchRobotCloud(ROBOT_ID, 80_000);
    expect(useAgentModeStore.getState().robotCloud).not.toBe(first);
    expect(useAgentModeStore.getState().robotCloud?.frames).toBe(8);
  });

  it('clears "unavailable" on the next good poll even when the cloud is unchanged', async () => {
    mockedApi.getCloud.mockResolvedValueOnce({ ...CLOUD });
    await useAgentModeStore.getState().fetchRobotCloud(ROBOT_ID, 80_000);
    mockedApi.getCloud.mockRejectedValueOnce(apiError(502, 'ECONNREFUSED'));
    await useAgentModeStore.getState().fetchRobotCloud(ROBOT_ID, 80_000);
    expect(useAgentModeStore.getState().robotCloudStatus).toBe('unavailable');

    mockedApi.getCloud.mockResolvedValueOnce({ ...CLOUD });
    await useAgentModeStore.getState().fetchRobotCloud(ROBOT_ID, 80_000);
    expect(useAgentModeStore.getState().robotCloudStatus).toBe('ok');
    expect(useAgentModeStore.getState().robotCloudError).toBeNull();
  });
});
