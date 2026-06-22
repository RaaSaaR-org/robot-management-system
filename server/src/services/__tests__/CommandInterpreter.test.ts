/**
 * @file CommandInterpreter.test.ts
 * @description Unit tests for CommandInterpreter — fallback keyword interpretation,
 *   Gemini prompt building + response parsing, malformed-output fallback, command
 *   mapping, safety/confidence guards, and error propagation/resilience.
 * @feature command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  CommandInterpretation,
  CreateCommandInterpretationInput,
} from '../../repositories/index.js';

// ---------------------------------------------------------------------------
// Mocks for module boundaries the service imports
// ---------------------------------------------------------------------------

const generateContentMock = vi.fn();
const getGenerativeModelMock = vi.fn(() => ({
  generateContent: generateContentMock,
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = getGenerativeModelMock;
  },
  // The service references SchemaType at module load to build the response schema.
  SchemaType: {
    OBJECT: 'object',
    STRING: 'string',
    NUMBER: 'number',
    ARRAY: 'array',
    BOOLEAN: 'boolean',
  },
}));

vi.mock('../../repositories/index.js', () => ({
  commandRepository: {
    create: vi.fn(),
  },
}));

vi.mock('../TaskDistributor.js', () => ({
  taskDistributor: {
    createTask: vi.fn(),
  },
}));

vi.mock('../ExplainabilityService.js', () => ({
  explainabilityService: {
    createFromCommandInterpretation: vi.fn(),
  },
}));

vi.mock('../ComplianceLogService.js', () => ({
  complianceLogService: {
    logFromCommandInterpretation: vi.fn(),
  },
}));

import { CommandInterpreter } from '../CommandInterpreter.js';
import { commandRepository } from '../../repositories/index.js';
import { taskDistributor } from '../TaskDistributor.js';
import { explainabilityService } from '../ExplainabilityService.js';
import { complianceLogService } from '../ComplianceLogService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * commandRepository.create echoes the input back as a saved CommandInterpretation.
 * This lets us assert what the service computed (commandType, parameters, etc.)
 * by inspecting the returned/saved object.
 */
function wireRepoEcho(): void {
  vi.mocked(commandRepository.create).mockImplementation(
    async (input: CreateCommandInterpretationInput): Promise<CommandInterpretation> => ({
      id: 'cmd-1',
      robotId: input.robotId,
      originalText: input.originalText,
      commandType: input.commandType,
      parameters: input.parameters,
      confidence: input.confidence,
      safetyClassification: input.safetyClassification,
      warnings: input.warnings ?? [],
      suggestedAlternatives: input.suggestedAlternatives ?? [],
      status: 'interpreted',
      createdAt: new Date().toISOString(),
    })
  );
}

function geminiReturns(jsonOrText: string): void {
  generateContentMock.mockResolvedValue({
    response: { text: () => jsonOrText },
  });
}

const ORIGINAL_ENV = process.env.GOOGLE_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  wireRepoEcho();
  vi.mocked(explainabilityService.createFromCommandInterpretation).mockResolvedValue({
    id: 'decision-1',
  } as never);
  vi.mocked(complianceLogService.logFromCommandInterpretation).mockResolvedValue(
    undefined as never
  );
  vi.mocked(taskDistributor.createTask).mockResolvedValue({ id: 'task-1' } as never);
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.GOOGLE_API_KEY;
  } else {
    process.env.GOOGLE_API_KEY = ORIGINAL_ENV;
  }
});

// ===========================================================================
// FALLBACK INTERPRETATION (no API key)
// ===========================================================================

