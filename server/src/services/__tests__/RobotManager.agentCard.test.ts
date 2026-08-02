/**
 * @file RobotManager.agentCard.test.ts
 * @description The fleet's other half of the identity-ownership decision
 *              (TASK-198): when a robot renames itself, refreshing its stored
 *              agent card must not be able to leave it with NO card.
 * @feature robots
 * @status test
 *
 * The bug this file pins down: the refresh used to `delete(previousName)` and
 * then `upsert()`. The delete destroyed the AgentCard row (and its uuid) first,
 * so a failing upsert left the robot cardless — permanently, because the
 * in-memory copy had already been reassigned to the live card and the next
 * health check therefore saw no diff and never retried.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { A2AAgentCard } from '../../types/index.js';

const httpGet = vi.fn();

vi.mock('../HttpClient.js', () => ({
  HTTP_TIMEOUTS: { SHORT: 5000, MEDIUM: 10000, LONG: 30000 },
  HttpClientError: class extends Error {},
  HttpClient: class {
    get = httpGet;
    post = vi.fn();
  },
}));

vi.mock('../A2AClient.js', () => ({
  agentCardResolver: { fetchAgentCard: vi.fn(), clearCache: vi.fn() },
}));

vi.mock('../ConversationManager.js', () => ({
  conversationManager: { registerAgent: vi.fn(), unregisterAgent: vi.fn() },
}));

vi.mock('../AlertService.js', () => ({
  alertService: {
    createRobotAlert: vi.fn().mockResolvedValue(undefined),
    resolveRobotStatusAlerts: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../repositories/index.js', () => ({
  robotRepository: {
    getAllRegisteredRobots: vi.fn(),
    getRegisteredRobot: vi.fn(),
    upsertWithRegistration: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    updateHealthCheck: vi.fn(),
  },
  agentRepository: {
    upsert: vi.fn(),
    upsertByRobotId: vi.fn(),
    delete: vi.fn(),
    deleteByRobotId: vi.fn(),
  },
}));

import { RobotManager } from '../RobotManager.js';
import type { Robot, RegisteredRobot } from '../RobotManager.js';
import { agentCardResolver as _agentCardResolver } from '../A2AClient.js';
import { robotRepository as _robotRepository, agentRepository as _agentRepository } from '../../repositories/index.js';

const agentCardResolver = vi.mocked(_agentCardResolver, true);
const robotRepository = vi.mocked(_robotRepository, true);
const agentRepository = vi.mocked(_agentRepository, true);

function makeRobot(): Robot {
  return {
    id: 'g1-edu-4-sim',
    name: 'G1-EDU-Bot',
    model: 'g1',
    status: 'online',
    batteryLevel: 90,
    location: { x: 0, y: 0, zone: 'Zone A' },
    lastSeen: new Date().toISOString(),
    capabilities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeCard(name: string): A2AAgentCard {
  return { name, description: 'agent', url: 'http://robot.local' } as A2AAgentCard;
}

function makeRegistered(card: A2AAgentCard): RegisteredRobot {
  return {
    robot: makeRobot(),
    endpoints: {
      robot: 'http://robot.local/api/v1/robot',
      command: 'http://robot.local/api/v1/command',
      telemetry: 'http://robot.local/api/v1/telemetry',
      telemetryWs: 'ws://robot.local/api/v1/telemetry/ws',
    },
    agentCard: card,
    baseUrl: 'http://robot.local',
    lastHealthCheck: new Date().toISOString(),
    isConnected: true,
  } as RegisteredRobot;
}

/** Run one health-check pass and let its promise chain settle. */
async function runOneHealthCheck(mgr: RobotManager): Promise<void> {
  mgr.startHealthChecks(1000);
  await vi.advanceTimersByTimeAsync(0);
  mgr.stopHealthChecks();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  httpGet
    .mockResolvedValue({ status: 'ok', robotStatus: 'online', batteryLevel: 90 });
  robotRepository.updateHealthCheck.mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RobotManager agent-card refresh (rename)', () => {
  it('renames the card in place, keyed on the robot — never deletes it first', async () => {
    const mgr = new RobotManager();
    const registered = makeRegistered(makeCard('G1-EDU-Bot Agent'));
    robotRepository.getAllRegisteredRobots.mockResolvedValue([registered]);
    await mgr.initialize();

    agentCardResolver.fetchAgentCard.mockResolvedValue(makeCard('Nova Agent'));
    agentRepository.upsertByRobotId.mockResolvedValue(makeCard('Nova Agent'));

    await runOneHealthCheck(mgr);

    // The destructive step is gone: nothing may delete the row (and its uuid)
    // that the following write is supposed to replace.
    expect(agentRepository.delete).not.toHaveBeenCalled();
    expect(agentRepository.deleteByRobotId).not.toHaveBeenCalled();
    expect(agentRepository.upsertByRobotId).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Nova Agent' }),
      'g1-edu-4-sim',
    );
  });

  it('retries on the next health check when the card write fails', async () => {
    const mgr = new RobotManager();
    const registered = makeRegistered(makeCard('G1-EDU-Bot Agent'));
    robotRepository.getAllRegisteredRobots.mockResolvedValue([registered]);
    await mgr.initialize();

    agentCardResolver.fetchAgentCard.mockResolvedValue(makeCard('Nova Agent'));
    agentRepository.upsertByRobotId.mockRejectedValueOnce(new Error('unique constraint'));

    await runOneHealthCheck(mgr);

    // The in-memory copy must still hold the OLD card: reassigning it before
    // the write succeeded is what made the failure permanent — the next pass
    // saw no diff and the robot stayed cardless forever.
    expect(registered.agentCard.name).toBe('G1-EDU-Bot Agent');

    agentRepository.upsertByRobotId.mockResolvedValue(makeCard('Nova Agent'));
    await runOneHealthCheck(mgr);

    expect(agentRepository.upsertByRobotId).toHaveBeenCalledTimes(2);
    expect(registered.agentCard.name).toBe('Nova Agent');
  });
});
