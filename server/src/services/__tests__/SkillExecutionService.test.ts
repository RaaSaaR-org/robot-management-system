/**
 * @file SkillExecutionService.test.ts
 * @description Unit tests for SkillExecutionService — single-skill execution, skill-chain
 *              orchestration (retry/skip/abort strategies), precondition/postcondition checks,
 *              robot abort forwarding, and event subscriptions.
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillDefinition, Condition } from '../../types/vla.types.js';
import type {
  SkillChain,
  SkillChainStep,
  SkillExecutionResult,
} from '../../types/skill.types.js';
import type { RegisteredRobot, Robot } from '../RobotManager.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

// HttpClient is `new`-ed inside the service; share method mocks across instances.
const httpPost = vi.fn();
const httpGet = vi.fn();

vi.mock('../HttpClient.js', () => ({
  HTTP_TIMEOUTS: { SHORT: 5000 },
  HttpClient: class {
    post = httpPost;
    get = httpGet;
  },
}));

vi.mock('../../repositories/index.js', () => ({
  skillDefinitionRepository: { findById: vi.fn() },
  skillChainRepository: { findById: vi.fn() },
  modelVersionRepository: { findById: vi.fn() },
}));

vi.mock('../RobotManager.js', () => ({
  robotManager: {
    getRobot: vi.fn(),
    getRegisteredRobot: vi.fn(),
  },
}));

vi.mock('../SkillLibraryService.js', () => ({
  skillLibraryService: {
    checkRobotCompatibility: vi.fn(),
    validateParameters: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'exec-uuid-fixed'),
}));

// Retype mocked singletons so .mock* methods typecheck (vi.mocked returns the same object).
import {
  skillDefinitionRepository as _skillDefinitionRepository,
  skillChainRepository as _skillChainRepository,
  modelVersionRepository as _modelVersionRepository,
} from '../../repositories/index.js';
import { robotManager as _robotManager } from '../RobotManager.js';
import { skillLibraryService as _skillLibraryService } from '../SkillLibraryService.js';
import { skillExecutionService } from '../SkillExecutionService.js';

const skillDefinitionRepository = vi.mocked(_skillDefinitionRepository, true);
const skillChainRepository = vi.mocked(_skillChainRepository, true);
const modelVersionRepository = vi.mocked(_modelVersionRepository, true);
const robotManager = vi.mocked(_robotManager, true);
const skillLibraryService = vi.mocked(_skillLibraryService, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'r1',
    name: 'Robot One',
    model: 'so101',
    status: 'online',
    batteryLevel: 90,
    location: { zone: 'Zone A' } as Robot['location'],
    lastSeen: new Date().toISOString(),
    capabilities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRegistered(overrides: Partial<RegisteredRobot> = {}): RegisteredRobot {
  return {
    robot: makeRobot(),
    baseUrl: 'http://robot.local',
    isConnected: true,
    lastHealthCheck: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    endpoints: {} as RegisteredRobot['endpoints'],
    agentCard: {} as RegisteredRobot['agentCard'],
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: 'skill-1',
    name: 'Pick',
    version: '1.0.0',
    parametersSchema: {},
    defaultParameters: { speed: 5 },
    preconditions: [],
    postconditions: [],
    requiredCapabilities: [],
    maxRetries: 0,
    status: 'active' as SkillDefinition['status'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeChainStep(overrides: Partial<SkillChainStep> = {}): SkillChainStep {
  return {
    id: 'step-1',
    skillId: 'skill-1',
    order: 0,
    parameters: {},
    onFailure: 'abort',
    ...overrides,
  };
}

function makeChain(overrides: Partial<SkillChain> = {}): SkillChain {
  return {
    id: 'chain-1',
    name: 'My Chain',
    status: 'active',
    steps: [makeChainStep()],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const condition = (overrides: Partial<Condition> = {}): Condition => ({
  type: 'state',
  name: 'gripper_empty',
  check: 'gripper.empty == true',
  ...overrides,
});

// Default happy-path wiring; individual tests override as needed.
function wireHappyPath(): void {
  skillDefinitionRepository.findById.mockResolvedValue(makeSkill());
  robotManager.getRobot.mockResolvedValue(makeRobot());
  robotManager.getRegisteredRobot.mockResolvedValue(makeRegistered());
  skillLibraryService.checkRobotCompatibility.mockResolvedValue({
    robotId: 'r1',
    robotName: 'Robot One',
    robotType: 'so101',
    compatible: true,
    missingCapabilities: [],
    matchingCapabilities: [],
  });
  skillLibraryService.validateParameters.mockReturnValue({
    valid: true,
    errors: [],
    coercedParameters: { speed: 5 },
  });
  httpPost.mockResolvedValue({ status: 'completed', output: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  httpPost.mockReset();
  httpGet.mockReset();
});

// ===========================================================================
// initialize / isInitialized
// ===========================================================================

describe('initialize', () => {
  it('marks the service initialized', async () => {
    await skillExecutionService.initialize();
    expect(skillExecutionService.isInitialized()).toBe(true);
  });

  it('is idempotent when called twice', async () => {
    await skillExecutionService.initialize();
    await expect(skillExecutionService.initialize()).resolves.toBeUndefined();
    expect(skillExecutionService.isInitialized()).toBe(true);
  });
});

// ===========================================================================
// executeSkill
// ===========================================================================

describe('executeSkill', () => {
  it('returns failed when the skill is not found', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(null);

    const result = await skillExecutionService.executeSkill({
      skillId: 'missing',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Skill not found');
  });

  it('returns failed when the robot does not exist', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill());
    robotManager.getRobot.mockResolvedValue(undefined);

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'rX',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Robot not found');
  });

  it('returns failed when the robot is incompatible, listing missing capabilities', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill());
    robotManager.getRobot.mockResolvedValue(makeRobot());
    skillLibraryService.checkRobotCompatibility.mockResolvedValue({
      robotId: 'r1',
      robotName: 'Robot One',
      robotType: 'so101',
      compatible: false,
      missingCapabilities: ['gripper', 'camera'],
      matchingCapabilities: [],
    });

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('gripper, camera');
  });

  it('returns failed when parameter validation fails', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill());
    robotManager.getRobot.mockResolvedValue(makeRobot());
    skillLibraryService.checkRobotCompatibility.mockResolvedValue({
      robotId: 'r1',
      robotName: 'Robot One',
      robotType: 'so101',
      compatible: true,
      missingCapabilities: [],
      matchingCapabilities: [],
    });
    skillLibraryService.validateParameters.mockReturnValue({
      valid: false,
      errors: [{ path: ['speed'], message: 'speed must be a number', code: 'invalid_type' }],
    });

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('speed must be a number');
  });

  it('merges default parameters with request parameters', async () => {
    wireHappyPath();

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
      parameters: { force: 2 },
    });

    expect(result.status).toBe('completed');
    expect(result.parameters).toEqual({ speed: 5, force: 2 });
  });

  it('completes successfully and emits a completed event', async () => {
    wireHappyPath();
    httpPost.mockResolvedValue({ status: 'completed', output: { picked: true } });

    const events: string[] = [];
    const unsub = skillExecutionService.onSkillEvent((e) => events.push(e.type));

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
    });

    unsub();

    expect(result.status).toBe('completed');
    expect(result.output).toEqual({ picked: true });
    expect(events).toContain('skill:execution:started');
    expect(events).toContain('skill:execution:completed');
  });

  it('returns failed when the robot reports the skill did not complete', async () => {
    wireHappyPath();
    httpPost.mockResolvedValue({ status: 'error', error: 'gripper jammed' });

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('gripper jammed');
  });

  it('returns failed when the robot is not registered for execution', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill());
    robotManager.getRobot.mockResolvedValue(makeRobot());
    skillLibraryService.checkRobotCompatibility.mockResolvedValue({
      robotId: 'r1',
      robotName: 'Robot One',
      robotType: 'so101',
      compatible: true,
      missingCapabilities: [],
      matchingCapabilities: [],
    });
    skillLibraryService.validateParameters.mockReturnValue({
      valid: true,
      errors: [],
      coercedParameters: { speed: 5 },
    });
    // getRobot returns a robot but getRegisteredRobot (used inside executeSkillOnRobot) returns undefined
    robotManager.getRegisteredRobot.mockResolvedValue(undefined);

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Robot not registered with server');
  });

  it('fails the execution when a precondition does not pass', async () => {
    wireHappyPath();
    skillDefinitionRepository.findById.mockResolvedValue(
      makeSkill({ preconditions: [condition({ name: 'safe_zone' })] })
    );
    // condition check endpoint says not passed
    httpPost.mockImplementation(async (url: string) => {
      if (url.includes('/conditions/check')) return { passed: false };
      return { status: 'completed', output: {} };
    });

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Preconditions failed');
    expect(result.error).toContain('safe_zone');
    expect(result.preconditionResults).toHaveLength(1);
  });

  it('skips precondition checks when skipPreconditions is set', async () => {
    wireHappyPath();
    skillDefinitionRepository.findById.mockResolvedValue(
      makeSkill({ preconditions: [condition({ name: 'safe_zone' })] })
    );
    httpPost.mockResolvedValue({ status: 'completed', output: {} });

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
      skipPreconditions: true,
    });

    expect(result.status).toBe('completed');
    expect(result.preconditionResults).toEqual([]);
    // condition check endpoint must never be called
    expect(
      httpPost.mock.calls.some((c) => String(c[0]).includes('/conditions/check'))
    ).toBe(false);
  });

  it('fails when a postcondition does not pass', async () => {
    wireHappyPath();
    skillDefinitionRepository.findById.mockResolvedValue(
      makeSkill({ postconditions: [condition({ name: 'object_held' })] })
    );
    httpPost.mockImplementation(async (url: string) => {
      if (url.includes('/conditions/check')) return { passed: false };
      return { status: 'completed', output: { done: true } };
    });

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Postconditions failed');
    expect(result.error).toContain('object_held');
    expect(result.postconditionResults).toHaveLength(1);
  });

  it('treats a condition as passed (optimistically) when the robot cannot be checked', async () => {
    wireHappyPath();
    skillDefinitionRepository.findById.mockResolvedValue(
      makeSkill({ preconditions: [condition({ name: 'flaky' })] })
    );
    httpPost.mockImplementation(async (url: string) => {
      if (url.includes('/conditions/check')) throw new Error('not supported');
      return { status: 'completed', output: {} };
    });

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('completed');
    expect(result.preconditionResults?.[0].passed).toBe(true);
  });

  it('resolves artifactUri from the linked model version and forwards it to the robot', async () => {
    wireHappyPath();
    skillDefinitionRepository.findById.mockResolvedValue(
      makeSkill({ linkedModelVersionId: 'mv-1' })
    );
    modelVersionRepository.findById.mockResolvedValue({
      artifactUri: 's3://models/mv-1',
    } as never);

    await skillExecutionService.executeSkill({ skillId: 'skill-1', robotId: 'r1' });

    const execCall = httpPost.mock.calls.find((c) => String(c[0]).includes('/skills/execute'));
    expect(execCall).toBeDefined();
    expect((execCall?.[1] as Record<string, unknown>).artifactUri).toBe('s3://models/mv-1');
  });

  it('returns failed when the robot HTTP call throws', async () => {
    wireHappyPath();
    httpPost.mockRejectedValue(new Error('connection refused'));

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('connection refused');
  });
});

// ===========================================================================
// executeChain
// ===========================================================================

describe('executeChain', () => {
  it('returns failed when the chain is not found', async () => {
    skillChainRepository.findById.mockResolvedValue(null);

    const result = await skillExecutionService.executeChain({
      chainId: 'missing',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Skill chain not found');
    expect(result.stepResults).toEqual([]);
  });

  it('returns failed when the chain is not active', async () => {
    skillChainRepository.findById.mockResolvedValue(makeChain({ status: 'draft' }));

    const result = await skillExecutionService.executeChain({
      chainId: 'chain-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Chain is not active: draft');
  });

  it('returns failed when the robot does not exist', async () => {
    skillChainRepository.findById.mockResolvedValue(makeChain());
    robotManager.getRobot.mockResolvedValue(undefined);

    const result = await skillExecutionService.executeChain({
      chainId: 'chain-1',
      robotId: 'rX',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Robot not found');
  });

  it('executes all steps and completes, threading output into finalOutput', async () => {
    skillChainRepository.findById.mockResolvedValue(
      makeChain({
        steps: [
          makeChainStep({ id: 's0', order: 0, skillId: 'skill-1' }),
          makeChainStep({ id: 's1', order: 1, skillId: 'skill-2' }),
        ],
      })
    );
    robotManager.getRobot.mockResolvedValue(makeRobot());
    robotManager.getRegisteredRobot.mockResolvedValue(makeRegistered());
    skillLibraryService.checkRobotCompatibility.mockResolvedValue({
      robotId: 'r1',
      robotName: 'Robot One',
      robotType: 'so101',
      compatible: true,
      missingCapabilities: [],
      matchingCapabilities: [],
    });
    skillLibraryService.validateParameters.mockReturnValue({
      valid: true,
      errors: [],
      coercedParameters: {},
    });
    skillDefinitionRepository.findById.mockImplementation(async (id: string) =>
      makeSkill({ id })
    );
    httpPost.mockImplementation(async (url: string, body?: unknown) => {
      const skillId = (body as Record<string, unknown>)?.skillId;
      if (skillId === 'skill-1') return { status: 'completed', output: { firstResult: 1 } };
      return { status: 'completed', output: { secondResult: 2 } };
    });

    const result = await skillExecutionService.executeChain({
      chainId: 'chain-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('completed');
    expect(result.stepResults).toHaveLength(2);
    expect(result.finalOutput).toEqual({ firstResult: 1, secondResult: 2 });
  });

  it('aborts the chain on a failing step when onFailure is "abort"', async () => {
    skillChainRepository.findById.mockResolvedValue(
      makeChain({
        steps: [
          makeChainStep({ id: 's0', order: 0, skillId: 'skill-1', onFailure: 'abort' }),
          makeChainStep({ id: 's1', order: 1, skillId: 'skill-2', onFailure: 'abort' }),
        ],
      })
    );
    robotManager.getRobot.mockResolvedValue(makeRobot());
    robotManager.getRegisteredRobot.mockResolvedValue(makeRegistered());
    skillLibraryService.checkRobotCompatibility.mockResolvedValue({
      robotId: 'r1',
      robotName: 'Robot One',
      robotType: 'so101',
      compatible: true,
      missingCapabilities: [],
      matchingCapabilities: [],
    });
    skillLibraryService.validateParameters.mockReturnValue({
      valid: true,
      errors: [],
      coercedParameters: {},
    });
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill());
    httpPost.mockResolvedValue({ status: 'error', error: 'step failed' });

    const result = await skillExecutionService.executeChain({
      chainId: 'chain-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('failed');
    expect(result.failedAtStep).toBe(0);
    expect(result.stepResults).toHaveLength(1); // second step never ran
    expect(result.error).toContain('Step 0 failed');
  });

  it('skips a failing step and continues when onFailure is "skip"', async () => {
    skillChainRepository.findById.mockResolvedValue(
      makeChain({
        steps: [
          makeChainStep({ id: 's0', order: 0, skillId: 'skill-bad', onFailure: 'skip' }),
          makeChainStep({ id: 's1', order: 1, skillId: 'skill-good', onFailure: 'abort' }),
        ],
      })
    );
    robotManager.getRobot.mockResolvedValue(makeRobot());
    robotManager.getRegisteredRobot.mockResolvedValue(makeRegistered());
    skillLibraryService.checkRobotCompatibility.mockResolvedValue({
      robotId: 'r1',
      robotName: 'Robot One',
      robotType: 'so101',
      compatible: true,
      missingCapabilities: [],
      matchingCapabilities: [],
    });
    skillLibraryService.validateParameters.mockReturnValue({
      valid: true,
      errors: [],
      coercedParameters: {},
    });
    skillDefinitionRepository.findById.mockImplementation(async (id: string) =>
      makeSkill({ id })
    );
    httpPost.mockImplementation(async (_url: string, body?: unknown) => {
      const skillId = (body as Record<string, unknown>)?.skillId;
      if (skillId === 'skill-bad') return { status: 'error', error: 'boom' };
      return { status: 'completed', output: { ok: true } };
    });

    const result = await skillExecutionService.executeChain({
      chainId: 'chain-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('completed');
    expect(result.stepResults).toHaveLength(2);
    const first = result.stepResults[0].result as SkillExecutionResult;
    expect(first.status).toBe('failed');
    const second = result.stepResults[1].result as SkillExecutionResult;
    expect(second.status).toBe('completed');
  });

  it('retries a failing step up to maxRetries when onFailure is "retry"', async () => {
    skillChainRepository.findById.mockResolvedValue(
      makeChain({
        steps: [
          makeChainStep({
            id: 's0',
            order: 0,
            skillId: 'skill-1',
            onFailure: 'retry',
            maxRetries: 2,
          }),
        ],
      })
    );
    robotManager.getRobot.mockResolvedValue(makeRobot());
    robotManager.getRegisteredRobot.mockResolvedValue(makeRegistered());
    skillLibraryService.checkRobotCompatibility.mockResolvedValue({
      robotId: 'r1',
      robotName: 'Robot One',
      robotType: 'so101',
      compatible: true,
      missingCapabilities: [],
      matchingCapabilities: [],
    });
    skillLibraryService.validateParameters.mockReturnValue({
      valid: true,
      errors: [],
      coercedParameters: {},
    });
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill());

    // Fail twice, succeed on the third attempt.
    let attempts = 0;
    httpPost.mockImplementation(async () => {
      attempts++;
      if (attempts < 3) return { status: 'error', error: 'transient' };
      return { status: 'completed', output: { recovered: true } };
    });

    const result = await skillExecutionService.executeChain({
      chainId: 'chain-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('completed');
    expect(attempts).toBe(3);
    const step = result.stepResults[0].result as SkillExecutionResult;
    expect(step.retryCount).toBe(2);
  });

  it('honours startFromStep by skipping earlier steps', async () => {
    skillChainRepository.findById.mockResolvedValue(
      makeChain({
        steps: [
          makeChainStep({ id: 's0', order: 0, skillId: 'skill-1' }),
          makeChainStep({ id: 's1', order: 1, skillId: 'skill-2' }),
        ],
      })
    );
    robotManager.getRobot.mockResolvedValue(makeRobot());
    robotManager.getRegisteredRobot.mockResolvedValue(makeRegistered());
    skillLibraryService.checkRobotCompatibility.mockResolvedValue({
      robotId: 'r1',
      robotName: 'Robot One',
      robotType: 'so101',
      compatible: true,
      missingCapabilities: [],
      matchingCapabilities: [],
    });
    skillLibraryService.validateParameters.mockReturnValue({
      valid: true,
      errors: [],
      coercedParameters: {},
    });
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill());
    httpPost.mockResolvedValue({ status: 'completed', output: {} });

    const result = await skillExecutionService.executeChain({
      chainId: 'chain-1',
      robotId: 'r1',
      startFromStep: 1,
    });

    expect(result.status).toBe('completed');
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].stepOrder).toBe(1);
  });
});

// ===========================================================================
// cancelExecution
// ===========================================================================

describe('cancelExecution', () => {
  it('returns false for an unknown execution id', () => {
    expect(skillExecutionService.cancelExecution('nope')).toBe(false);
  });

  it('returns true and aborts a tracked execution mid-flight', async () => {
    wireHappyPath();
    // uuid is mocked to a fixed id, so we can cancel while executeSkill is running.
    httpPost.mockImplementation(async () => {
      // Cancel the in-flight execution before the robot call resolves.
      const cancelled = skillExecutionService.cancelExecution('exec-uuid-fixed');
      expect(cancelled).toBe(true);
      return { status: 'completed', output: {} };
    });

    const result = await skillExecutionService.executeSkill({
      skillId: 'skill-1',
      robotId: 'r1',
    });

    expect(result.status).toBe('cancelled');
    expect(result.error).toBe('Execution cancelled');
  });
});

// ===========================================================================
// abortSkillOnRobot
// ===========================================================================

describe('abortSkillOnRobot', () => {
  it('returns false when the robot is not registered', async () => {
    robotManager.getRegisteredRobot.mockResolvedValue(undefined);
    const result = await skillExecutionService.abortSkillOnRobot('skill-1', 'rX');
    expect(result).toBe(false);
  });

  it('posts the abort and returns true on acknowledgement', async () => {
    robotManager.getRegisteredRobot.mockResolvedValue(makeRegistered());
    httpPost.mockResolvedValue(undefined);

    const result = await skillExecutionService.abortSkillOnRobot('skill-1', 'r1');

    expect(result).toBe(true);
    expect(httpPost).toHaveBeenCalledWith('/api/v1/robots/r1/skills/abort', {
      skillId: 'skill-1',
    });
  });

  it('returns false on a 404 from the robot agent', async () => {
    robotManager.getRegisteredRobot.mockResolvedValue(makeRegistered());
    httpPost.mockRejectedValue(new Error('Request failed with status 404'));

    const result = await skillExecutionService.abortSkillOnRobot('skill-1', 'r1');
    expect(result).toBe(false);
  });

  it('rethrows non-404 errors', async () => {
    robotManager.getRegisteredRobot.mockResolvedValue(makeRegistered());
    httpPost.mockRejectedValue(new Error('500 internal error'));

    await expect(skillExecutionService.abortSkillOnRobot('skill-1', 'r1')).rejects.toThrow(
      '500 internal error'
    );
  });
});

// ===========================================================================
// onSkillEvent
// ===========================================================================

describe('onSkillEvent', () => {
  it('subscribes and unsubscribes from skill events', async () => {
    wireHappyPath();
    const cb = vi.fn();
    const unsub = skillExecutionService.onSkillEvent(cb);

    await skillExecutionService.executeSkill({ skillId: 'skill-1', robotId: 'r1' });
    expect(cb).toHaveBeenCalled();

    const callsAfterFirst = cb.mock.calls.length;
    unsub();

    await skillExecutionService.executeSkill({ skillId: 'skill-1', robotId: 'r1' });
    expect(cb.mock.calls.length).toBe(callsAfterFirst);
  });
});