describe('CommandInterpreter — fallback keyword interpretation (no API key)', () => {
  let service: CommandInterpreter;

  beforeEach(() => {
    delete process.env.GOOGLE_API_KEY;
    service = new CommandInterpreter();
  });

  it('classifies emergency commands as dangerous with a warning', async () => {
    const result = await service.interpretCommand({
      text: 'Emergency stop now',
      robotId: 'robot-1',
    });
    expect(result.commandType).toBe('emergency');
    expect(result.safetyClassification).toBe('dangerous');
    expect(result.warnings).toContain('Emergency command detected');
  });

  it('classifies navigation and extracts target location + normal speed', async () => {
    const result = await service.interpretCommand({
      text: 'Move to the warehouse',
      robotId: 'robot-1',
    });
    expect(result.commandType).toBe('navigation');
    expect(result.parameters.target).toBe('warehouse');
    expect(result.parameters.speed).toBe('normal');
    // target present -> high confidence
    expect(result.confidence).toBe(0.85);
  });

  it('flags high-speed navigation as caution', async () => {
    const result = await service.interpretCommand({
      text: 'Move to dock quickly',
      robotId: 'robot-1',
    });
    expect(result.commandType).toBe('navigation');
    expect(result.parameters.speed).toBe('fast');
    expect(result.safetyClassification).toBe('caution');
    expect(result.warnings).toContain('High-speed movement requested');
  });

  it('detects slow speed modifier without raising safety', async () => {
    const result = await service.interpretCommand({
      text: 'Navigate to lab slowly',
      robotId: 'robot-1',
    });
    expect(result.parameters.speed).toBe('slow');
    expect(result.safetyClassification).toBe('safe');
  });

  it('classifies manipulation as caution and extracts objects', async () => {
    const result = await service.interpretCommand({
      text: 'Pick up the red box',
      robotId: 'robot-1',
    });
    expect(result.commandType).toBe('manipulation');
    expect(result.safetyClassification).toBe('caution');
    expect(result.parameters.objects).toEqual(['red box']);
    expect(result.warnings).toContain('Object manipulation requires caution');
  });

  it('classifies status queries as safe status commands', async () => {
    const result = await service.interpretCommand({
      text: 'check battery level',
      robotId: 'robot-1',
    });
    expect(result.commandType).toBe('status');
    expect(result.safetyClassification).toBe('safe');
  });

  it('falls back to custom with low confidence and suggests alternatives', async () => {
    const result = await service.interpretCommand({
      text: 'do a backflip somersault thing',
      robotId: 'robot-1',
    });
    expect(result.commandType).toBe('custom');
    expect(result.confidence).toBe(0.6);
    expect(result.suggestedAlternatives.length).toBeGreaterThan(0);
  });

  it('persists the interpretation via the repository', async () => {
    await service.interpretCommand({ text: 'get status', robotId: 'robot-42' });
    expect(commandRepository.create).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(commandRepository.create).mock.calls[0][0];
    expect(arg.robotId).toBe('robot-42');
    expect(arg.originalText).toBe('get status');
  });

  it('records explainability and compliance with the fallback model name', async () => {
    await service.interpretCommand({ text: 'get status', robotId: 'robot-1' });
    expect(explainabilityService.createFromCommandInterpretation).toHaveBeenCalledTimes(1);
    const explArg = vi.mocked(
      explainabilityService.createFromCommandInterpretation
    ).mock.calls[0][0];
    expect(explArg.modelUsed).toBe('fallback-keyword');

    expect(complianceLogService.logFromCommandInterpretation).toHaveBeenCalledTimes(1);
    const compArg = vi.mocked(
      complianceLogService.logFromCommandInterpretation
    ).mock.calls[0][0];
    expect(compArg.modelUsed).toBe('fallback-keyword');
    // decisionId should link to the explainability decision id
    expect(compArg.decisionId).toBe('decision-1');
  });
});

// ===========================================================================
// GEMINI PATH (API key present)
// ===========================================================================

