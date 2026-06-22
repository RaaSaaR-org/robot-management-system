/**
 * @file SkillLibraryService.test.ts
 * @description Unit tests for SkillLibraryService — skill/skill-chain CRUD, status transitions,
 *   parameter validation (AJV), robot compatibility checking, and skill events.
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillDefinition, Condition } from '../../types/vla.types.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries — repositories + RobotManager.
// AJV is intentionally NOT mocked: it is a pure in-process validation library
// (no DB / network / fs), and its real behavior is part of what we assert.
// ---------------------------------------------------------------------------

vi.mock('../../repositories/index.js', () => ({
  skillDefinitionRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findByIdWithRelations: vi.fn(),
    findByNameAndVersion: vi.fn(),
    findAll: vi.fn(),
    findPublished: vi.fn(),
    findByRobotType: vi.fn(),
    findByCapability: vi.fn(),
    findCompatibleSkills: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  skillChainRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    findActive: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateStatus: vi.fn(),
  },
  robotTypeRepository: {
    findById: vi.fn(),
    findByName: vi.fn(),
  },
}));

vi.mock('../RobotManager.js', () => ({
  robotManager: {
    getRobot: vi.fn(),
    listRobots: vi.fn(),
  },
}));

import { skillLibraryService } from '../SkillLibraryService.js';
import { robotManager as _robotManager } from '../RobotManager.js';
import {
  skillDefinitionRepository as _skillDefinitionRepository,
  skillChainRepository as _skillChainRepository,
  robotTypeRepository as _robotTypeRepository,
} from '../../repositories/index.js';

// Retype the mocked singletons so `.mockResolvedValue` / `.mockReturnValue` etc.
// are visible to TypeScript. `vi.mocked(..., true)` returns the SAME object,
// just with mock-typed members — runtime behavior is unchanged.
const skillDefinitionRepository = vi.mocked(_skillDefinitionRepository, true);
const skillChainRepository = vi.mocked(_skillChainRepository, true);
const robotTypeRepository = vi.mocked(_robotTypeRepository, true);
const robotManager = vi.mocked(_robotManager, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCondition(overrides: Partial<Condition> = {}): Condition {
  return {
    type: 'sensor',
    name: 'gripper_empty',
    check: 'gripper.state === "empty"',
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: 'skill-1',
    name: 'pick',
    version: '1.0.0',
    parametersSchema: {},
    defaultParameters: {},
    preconditions: [],
    postconditions: [],
    requiredCapabilities: [],
    maxRetries: 0,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Robot shape (loosely typed — only fields the service reads matter)
function makeRobot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    name: 'Robot One',
    model: 'so101',
    capabilities: [],
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// initialize / isInitialized
// ===========================================================================

describe('initialize', () => {
  it('marks the service initialized and is idempotent', async () => {
    await skillLibraryService.initialize();
    expect(skillLibraryService.isInitialized()).toBe(true);
    // second call is a no-op and does not throw
    await expect(skillLibraryService.initialize()).resolves.toBeUndefined();
    expect(skillLibraryService.isInitialized()).toBe(true);
  });
});

// ===========================================================================
// createSkill
// ===========================================================================

describe('createSkill', () => {
  it('creates a skill and emits a skill event', async () => {
    const created = makeSkill({ id: 'new-id', name: 'place' });
    skillDefinitionRepository.create.mockResolvedValue(created);
    const cb = vi.fn();
    const unsubscribe = skillLibraryService.onSkillEvent(cb);

    const result = await skillLibraryService.createSkill({ name: 'place', version: '1.0.0' });

    expect(result).toBe(created);
    expect(skillDefinitionRepository.create).toHaveBeenCalledWith({ name: 'place', version: '1.0.0' });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({
      type: 'skill:execution:completed',
      skillId: 'new-id',
    });
    unsubscribe();
  });

  it('validates compatible robot types exist and throws when one is missing', async () => {
    robotTypeRepository.findById.mockResolvedValue(null);

    await expect(
      skillLibraryService.createSkill({
        name: 'x',
        version: '1.0.0',
        compatibleRobotTypeIds: ['rt-missing'],
      })
    ).rejects.toThrow('Robot type not found: rt-missing');
    expect(skillDefinitionRepository.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid parameter schema', async () => {
    await expect(
      skillLibraryService.createSkill({
        name: 'x',
        version: '1.0.0',
        // `type` must be a valid JSON Schema type — AJV.compile throws
        parametersSchema: { type: 'not-a-real-type' },
      })
    ).rejects.toThrow(/Invalid parameter schema/);
    expect(skillDefinitionRepository.create).not.toHaveBeenCalled();
  });

  it('passes when all compatible robot types exist', async () => {
    robotTypeRepository.findById.mockResolvedValue({ id: 'rt1', name: 'arm' } as never);
    const created = makeSkill();
    skillDefinitionRepository.create.mockResolvedValue(created);

    const result = await skillLibraryService.createSkill({
      name: 'pick',
      version: '1.0.0',
      compatibleRobotTypeIds: ['rt1'],
    });

    expect(result).toBe(created);
    expect(robotTypeRepository.findById).toHaveBeenCalledWith('rt1');
  });
});

// ===========================================================================
// Simple read pass-throughs
// ===========================================================================

describe('skill read methods', () => {
  it('getSkill returns the repository result', async () => {
    const skill = makeSkill();
    skillDefinitionRepository.findById.mockResolvedValue(skill);
    await expect(skillLibraryService.getSkill('skill-1')).resolves.toBe(skill);
    expect(skillDefinitionRepository.findById).toHaveBeenCalledWith('skill-1');
  });

  it('getSkill returns null when not found', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(null);
    await expect(skillLibraryService.getSkill('nope')).resolves.toBeNull();
  });

  it('getSkillWithRelations delegates to findByIdWithRelations', async () => {
    const skill = makeSkill();
    skillDefinitionRepository.findByIdWithRelations.mockResolvedValue(skill);
    await expect(skillLibraryService.getSkillWithRelations('skill-1')).resolves.toBe(skill);
    expect(skillDefinitionRepository.findByIdWithRelations).toHaveBeenCalledWith('skill-1');
  });

  it('getSkillByNameAndVersion delegates correctly', async () => {
    const skill = makeSkill();
    skillDefinitionRepository.findByNameAndVersion.mockResolvedValue(skill);
    await expect(skillLibraryService.getSkillByNameAndVersion('pick', '1.0.0')).resolves.toBe(skill);
    expect(skillDefinitionRepository.findByNameAndVersion).toHaveBeenCalledWith('pick', '1.0.0');
  });

  it('listSkills passes query params through', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 20 };
    skillDefinitionRepository.findAll.mockResolvedValue(page as never);
    await expect(skillLibraryService.listSkills({ status: 'published' } as never)).resolves.toBe(page);
    expect(skillDefinitionRepository.findAll).toHaveBeenCalledWith({ status: 'published' });
  });

  it('listPublishedSkills / listSkillsByRobotType / listSkillsByCapability delegate', async () => {
    skillDefinitionRepository.findPublished.mockResolvedValue([makeSkill()]);
    skillDefinitionRepository.findByRobotType.mockResolvedValue([makeSkill()]);
    skillDefinitionRepository.findByCapability.mockResolvedValue([makeSkill()]);

    await expect(skillLibraryService.listPublishedSkills()).resolves.toHaveLength(1);
    await skillLibraryService.listSkillsByRobotType('rt1');
    await skillLibraryService.listSkillsByCapability('grasp');

    expect(skillDefinitionRepository.findByRobotType).toHaveBeenCalledWith('rt1');
    expect(skillDefinitionRepository.findByCapability).toHaveBeenCalledWith('grasp');
  });
});

// ===========================================================================
// updateSkill
// ===========================================================================

describe('updateSkill', () => {
  it('throws when the skill does not exist', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(null);
    await expect(skillLibraryService.updateSkill('x', { name: 'y' })).rejects.toThrow(
      'Skill not found: x'
    );
  });

  it('blocks modifying a published skill beyond status changes', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'published' }));
    await expect(
      skillLibraryService.updateSkill('skill-1', { name: 'renamed' })
    ).rejects.toThrow('Cannot modify published skill. Create a new version instead.');
    expect(skillDefinitionRepository.update).not.toHaveBeenCalled();
  });

  it('allows status-only transition (deprecate) on a published skill', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'published' }));
    const updated = makeSkill({ status: 'deprecated' });
    skillDefinitionRepository.update.mockResolvedValue(updated);

    const result = await skillLibraryService.updateSkill('skill-1', { status: 'deprecated' });
    expect(result).toBe(updated);
    expect(skillDefinitionRepository.update).toHaveBeenCalledWith('skill-1', { status: 'deprecated' });
  });

  it('updates a draft skill freely', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'draft' }));
    const updated = makeSkill({ name: 'renamed' });
    skillDefinitionRepository.update.mockResolvedValue(updated);

    const result = await skillLibraryService.updateSkill('skill-1', { name: 'renamed' });
    expect(result).toBe(updated);
  });

  it('rejects an invalid parameter schema on update', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'draft' }));
    await expect(
      skillLibraryService.updateSkill('skill-1', { parametersSchema: { type: 'bogus' } })
    ).rejects.toThrow(/Invalid parameter schema/);
    expect(skillDefinitionRepository.update).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// deleteSkill
// ===========================================================================

describe('deleteSkill', () => {
  it('returns false when the skill does not exist', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(null);
    await expect(skillLibraryService.deleteSkill('x')).resolves.toBe(false);
    expect(skillDefinitionRepository.delete).not.toHaveBeenCalled();
  });

  it('throws when deleting a published skill', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'published' }));
    await expect(skillLibraryService.deleteSkill('skill-1')).rejects.toThrow(
      'Cannot delete published skill. Deprecate or archive it instead.'
    );
  });

  it('deletes a draft skill', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'draft' }));
    skillDefinitionRepository.delete.mockResolvedValue(true);
    await expect(skillLibraryService.deleteSkill('skill-1')).resolves.toBe(true);
    expect(skillDefinitionRepository.delete).toHaveBeenCalledWith('skill-1');
  });
});

// ===========================================================================
// publishSkill
// ===========================================================================

describe('publishSkill', () => {
  it('throws when the skill is not found', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(null);
    await expect(skillLibraryService.publishSkill('x')).rejects.toThrow('Skill not found: x');
  });

  it('throws when the skill is not a draft', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'published' }));
    await expect(skillLibraryService.publishSkill('skill-1')).rejects.toThrow(
      'Cannot publish skill in status: published'
    );
  });

  it('throws with aggregated validation errors when conditions are invalid', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(
      makeSkill({
        status: 'draft',
        preconditions: [makeCondition({ type: 'bad' as never, name: 'cond1' })],
      })
    );
    await expect(skillLibraryService.publishSkill('skill-1')).rejects.toThrow(
      /Skill validation failed:.*Invalid precondition: cond1/
    );
    expect(skillDefinitionRepository.update).not.toHaveBeenCalled();
  });

  it('publishes a valid draft skill', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(
      makeSkill({
        status: 'draft',
        preconditions: [makeCondition()],
        postconditions: [makeCondition({ name: 'object_placed', check: 'placed' })],
      })
    );
    const published = makeSkill({ status: 'published' });
    skillDefinitionRepository.update.mockResolvedValue(published);

    const result = await skillLibraryService.publishSkill('skill-1');
    expect(result).toBe(published);
    expect(skillDefinitionRepository.update).toHaveBeenCalledWith('skill-1', { status: 'published' });
  });

  it('throws when the repository update returns null', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'draft' }));
    skillDefinitionRepository.update.mockResolvedValue(null);
    await expect(skillLibraryService.publishSkill('skill-1')).rejects.toThrow(
      'Failed to publish skill: skill-1'
    );
  });
});

// ===========================================================================
// deprecateSkill / archiveSkill
// ===========================================================================

describe('deprecateSkill', () => {
  it('throws when skill not found', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(null);
    await expect(skillLibraryService.deprecateSkill('x')).rejects.toThrow('Skill not found: x');
  });

  it('throws when not published', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'draft' }));
    await expect(skillLibraryService.deprecateSkill('skill-1')).rejects.toThrow(
      'Cannot deprecate skill in status: draft'
    );
  });

  it('deprecates a published skill', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'published' }));
    const updated = makeSkill({ status: 'deprecated' });
    skillDefinitionRepository.update.mockResolvedValue(updated);
    await expect(skillLibraryService.deprecateSkill('skill-1')).resolves.toBe(updated);
    expect(skillDefinitionRepository.update).toHaveBeenCalledWith('skill-1', { status: 'deprecated' });
  });
});

describe('archiveSkill', () => {
  it('archives a deprecated skill', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'deprecated' }));
    const updated = makeSkill({ status: 'archived' });
    skillDefinitionRepository.update.mockResolvedValue(updated);
    await expect(skillLibraryService.archiveSkill('skill-1')).resolves.toBe(updated);
  });

  it('archives a draft skill', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'draft' }));
    skillDefinitionRepository.update.mockResolvedValue(makeSkill({ status: 'archived' }));
    await expect(skillLibraryService.archiveSkill('skill-1')).resolves.toMatchObject({
      status: 'archived',
    });
  });

  it('throws for a published skill (must be deprecated/draft)', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'published' }));
    await expect(skillLibraryService.archiveSkill('skill-1')).rejects.toThrow(
      'Cannot archive skill in status: published'
    );
  });
});

// ===========================================================================
// validateParameters (sync) + validateSkillParameters (async)
// ===========================================================================

describe('validateParameters', () => {
  it('returns valid with merged defaults when no schema is present', () => {
    const skill = makeSkill({ defaultParameters: { speed: 1 }, parametersSchema: {} });
    const result = skillLibraryService.validateParameters(skill, { force: 5 });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.coercedParameters).toEqual({ speed: 1, force: 5 });
  });

  it('validates against a JSON schema and reports errors', () => {
    const skill = makeSkill({
      parametersSchema: {
        type: 'object',
        properties: { count: { type: 'integer' } },
        required: ['count'],
      },
      defaultParameters: {},
    });
    const result = skillLibraryService.validateParameters(skill, {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatchObject({ code: expect.any(String), message: expect.any(String) });
  });

  it('passes valid parameters against the schema', () => {
    const skill = makeSkill({
      parametersSchema: {
        type: 'object',
        properties: { count: { type: 'integer' } },
        required: ['count'],
      },
    });
    const result = skillLibraryService.validateParameters(skill, { count: 3 });
    expect(result.valid).toBe(true);
    expect(result.coercedParameters).toMatchObject({ count: 3 });
  });
});

describe('validateSkillParameters', () => {
  it('returns a not_found error result when the skill is missing', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(null);
    const result = await skillLibraryService.validateSkillParameters('missing', {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ code: 'not_found', message: 'Skill not found' });
  });

  it('delegates to validateParameters for an existing skill', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(
      makeSkill({ parametersSchema: {}, defaultParameters: { a: 1 } })
    );
    const result = await skillLibraryService.validateSkillParameters('skill-1', { b: 2 });
    expect(result.valid).toBe(true);
    expect(result.coercedParameters).toEqual({ a: 1, b: 2 });
  });
});

// ===========================================================================
// checkRobotCompatibility
// ===========================================================================

describe('checkRobotCompatibility', () => {
  it('throws when the skill is not found', async () => {
    skillDefinitionRepository.findByIdWithRelations.mockResolvedValue(null);
    await expect(skillLibraryService.checkRobotCompatibility('s', 'r')).rejects.toThrow(
      'Skill not found: s'
    );
  });

  it('throws when the robot is not found', async () => {
    skillDefinitionRepository.findByIdWithRelations.mockResolvedValue(makeSkill());
    vi.mocked(robotManager.getRobot).mockResolvedValue(null as never);
    await expect(skillLibraryService.checkRobotCompatibility('s', 'r')).rejects.toThrow(
      'Robot not found: r'
    );
  });

  it('reports compatible when type matches and all capabilities present', async () => {
    skillDefinitionRepository.findByIdWithRelations.mockResolvedValue(
      makeSkill({
        compatibleRobotTypes: [{ id: 'rt1', name: 'so101' } as never],
        requiredCapabilities: ['grasp'],
      })
    );
    vi.mocked(robotManager.getRobot).mockResolvedValue(
      makeRobot({ id: 'r1', name: 'Robot One', capabilities: ['grasp', 'move'], model: 'so101' }) as never
    );

    const result = await skillLibraryService.checkRobotCompatibility('s', 'r1');
    expect(result.compatible).toBe(true);
    expect(result.robotType).toBe('so101');
    expect(result.matchingCapabilities).toEqual(['grasp']);
    expect(result.missingCapabilities).toEqual([]);
  });

  it('reports incompatible and lists missing capabilities', async () => {
    skillDefinitionRepository.findByIdWithRelations.mockResolvedValue(
      makeSkill({
        compatibleRobotTypes: [{ id: 'rt1', name: 'so101' } as never],
        requiredCapabilities: ['grasp', 'weld'],
      })
    );
    vi.mocked(robotManager.getRobot).mockResolvedValue(
      makeRobot({ capabilities: ['grasp'], model: 'so101' }) as never
    );

    const result = await skillLibraryService.checkRobotCompatibility('s', 'r1');
    expect(result.compatible).toBe(false);
    expect(result.missingCapabilities).toEqual(['weld']);
    expect(result.matchingCapabilities).toEqual(['grasp']);
  });

  it('treats a skill with no compatible types as type-compatible for any robot', async () => {
    skillDefinitionRepository.findByIdWithRelations.mockResolvedValue(
      makeSkill({ compatibleRobotTypes: [], requiredCapabilities: [] })
    );
    vi.mocked(robotManager.getRobot).mockResolvedValue(
      makeRobot({ model: 'anything' }) as never
    );
    const result = await skillLibraryService.checkRobotCompatibility('s', 'r1');
    expect(result.compatible).toBe(true);
  });
});

// ===========================================================================
// getCompatibleRobots
// ===========================================================================

describe('getCompatibleRobots', () => {
  it('throws when the skill is not found', async () => {
    skillDefinitionRepository.findByIdWithRelations.mockResolvedValue(null);
    await expect(skillLibraryService.getCompatibleRobots('s')).rejects.toThrow('Skill not found: s');
  });

  it('aggregates compatibility across the fleet using robot capabilities', async () => {
    skillDefinitionRepository.findByIdWithRelations.mockResolvedValue(
      makeSkill({
        compatibleRobotTypes: [{ id: 'rt1', name: 'so101' } as never],
        requiredCapabilities: ['grasp'],
      })
    );
    // getCompatibleRobots resolves capabilities from robot.capabilities (the canonical
    // field), consistent with checkRobotCompatibility.
    vi.mocked(robotManager.listRobots).mockResolvedValue([
      makeRobot({ id: 'a', name: 'A', model: 'so101', capabilities: ['grasp'] }),
      makeRobot({ id: 'b', name: 'B', model: 'other', capabilities: ['grasp'] }),
    ] as never);

    const result = await skillLibraryService.getCompatibleRobots('s');
    expect(result.totalRobots).toBe(2);
    expect(result.compatibleRobots).toBe(1);
    const a = result.robots.find((r) => r.robotId === 'a');
    expect(a?.compatible).toBe(true);
    const b = result.robots.find((r) => r.robotId === 'b');
    expect(b?.compatible).toBe(false); // wrong robot type
  });

  it('returns empty robots for an empty fleet', async () => {
    skillDefinitionRepository.findByIdWithRelations.mockResolvedValue(makeSkill());
    vi.mocked(robotManager.listRobots).mockResolvedValue([] as never);
    const result = await skillLibraryService.getCompatibleRobots('s');
    expect(result.totalRobots).toBe(0);
    expect(result.compatibleRobots).toBe(0);
    expect(result.robots).toEqual([]);
  });
});

// ===========================================================================
// getSkillsForRobot
// ===========================================================================

describe('getSkillsForRobot', () => {
  it('throws when the robot is not found', async () => {
    vi.mocked(robotManager.getRobot).mockResolvedValue(null as never);
    await expect(skillLibraryService.getSkillsForRobot('r')).rejects.toThrow('Robot not found: r');
  });

  it('returns unrestricted published skills when the robot type is not registered', async () => {
    vi.mocked(robotManager.getRobot).mockResolvedValue(
      makeRobot({ model: 'unknown-type', metadata: {} }) as never
    );
    robotTypeRepository.findByName.mockResolvedValue(null);
    skillDefinitionRepository.findPublished.mockResolvedValue([
      makeSkill({ id: 'unrestricted', compatibleRobotTypes: [] }),
      makeSkill({ id: 'restricted', compatibleRobotTypes: [{ id: 'rt1', name: 'so101' } as never] }),
    ]);

    const result = await skillLibraryService.getSkillsForRobot('r1');
    expect(result.map((s) => s.id)).toEqual(['unrestricted']);
  });

  it('queries findCompatibleSkills when the robot type is registered', async () => {
    vi.mocked(robotManager.getRobot).mockResolvedValue(
      makeRobot({ model: 'so101', capabilities: ['grasp'] }) as never
    );
    robotTypeRepository.findByName.mockResolvedValue({ id: 'rt1', name: 'so101' } as never);
    const skills = [makeSkill({ id: 'compat' })];
    skillDefinitionRepository.findCompatibleSkills.mockResolvedValue(skills);

    const result = await skillLibraryService.getSkillsForRobot('r1');
    expect(result).toBe(skills);
    expect(skillDefinitionRepository.findCompatibleSkills).toHaveBeenCalledWith('rt1', ['grasp']);
  });
});

// ===========================================================================
// createChain
// ===========================================================================

describe('createChain', () => {
  it('throws when a referenced skill does not exist', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(null);
    await expect(
      skillLibraryService.createChain({ name: 'c', steps: [{ skillId: 'missing' }] } as never)
    ).rejects.toThrow('Skill not found: missing');
    expect(skillChainRepository.create).not.toHaveBeenCalled();
  });

  it('throws when a referenced skill is not published', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'draft', name: 'pick' }));
    await expect(
      skillLibraryService.createChain({ name: 'c', steps: [{ skillId: 'skill-1' }] } as never)
    ).rejects.toThrow('Skill is not published: pick v1.0.0');
  });

  it('creates a chain when all skills are published', async () => {
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'published' }));
    const chain = { id: 'chain-1', name: 'c', status: 'draft' };
    skillChainRepository.create.mockResolvedValue(chain as never);

    const input = { name: 'c', steps: [{ skillId: 'skill-1' }] };
    const result = await skillLibraryService.createChain(input as never);
    expect(result).toBe(chain);
    expect(skillChainRepository.create).toHaveBeenCalledWith(input);
  });
});

// ===========================================================================
// chain read methods
// ===========================================================================

describe('chain read methods', () => {
  it('getChain / listChains / listActiveChains delegate to repository', async () => {
    const chain = { id: 'chain-1' };
    skillChainRepository.findById.mockResolvedValue(chain as never);
    skillChainRepository.findAll.mockResolvedValue({ items: [], total: 0 } as never);
    skillChainRepository.findActive.mockResolvedValue([chain] as never);

    await expect(skillLibraryService.getChain('chain-1')).resolves.toBe(chain);
    await skillLibraryService.listChains({ status: 'active' } as never);
    await expect(skillLibraryService.listActiveChains()).resolves.toEqual([chain]);

    expect(skillChainRepository.findById).toHaveBeenCalledWith('chain-1');
    expect(skillChainRepository.findAll).toHaveBeenCalledWith({ status: 'active' });
  });
});

// ===========================================================================
// updateChain
// ===========================================================================

describe('updateChain', () => {
  it('throws when the chain does not exist', async () => {
    skillChainRepository.findById.mockResolvedValue(null);
    await expect(skillLibraryService.updateChain('x', {} as never)).rejects.toThrow(
      'Skill chain not found: x'
    );
  });

  it('validates new steps and throws when a skill is unpublished', async () => {
    skillChainRepository.findById.mockResolvedValue({ id: 'chain-1', status: 'draft' } as never);
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'draft', name: 'pick' }));
    await expect(
      skillLibraryService.updateChain('chain-1', { steps: [{ skillId: 'skill-1' }] } as never)
    ).rejects.toThrow('Skill is not published: pick v1.0.0');
  });

  it('updates the chain when steps are valid', async () => {
    skillChainRepository.findById.mockResolvedValue({ id: 'chain-1', status: 'draft' } as never);
    skillDefinitionRepository.findById.mockResolvedValue(makeSkill({ status: 'published' }));
    const updated = { id: 'chain-1', name: 'updated' };
    skillChainRepository.update.mockResolvedValue(updated as never);

    const result = await skillLibraryService.updateChain('chain-1', {
      steps: [{ skillId: 'skill-1' }],
    } as never);
    expect(result).toBe(updated);
  });

  it('updates without step validation when steps are not provided', async () => {
    skillChainRepository.findById.mockResolvedValue({ id: 'chain-1', status: 'draft' } as never);
    const updated = { id: 'chain-1', name: 'renamed' };
    skillChainRepository.update.mockResolvedValue(updated as never);

    const result = await skillLibraryService.updateChain('chain-1', { name: 'renamed' } as never);
    expect(result).toBe(updated);
    expect(skillDefinitionRepository.findById).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// deleteChain
// ===========================================================================

describe('deleteChain', () => {
  it('returns false when the chain does not exist', async () => {
    skillChainRepository.findById.mockResolvedValue(null);
    await expect(skillLibraryService.deleteChain('x')).resolves.toBe(false);
  });

  it('throws when deleting an active chain', async () => {
    skillChainRepository.findById.mockResolvedValue({ id: 'chain-1', status: 'active' } as never);
    await expect(skillLibraryService.deleteChain('chain-1')).rejects.toThrow(
      'Cannot delete active skill chain. Archive it first.'
    );
  });

  it('deletes a draft chain', async () => {
    skillChainRepository.findById.mockResolvedValue({ id: 'chain-1', status: 'draft', name: 'c' } as never);
    skillChainRepository.delete.mockResolvedValue(true);
    await expect(skillLibraryService.deleteChain('chain-1')).resolves.toBe(true);
    expect(skillChainRepository.delete).toHaveBeenCalledWith('chain-1');
  });
});

// ===========================================================================
// activateChain / archiveChain
// ===========================================================================

describe('activateChain', () => {
  it('throws when chain not found', async () => {
    skillChainRepository.findById.mockResolvedValue(null);
    await expect(skillLibraryService.activateChain('x')).rejects.toThrow('Skill chain not found: x');
  });

  it('throws when not in draft status', async () => {
    skillChainRepository.findById.mockResolvedValue({ id: 'chain-1', status: 'active' } as never);
    await expect(skillLibraryService.activateChain('chain-1')).rejects.toThrow(
      'Cannot activate chain in status: active'
    );
  });

  it('activates a draft chain', async () => {
    skillChainRepository.findById.mockResolvedValue({ id: 'chain-1', status: 'draft' } as never);
    const activated = { id: 'chain-1', status: 'active', name: 'c' };
    skillChainRepository.updateStatus.mockResolvedValue(activated as never);
    await expect(skillLibraryService.activateChain('chain-1')).resolves.toBe(activated);
    expect(skillChainRepository.updateStatus).toHaveBeenCalledWith('chain-1', 'active');
  });

  it('throws when updateStatus returns null', async () => {
    skillChainRepository.findById.mockResolvedValue({ id: 'chain-1', status: 'draft' } as never);
    skillChainRepository.updateStatus.mockResolvedValue(null);
    await expect(skillLibraryService.activateChain('chain-1')).rejects.toThrow(
      'Failed to activate chain: chain-1'
    );
  });
});

describe('archiveChain', () => {
  it('throws when chain not found', async () => {
    skillChainRepository.findById.mockResolvedValue(null);
    await expect(skillLibraryService.archiveChain('x')).rejects.toThrow('Skill chain not found: x');
  });

  it('archives any existing chain', async () => {
    skillChainRepository.findById.mockResolvedValue({ id: 'chain-1', status: 'active' } as never);
    const archived = { id: 'chain-1', status: 'archived', name: 'c' };
    skillChainRepository.updateStatus.mockResolvedValue(archived as never);
    await expect(skillLibraryService.archiveChain('chain-1')).resolves.toBe(archived);
    expect(skillChainRepository.updateStatus).toHaveBeenCalledWith('chain-1', 'archived');
  });

  it('throws when updateStatus returns null', async () => {
    skillChainRepository.findById.mockResolvedValue({ id: 'chain-1', status: 'active' } as never);
    skillChainRepository.updateStatus.mockResolvedValue(null);
    await expect(skillLibraryService.archiveChain('chain-1')).rejects.toThrow(
      'Failed to archive chain: chain-1'
    );
  });
});

// ===========================================================================
// Events
// ===========================================================================

describe('onSkillEvent', () => {
  it('subscribes and unsubscribes from skill events', async () => {
    skillDefinitionRepository.create.mockResolvedValue(makeSkill({ id: 'e1' }));
    const cb = vi.fn();
    const unsubscribe = skillLibraryService.onSkillEvent(cb);

    await skillLibraryService.createSkill({ name: 'a', version: '1' });
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    await skillLibraryService.createSkill({ name: 'b', version: '1' });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
