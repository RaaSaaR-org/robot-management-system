/**
 * @file ExplainabilityService.test.ts
 * @description Unit tests for ExplainabilityService — decision CRUD, formatted
 *   human-readable explanations, performance metrics passthrough, static AI
 *   documentation/limitations, and command-interpretation decision creation
 *   (EU AI Act Art. 13, Art. 50).
 * @feature explainability
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  DecisionExplanation,
  CreateDecisionInput,
  DecisionListResponse,
  AIPerformanceMetrics,
} from '../../repositories/DecisionRepository.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries — DecisionRepository singleton
// ---------------------------------------------------------------------------

vi.mock('../../repositories/DecisionRepository.js', () => ({
  decisionRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findByEntityId: vi.fn(),
    findAll: vi.fn(),
    findByRobotId: vi.fn(),
    delete: vi.fn(),
    getMetrics: vi.fn(),
  },
}));

import { ExplainabilityService, explainabilityService } from '../ExplainabilityService.js';
import { decisionRepository as _decisionRepository } from '../../repositories/DecisionRepository.js';

// Retype the mocked singleton so .mock* methods typecheck (runtime unchanged).
const decisionRepository = vi.mocked(_decisionRepository, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDecision(overrides: Partial<DecisionExplanation> = {}): DecisionExplanation {
  return {
    id: 'd1',
    decisionType: 'command_interpretation',
    entityId: 'cmd-1',
    robotId: 'r1',
    inputFactors: {
      userCommand: 'Move to Warehouse A',
      robotState: {
        status: 'online',
        batteryLevel: 87,
        location: { x: 1, y: 2, z: 3 },
        heldObject: 'box',
      },
      environmentContext: {
        zones: ['Zone A', 'Zone B'],
        restrictions: ['no-go area'],
      },
      conversationHistory: ['hi', 'go'],
    },
    reasoning: ['step one', 'step two'],
    modelUsed: 'gemini-2.5-flash',
    confidence: 0.92,
    alternatives: [
      { action: 'Wait', reason: 'safer option', rejectionReason: 'too slow' },
    ],
    safetyFactors: {
      classification: 'safe',
      warnings: ['watch the edge'],
      constraints: ['speed limit'],
    },
    createdAt: '2026-06-22T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// Decision CRUD
// ===========================================================================

describe('storeDecision', () => {
  it('delegates to the repository and returns the created decision', async () => {
    const decision = makeDecision();
    decisionRepository.create.mockResolvedValue(decision);

    const input: CreateDecisionInput = {
      decisionType: 'command_interpretation',
      entityId: 'cmd-1',
      robotId: 'r1',
      inputFactors: { robotState: {} },
      reasoning: [],
      modelUsed: 'm',
      confidence: 0.5,
      alternatives: [],
      safetyFactors: { classification: 'safe', warnings: [], constraints: [] },
    };

    const result = await explainabilityService.storeDecision(input);
    expect(result).toBe(decision);
    expect(decisionRepository.create).toHaveBeenCalledWith(input);
  });

  it('propagates repository errors', async () => {
    decisionRepository.create.mockRejectedValue(new Error('db down'));
    await expect(
      explainabilityService.storeDecision({} as CreateDecisionInput)
    ).rejects.toThrow('db down');
  });
});

describe('getDecision', () => {
  it('returns the decision when found', async () => {
    const decision = makeDecision();
    decisionRepository.findById.mockResolvedValue(decision);
    const result = await explainabilityService.getDecision('d1');
    expect(result).toBe(decision);
    expect(decisionRepository.findById).toHaveBeenCalledWith('d1');
  });

  it('returns null when not found', async () => {
    decisionRepository.findById.mockResolvedValue(null);
    const result = await explainabilityService.getDecision('missing');
    expect(result).toBeNull();
  });
});

describe('getDecisionByEntityId', () => {
  it('returns the decision when found', async () => {
    const decision = makeDecision();
    decisionRepository.findByEntityId.mockResolvedValue(decision);
    const result = await explainabilityService.getDecisionByEntityId('cmd-1');
    expect(result).toBe(decision);
    expect(decisionRepository.findByEntityId).toHaveBeenCalledWith('cmd-1');
  });

  it('returns null when not found', async () => {
    decisionRepository.findByEntityId.mockResolvedValue(null);
    expect(await explainabilityService.getDecisionByEntityId('x')).toBeNull();
  });
});

describe('listDecisions', () => {
  it('passes params through and returns the list response', async () => {
    const response: DecisionListResponse = {
      decisions: [makeDecision()],
      pagination: { page: 2, pageSize: 10, total: 1, totalPages: 1 },
    };
    decisionRepository.findAll.mockResolvedValue(response);

    const result = await explainabilityService.listDecisions({ page: 2, pageSize: 10 });
    expect(result).toBe(response);
    expect(decisionRepository.findAll).toHaveBeenCalledWith({ page: 2, pageSize: 10 });
  });

  it('works with no params', async () => {
    const response: DecisionListResponse = {
      decisions: [],
      pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    };
    decisionRepository.findAll.mockResolvedValue(response);
    const result = await explainabilityService.listDecisions();
    expect(result.decisions).toHaveLength(0);
    expect(decisionRepository.findAll).toHaveBeenCalledWith(undefined);
  });
});

describe('listRobotDecisions', () => {
  it('delegates to findByRobotId with robot id and params', async () => {
    const response: DecisionListResponse = {
      decisions: [makeDecision({ robotId: 'r9' })],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    };
    decisionRepository.findByRobotId.mockResolvedValue(response);

    const result = await explainabilityService.listRobotDecisions('r9', { page: 1 });
    expect(result).toBe(response);
    expect(decisionRepository.findByRobotId).toHaveBeenCalledWith('r9', { page: 1 });
  });
});

describe('deleteDecision', () => {
  it('returns true when the repository deletes', async () => {
    decisionRepository.delete.mockResolvedValue(true);
    expect(await explainabilityService.deleteDecision('d1')).toBe(true);
    expect(decisionRepository.delete).toHaveBeenCalledWith('d1');
  });

  it('returns false when the repository reports no deletion', async () => {
    decisionRepository.delete.mockResolvedValue(false);
    expect(await explainabilityService.deleteDecision('nope')).toBe(false);
  });
});

// ===========================================================================
// Formatted explanations (Art. 13(1))
// ===========================================================================

describe('getFormattedExplanation', () => {
  it('returns null when the decision does not exist', async () => {
    decisionRepository.findById.mockResolvedValue(null);
    const result = await explainabilityService.getFormattedExplanation('missing');
    expect(result).toBeNull();
  });

  it('formats the decision when found', async () => {
    const decision = makeDecision();
    decisionRepository.findById.mockResolvedValue(decision);

    const result = await explainabilityService.getFormattedExplanation('d1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('d1');
    expect(result?.metadata.robotId).toBe('r1');
    expect(result?.metadata.modelUsed).toBe('gemini-2.5-flash');
    expect(result?.metadata.timestamp).toBe('2026-06-22T10:00:00.000Z');
  });
});

describe('formatExplanation', () => {
  it('produces a high-confidence summary and confidence level', () => {
    const decision = makeDecision({ confidence: 0.92 });
    const formatted = explainabilityService.formatExplanation(decision);

    expect(formatted.confidence.score).toBe(0.92);
    expect(formatted.confidence.level).toBe('high');
    expect(formatted.confidence.description).toContain('92%');
    expect(formatted.decisionType).toBe('Command Interpretation');
    expect(formatted.summary).toContain('Move to Warehouse A');
    expect(formatted.summary).toContain('92% confidence');
    expect(formatted.summary).toContain('safe');
  });

  it('classifies medium and low confidence', () => {
    const medium = explainabilityService.formatExplanation(makeDecision({ confidence: 0.65 }));
    expect(medium.confidence.level).toBe('medium');
    expect(medium.confidence.description).toContain('ambiguity');

    const low = explainabilityService.formatExplanation(makeDecision({ confidence: 0.4 }));
    expect(low.confidence.level).toBe('low');
    expect(low.confidence.description).toContain('Human verification recommended');
  });

  it('maps reasoning, alternatives and safety factors', () => {
    const decision = makeDecision();
    const formatted = explainabilityService.formatExplanation(decision);

    expect(formatted.reasoning.steps).toEqual(['step one', 'step two']);
    expect(formatted.alternatives.items).toEqual([
      { action: 'Wait', reason: 'safer option', rejected: 'too slow' },
    ]);
    expect(formatted.safety.classification).toBe('safe');
    expect(formatted.safety.warnings).toEqual(['watch the edge']);
    expect(formatted.safety.constraints).toEqual(['speed limit']);
  });

  it('formats all input factor categories', () => {
    const decision = makeDecision();
    const items = explainabilityService.formatExplanation(decision).inputFactors.items;
    const byLabel = (label: string) => items.find((i) => i.label === label)?.value;

    expect(byLabel('User Command')).toBe('Move to Warehouse A');
    expect(byLabel('Robot Status')).toBe('online');
    expect(byLabel('Battery Level')).toBe('87%');
    expect(byLabel('Robot Location')).toBe('(1, 2, 3)');
    expect(byLabel('Held Object')).toBe('box');
    expect(byLabel('Active Zones')).toBe('Zone A, Zone B');
    expect(byLabel('Restrictions')).toBe('no-go area');
    expect(byLabel('Conversation Context')).toBe('2 previous messages');
  });

  it('omits location z when undefined and handles empty robot state', () => {
    const decision = makeDecision({
      inputFactors: {
        userCommand: undefined,
        robotState: { location: { x: 5, y: 6 } },
      },
    });
    const items = explainabilityService.formatExplanation(decision).inputFactors.items;
    const loc = items.find((i) => i.label === 'Robot Location');
    expect(loc?.value).toBe('(5, 6)');
    // No user command -> no User Command item
    expect(items.find((i) => i.label === 'User Command')).toBeUndefined();
  });

  it('falls back to "Unknown command" in the summary when no userCommand', () => {
    const decision = makeDecision({
      inputFactors: { robotState: {} },
    });
    const formatted = explainabilityService.formatExplanation(decision);
    expect(formatted.summary).toContain('Unknown command');
  });

  it('falls back to the raw type when it is not a known decision type', () => {
    const decision = makeDecision({
      decisionType: 'mystery' as DecisionExplanation['decisionType'],
    });
    const formatted = explainabilityService.formatExplanation(decision);
    expect(formatted.decisionType).toBe('mystery');
  });
});

// ===========================================================================
// Performance metrics (Art. 13(3)(b))
// ===========================================================================

describe('getPerformanceMetrics', () => {
  const metrics: AIPerformanceMetrics = {
    period: 'weekly',
    startDate: '2026-06-15T00:00:00.000Z',
    endDate: '2026-06-22T00:00:00.000Z',
    totalDecisions: 3,
    accuracy: 0.66,
    precision: 0.66,
    recall: 0.66,
    errorRate: 0.34,
    driftIndicator: 0.1,
    avgConfidence: 0.75,
    safetyDistribution: { safe: 2, caution: 1, dangerous: 0 },
  };

  it('defaults to the weekly period', async () => {
    decisionRepository.getMetrics.mockResolvedValue(metrics);
    const result = await explainabilityService.getPerformanceMetrics();
    expect(result).toBe(metrics);
    expect(decisionRepository.getMetrics).toHaveBeenCalledWith('weekly', undefined);
  });

  it('passes through period and robotId', async () => {
    decisionRepository.getMetrics.mockResolvedValue(metrics);
    await explainabilityService.getPerformanceMetrics('daily', 'r7');
    expect(decisionRepository.getMetrics).toHaveBeenCalledWith('daily', 'r7');
  });

  it('propagates repository errors', async () => {
    decisionRepository.getMetrics.mockRejectedValue(new Error('metrics failed'));
    await expect(explainabilityService.getPerformanceMetrics('monthly')).rejects.toThrow(
      'metrics failed'
    );
  });
});

// ===========================================================================
// Static documentation (Art. 13(3)(a)/(c))
// ===========================================================================

describe('static documentation accessors', () => {
  it('returns a copy of the documentation, not the internal reference', () => {
    const doc1 = explainabilityService.getDocumentation();
    const doc2 = explainabilityService.getDocumentation();
    expect(doc1).toEqual(doc2);
    expect(doc1).not.toBe(doc2);
    expect(doc1.version).toBe('1.0.0');
    expect(doc1.intendedPurpose).toMatch(/natural language/i);

    // getDocumentation() deep-copies the nested arrays, so two calls return
    // independent arrays — a caller mutating one can't corrupt the singleton.
    expect(doc1.limitations).not.toBe(doc2.limitations);
    expect(doc1.capabilities).not.toBe(doc2.capabilities);
    doc1.limitations.push('mutation should not leak');
    expect(doc2.limitations).not.toContain('mutation should not leak');
  });

  it('getLimitations returns a fresh array copy', () => {
    const a = explainabilityService.getLimitations();
    const b = explainabilityService.getLimitations();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('getOperatingConditions returns a fresh array copy', () => {
    const a = explainabilityService.getOperatingConditions();
    expect(a).not.toBe(explainabilityService.getOperatingConditions());
    expect(a.length).toBeGreaterThan(0);
  });

  it('getHumanOversightRequirements returns a fresh array copy', () => {
    const a = explainabilityService.getHumanOversightRequirements();
    expect(a).not.toBe(explainabilityService.getHumanOversightRequirements());
    expect(a.some((r) => /approval/i.test(r))).toBe(true);
  });
});

// ===========================================================================
// createFromCommandInterpretation
// ===========================================================================

describe('createFromCommandInterpretation', () => {
  it('builds a decision input with reasoning, alternatives and safety factors', async () => {
    const created = makeDecision();
    decisionRepository.create.mockResolvedValue(created);

    const result = await explainabilityService.createFromCommandInterpretation({
      entityId: 'cmd-9',
      robotId: 'r3',
      originalText: 'pick up the box',
      commandType: 'manipulation',
      confidence: 0.84,
      safetyClassification: 'caution',
      warnings: ['fragile item'],
      suggestedAlternatives: ['ask for confirmation'],
      modelUsed: 'gemini-2.5-flash',
      robotState: { status: 'idle' },
    });

    expect(result).toBe(created);
    expect(decisionRepository.create).toHaveBeenCalledTimes(1);

    const input = decisionRepository.create.mock.calls[0][0];
    expect(input.decisionType).toBe('command_interpretation');
    expect(input.entityId).toBe('cmd-9');
    expect(input.robotId).toBe('r3');
    expect(input.confidence).toBe(0.84);
    expect(input.modelUsed).toBe('gemini-2.5-flash');
    expect(input.inputFactors.userCommand).toBe('pick up the box');
    expect(input.inputFactors.robotState).toEqual({ status: 'idle' });
    expect(input.safetyFactors).toEqual({
      classification: 'caution',
      warnings: ['fragile item'],
      constraints: [],
    });
    expect(input.alternatives).toEqual([
      { action: 'ask for confirmation', reason: 'Suggested as alternative interpretation' },
    ]);
    // Reasoning includes a warning-count line when warnings are present.
    expect(input.reasoning).toContain('Interpreted command as: manipulation');
    expect(input.reasoning).toContain('Applied safety rules to classify as: caution');
    expect(input.reasoning).toContain('Calculated confidence based on command clarity: 84%');
    expect(input.reasoning).toContain('Generated 1 warning(s) for user review');
  });

  it('omits the warning line and defaults robotState to {} when no warnings/state', async () => {
    decisionRepository.create.mockResolvedValue(makeDecision());

    await explainabilityService.createFromCommandInterpretation({
      entityId: 'cmd-10',
      robotId: 'r4',
      originalText: 'go home',
      commandType: 'navigation',
      confidence: 0.95,
      safetyClassification: 'safe',
      warnings: [],
      suggestedAlternatives: [],
      modelUsed: 'm',
    });

    const input = decisionRepository.create.mock.calls[0][0];
    expect(input.inputFactors.robotState).toEqual({});
    expect(input.alternatives).toEqual([]);
    expect(input.reasoning).toHaveLength(3);
    expect(input.reasoning.some((r) => r.includes('warning(s)'))).toBe(false);
  });

  it('propagates repository errors', async () => {
    decisionRepository.create.mockRejectedValue(new Error('create failed'));
    await expect(
      explainabilityService.createFromCommandInterpretation({
        entityId: 'e',
        robotId: 'r',
        originalText: 't',
        commandType: 'c',
        confidence: 0.5,
        safetyClassification: 'safe',
        warnings: [],
        suggestedAlternatives: [],
        modelUsed: 'm',
      })
    ).rejects.toThrow('create failed');
  });
});

// ===========================================================================
// Construction
// ===========================================================================

describe('construction', () => {
  it('can be instantiated directly', () => {
    const svc = new ExplainabilityService();
    expect(svc).toBeInstanceOf(ExplainabilityService);
  });
});