describe('CommandInterpreter — Gemini path', () => {
  let service: CommandInterpreter;

  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'fake-key';
    service = new CommandInterpreter();
  });

  it('builds a prompt without context when none given', async () => {
    geminiReturns(
      JSON.stringify({
        commandType: 'status',
        parameters: {},
        confidence: 0.9,
        safetyClassification: 'safe',
        warnings: [],
        suggestedAlternatives: [],
      })
    );
    await service.interpretCommand({ text: 'report position', robotId: 'r1' });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const prompt = generateContentMock.mock.calls[0][0] as string;
    expect(prompt).toBe('Command: "report position"');
  });

  it('includes serialized context in the prompt when provided', async () => {
    geminiReturns(
      JSON.stringify({
        commandType: 'navigation',
        parameters: { target: 'dock' },
        confidence: 0.95,
        safetyClassification: 'safe',
        warnings: [],
        suggestedAlternatives: [],
      })
    );
    await service.interpretCommand({
      text: 'go home',
      robotId: 'r1',
      context: { zone: 'A', battery: 42 },
    });
    const prompt = generateContentMock.mock.calls[0][0] as string;
    expect(prompt).toContain('Command: "go home"');
    expect(prompt).toContain('Context:');
    expect(prompt).toContain('"zone":"A"');
    expect(prompt).toContain('"battery":42');
  });

  it('parses a well-formed Gemini JSON response into the interpretation', async () => {
    geminiReturns(
      JSON.stringify({
        commandType: 'manipulation',
        parameters: { objects: ['bottle'], speed: 'slow', quantity: 2 },
        confidence: 0.88,
        safetyClassification: 'caution',
        warnings: ['fragile item'],
        suggestedAlternatives: [],
      })
    );
    const result = await service.interpretCommand({
      text: 'pick up the bottle',
      robotId: 'r1',
    });
    expect(result.commandType).toBe('manipulation');
    expect(result.parameters.objects).toEqual(['bottle']);
    expect(result.parameters.speed).toBe('slow');
    expect(result.parameters.quantity).toBe(2);
    expect(result.confidence).toBe(0.88);
    expect(result.safetyClassification).toBe('caution');
    expect(result.warnings).toEqual(['fragile item']);
  });

  it('uses the gemini model name in explainability/compliance records', async () => {
    geminiReturns(
      JSON.stringify({
        commandType: 'status',
        parameters: {},
        confidence: 0.9,
        safetyClassification: 'safe',
        warnings: [],
        suggestedAlternatives: [],
      })
    );
    await service.interpretCommand({ text: 'status', robotId: 'r1' });
    const explArg = vi.mocked(
      explainabilityService.createFromCommandInterpretation
    ).mock.calls[0][0];
    expect(explArg.modelUsed).toBe('gemini-2.0-flash');
  });

  it('falls back to keyword interpretation when Gemini returns malformed JSON', async () => {
    // Not valid JSON -> JSON.parse throws -> service uses keyword fallback on the text
    geminiReturns('this is not json {');
    const result = await service.interpretCommand({
      text: 'Move to the warehouse',
      robotId: 'r1',
    });
    // Keyword fallback should classify this as navigation with target extracted
    expect(result.commandType).toBe('navigation');
    expect(result.parameters.target).toBe('warehouse');
  });

  it('falls back to keyword interpretation when generateContent throws', async () => {
    generateContentMock.mockRejectedValue(new Error('network down'));
    const result = await service.interpretCommand({
      text: 'Emergency stop',
      robotId: 'r1',
    });
    expect(result.commandType).toBe('emergency');
    expect(result.safetyClassification).toBe('dangerous');
  });
});

// ===========================================================================
// RESILIENCE: explainability / compliance failures must not break the command
// ===========================================================================

describe('CommandInterpreter — non-fatal side-effect failures', () => {
  let service: CommandInterpreter;

  beforeEach(() => {
    delete process.env.GOOGLE_API_KEY;
    service = new CommandInterpreter();
  });

  it('still returns the saved interpretation if explainability storage fails', async () => {
    vi.mocked(explainabilityService.createFromCommandInterpretation).mockRejectedValue(
      new Error('explainability down')
    );
    const result = await service.interpretCommand({
      text: 'get status',
      robotId: 'r1',
    });
    expect(result.id).toBe('cmd-1');
    // When explainability fails, compliance falls back to linking the saved id
    const compArg = vi.mocked(
      complianceLogService.logFromCommandInterpretation
    ).mock.calls[0][0];
    expect(compArg.decisionId).toBe('cmd-1');
  });

  it('still returns the saved interpretation if compliance logging fails', async () => {
    vi.mocked(complianceLogService.logFromCommandInterpretation).mockRejectedValue(
      new Error('compliance down')
    );
    const result = await service.interpretCommand({
      text: 'get status',
      robotId: 'r1',
    });
    expect(result.id).toBe('cmd-1');
  });
});

// ===========================================================================
// interpretAndExecute — guards + command mapping + task creation
// ===========================================================================

describe('CommandInterpreter.interpretAndExecute', () => {
  let service: CommandInterpreter;

  beforeEach(() => {
    delete process.env.GOOGLE_API_KEY;
    service = new CommandInterpreter();
  });

  it('blocks execution for dangerous commands', async () => {
    const result = await service.interpretAndExecute({
      text: 'Emergency stop',
      robotId: 'r1',
    });
    expect(result.executed).toBe(false);
    expect(result.reason).toContain('dangerous');
    expect(taskDistributor.createTask).not.toHaveBeenCalled();
  });

  it('blocks execution when confidence is too low', async () => {
    // Force a low-confidence custom interpretation via the repo echo:
    // craft an interpretation that the service produces (custom => 0.6),
    // but we need < 0.5. Override repo to return a low-confidence safe command.
    vi.mocked(commandRepository.create).mockResolvedValue({
      id: 'cmd-low',
      robotId: 'r1',
      originalText: 'mumble',
      commandType: 'custom',
      parameters: {},
      confidence: 0.3,
      safetyClassification: 'safe',
      warnings: [],
      suggestedAlternatives: [],
      status: 'interpreted',
      createdAt: new Date().toISOString(),
    });
    const result = await service.interpretAndExecute({
      text: 'mumble',
      robotId: 'r1',
    });
    expect(result.executed).toBe(false);
    expect(result.reason).toContain('confidence too low');
    expect(taskDistributor.createTask).not.toHaveBeenCalled();
  });

  it('does not create a task for status commands (unmappable action type)', async () => {
    const result = await service.interpretAndExecute({
      text: 'check battery',
      robotId: 'r1',
    });
    expect(result.executed).toBe(false);
    expect(result.reason).toContain('cannot be mapped');
    expect(taskDistributor.createTask).not.toHaveBeenCalled();
  });

  it('creates a navigation task with mapped action type, config and priority', async () => {
    const result = await service.interpretAndExecute({
      text: 'Move to the warehouse',
      robotId: 'r1',
    });
    expect(result.executed).toBe(true);
    expect(result.task).toEqual({ id: 'task-1' });

    expect(taskDistributor.createTask).toHaveBeenCalledTimes(1);
    const [taskInput, source] = vi.mocked(taskDistributor.createTask).mock.calls[0];
    expect(taskInput.robotId).toBe('r1');
    expect(taskInput.actionType).toBe('move_to_location');
    expect(taskInput.instruction).toBe('Move to the warehouse');
    // safe navigation -> normal priority
    expect(taskInput.priority).toBe('normal');
    // target should be reflected in action config
    expect(taskInput.actionConfig).toMatchObject({
      target: 'warehouse',
      zoneName: 'warehouse',
    });
    expect(source).toBe('command');
  });

  it('maps caution manipulation to high priority and pickup action', async () => {
    const result = await service.interpretAndExecute({
      text: 'Pick up the wrench',
      robotId: 'r1',
    });
    expect(result.executed).toBe(true);
    const [taskInput] = vi.mocked(taskDistributor.createTask).mock.calls[0];
    expect(taskInput.actionType).toBe('pickup_object');
    expect(taskInput.priority).toBe('high');
    expect(taskInput.actionConfig).toMatchObject({
      objectId: 'wrench',
      objects: ['wrench'],
    });
  });
});
