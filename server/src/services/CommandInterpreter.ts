/**
 * @file CommandInterpreter.ts
 * @description Service for interpreting natural language commands using Gemini LLM
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';
import {
  commandRepository,
  type CommandInterpretation,
  type CommandParameters,
  type CommandType,
  type SafetyClassification,
  type CreateCommandInterpretationInput,
} from '../repositories/index.js';
import { taskDistributor } from './TaskDistributor.js';
import { explainabilityService } from './ExplainabilityService.js';
import type { StepActionType } from '../types/process.types.js';
import type { RobotTask } from '../types/robotTask.types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface InterpretCommandRequest {
  text: string;
  robotId: string;
  context?: Record<string, unknown>;
}

export interface InterpretAndExecuteResult {
  interpretation: CommandInterpretation;
  task?: RobotTask;
  executed: boolean;
  reason?: string;
}

interface LLMInterpretationResult {
  commandType: string;
  parameters: {
    target?: string;
    destination?: { x: number; y: number; z?: number };
    quantity?: number;
    objects?: string[];
    speed?: string;
    custom?: Record<string, unknown>;
  };
  confidence: number;
  safetyClassification: string;
  warnings: string[];
  suggestedAlternatives: string[];
}

// ============================================================================
// RESPONSE SCHEMA
// ============================================================================

const interpretationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    commandType: {
      type: SchemaType.STRING,
      description:
        'The type of command: navigation, manipulation, status, emergency, or custom',
      enum: ['navigation', 'manipulation', 'status', 'emergency', 'custom'],
    },
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        target: {
          type: SchemaType.STRING,
          description: 'Target object or location name',
          nullable: true,
        },
        destination: {
          type: SchemaType.OBJECT,
          properties: {
            x: { type: SchemaType.NUMBER },
            y: { type: SchemaType.NUMBER },
            z: { type: SchemaType.NUMBER, nullable: true },
          },
          nullable: true,
        },
        quantity: {
          type: SchemaType.NUMBER,
          description: 'Quantity for pickup/drop commands',
          nullable: true,
        },
        objects: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'Objects involved in the action',
          nullable: true,
        },
        speed: {
          type: SchemaType.STRING,
          description: 'Speed modifier',
          enum: ['slow', 'normal', 'fast'],
          nullable: true,
        },
      },
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: 'Confidence score from 0.0 to 1.0',
    },
    safetyClassification: {
      type: SchemaType.STRING,
      description: 'Safety classification of the command',
      enum: ['safe', 'caution', 'dangerous'],
    },
    warnings: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Warning messages if any',
    },
    suggestedAlternatives: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Alternative command suggestions if confidence is low',
    },
  },
  required: [
    'commandType',
    'parameters',
    'confidence',
    'safetyClassification',
    'warnings',
    'suggestedAlternatives',
  ],
};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are a robot command interpreter for a humanoid robot fleet management system.

Your task is to interpret natural language commands and convert them into structured robot commands.

## Command Types:
- **navigation**: Move, go to, navigate, travel, return home, go to charging station
- **manipulation**: Pick up, grab, drop, place, hold, release objects
- **status**: Get status, check battery, report position, system info queries
- **emergency**: Emergency stop, halt, abort, stop immediately
- **custom**: Any command that doesn't fit the above categories

## Safety Classification Rules:
- **dangerous**: Emergency stop commands, force overrides, safety system bypasses, commands that could cause harm
- **caution**: High-speed movement, heavy object manipulation, commands in restricted areas, unfamiliar operations
- **safe**: Status queries, normal navigation, standard object manipulation, routine operations

## Confidence Scoring:
- 0.9-1.0: Very clear command with explicit intent
- 0.7-0.89: Reasonably clear but some ambiguity
- 0.5-0.69: Ambiguous, may need clarification
- 0.0-0.49: Very unclear or potentially misunderstood

## Guidelines:
1. Extract specific locations, objects, and quantities when mentioned
2. Infer reasonable defaults when not specified (e.g., normal speed)
3. Add warnings for potentially risky operations
4. Suggest alternatives when confidence is below 0.7
5. For location-based commands, try to identify named zones (e.g., "warehouse", "charging station", "assembly line")`;

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class CommandInterpreter {
  private genAI: GoogleGenerativeAI | null = null;
  private modelName = 'gemini-2.0-flash';

  constructor() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      console.log('[CommandInterpreter] Initialized with Gemini');
    } else {
      console.warn(
        '[CommandInterpreter] GOOGLE_API_KEY not set, will use fallback interpretation'
      );
    }
  }

  /**
   * Interpret a natural language command using Gemini LLM
   */
  async interpretCommand(
    request: InterpretCommandRequest
  ): Promise<CommandInterpretation> {
    const { text, robotId, context } = request;

    let interpretation: LLMInterpretationResult;

    if (this.genAI) {
      try {
        interpretation = await this.interpretWithGemini(text, context);
      } catch (error) {
        console.warn('[CommandInterpreter] Gemini failed, using fallback:', error);
        interpretation = this.fallbackInterpretation(text);
      }
    } else {
      interpretation = this.fallbackInterpretation(text);
    }

    // Create input for repository
    const createInput: CreateCommandInterpretationInput = {
      robotId,
      originalText: text,
      commandType: interpretation.commandType as CommandType,
      parameters: this.normalizeParameters(interpretation.parameters),
      confidence: interpretation.confidence,
      safetyClassification: interpretation.safetyClassification as SafetyClassification,
      warnings: interpretation.warnings,
      suggestedAlternatives: interpretation.suggestedAlternatives,
    };

    // Save to database and return
    const saved = await commandRepository.create(createInput);

    // Store decision for explainability (EU AI Act Art. 13)
    try {
      await explainabilityService.createFromCommandInterpretation({
        entityId: saved.id,
        robotId,
        originalText: text,
        commandType: interpretation.commandType,
        confidence: interpretation.confidence,
        safetyClassification: interpretation.safetyClassification as SafetyClassification,
        warnings: interpretation.warnings,
        suggestedAlternatives: interpretation.suggestedAlternatives,
        modelUsed: this.genAI ? this.modelName : 'fallback-keyword',
      });
      console.log(`[CommandInterpreter] Decision stored for explainability: ${saved.id}`);
    } catch (error) {
      // Don't fail the command if explainability storage fails
      console.warn('[CommandInterpreter] Failed to store decision for explainability:', error);
    }

    return saved;
  }

  /**
   * Interpret command using Gemini LLM
   */
  private async interpretWithGemini(
    text: string,
    context?: Record<string, unknown>
  ): Promise<LLMInterpretationResult> {
    if (!this.genAI) {
      throw new Error('Gemini not initialized');
    }

    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: interpretationSchema,
      },
      systemInstruction: SYSTEM_PROMPT,
    });

    const prompt = context
      ? `Command: "${text}"\n\nContext: ${JSON.stringify(context)}`
      : `Command: "${text}"`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const responseText = response.text();

    try {
      return JSON.parse(responseText) as LLMInterpretationResult;
    } catch (error) {
      console.error('[CommandInterpreter] Failed to parse Gemini response:', responseText);
      return this.fallbackInterpretation(text);
    }
  }

  /**
   * Fallback interpretation when Gemini is not available
   */
  private fallbackInterpretation(text: string): LLMInterpretationResult {
    const lowerText = text.toLowerCase();

    // Simple keyword-based classification
    let commandType: string = 'custom';
    let safetyClassification: string = 'safe';
    const warnings: string[] = [];
    const suggestedAlternatives: string[] = [];
    const parameters: LLMInterpretationResult['parameters'] = {};

    // Emergency commands
    if (
      lowerText.includes('emergency') ||
      lowerText.includes('stop') ||
      lowerText.includes('halt') ||
      lowerText.includes('abort')
    ) {
      commandType = 'emergency';
      safetyClassification = 'dangerous';
      warnings.push('Emergency command detected');
    }
    // Navigation commands
    else if (
      lowerText.includes('move') ||
      lowerText.includes('go to') ||
      lowerText.includes('navigate') ||
      lowerText.includes('travel') ||
      lowerText.includes('return') ||
      lowerText.includes('come')
    ) {
      commandType = 'navigation';
      // Extract target location
      const locationMatch = text.match(
        /(?:to|towards?|at)\s+(?:the\s+)?([a-zA-Z0-9\s]+?)(?:\s*$|\.|\,)/i
      );
      if (locationMatch) {
        parameters.target = locationMatch[1].trim();
      }
      // Check for speed modifiers
      if (lowerText.includes('fast') || lowerText.includes('quickly')) {
        parameters.speed = 'fast';
        safetyClassification = 'caution';
        warnings.push('High-speed movement requested');
      } else if (lowerText.includes('slow') || lowerText.includes('carefully')) {
        parameters.speed = 'slow';
      } else {
        parameters.speed = 'normal';
      }
    }
    // Manipulation commands
    else if (
      lowerText.includes('pick') ||
      lowerText.includes('grab') ||
      lowerText.includes('drop') ||
      lowerText.includes('place') ||
      lowerText.includes('hold') ||
      lowerText.includes('release')
    ) {
      commandType = 'manipulation';
      safetyClassification = 'caution';
      // Extract objects
      const objectMatch = text.match(
        /(?:pick up|grab|drop|place|hold|release)\s+(?:the\s+)?([a-zA-Z0-9\s]+?)(?:\s*$|\.|\,)/i
      );
      if (objectMatch) {
        parameters.objects = [objectMatch[1].trim()];
      }
      warnings.push('Object manipulation requires caution');
    }
    // Status commands
    else if (
      lowerText.includes('status') ||
      lowerText.includes('battery') ||
      lowerText.includes('position') ||
      lowerText.includes('check') ||
      lowerText.includes('report')
    ) {
      commandType = 'status';
    }

    // Calculate confidence based on how well we understood the command
    let confidence = 0.6;
    if (commandType !== 'custom') {
      confidence = 0.75;
    }
    if (parameters.target || parameters.objects?.length) {
      confidence = 0.85;
    }

    // Add alternatives for low confidence
    if (confidence < 0.7) {
      suggestedAlternatives.push(
        'Please be more specific about the action you want the robot to take'
      );
    }

    return {
      commandType,
      parameters,
      confidence,
      safetyClassification,
      warnings,
      suggestedAlternatives,
    };
  }

  /**
   * Normalize parameters from LLM response
   */
  private normalizeParameters(
    params: LLMInterpretationResult['parameters']
  ): CommandParameters {
    return {
      target: params.target,
      destination: params.destination,
      quantity: params.quantity,
      objects: params.objects,
      speed: params.speed as CommandParameters['speed'],
      custom: params.custom,
    };
  }

  /**
   * Interpret a command AND create a RobotTask for execution
   * This is the main entry point for the command execution flow
   */
  async interpretAndExecute(
    request: InterpretCommandRequest
  ): Promise<InterpretAndExecuteResult> {
    // First, interpret the command
    const interpretation = await this.interpretCommand(request);

    // Check if we should execute
    if (interpretation.safetyClassification === 'dangerous') {
      return {
        interpretation,
        executed: false,
        reason: 'Command classified as dangerous. Execution blocked for safety.',
      };
    }

    if (interpretation.confidence < 0.5) {
      return {
        interpretation,
        executed: false,
        reason: 'Command confidence too low. Please clarify your intent.',
      };
    }

    // Map command type to action type
    const actionType = this.mapCommandToActionType(interpretation.commandType);
    if (!actionType) {
      return {
        interpretation,
        executed: false,
        reason: `Command type "${interpretation.commandType}" cannot be mapped to a robot action.`,
      };
    }

    // Build action config from parameters
    const actionConfig = this.buildActionConfig(interpretation);

    // Create RobotTask via TaskDistributor
    const task = await taskDistributor.createTask(
      {
        robotId: request.robotId,
        actionType,
        actionConfig,
        instruction: request.text,
        priority: this.mapSafetyToPriority(interpretation.safetyClassification),
      },
      'command'
    );

    return {
      interpretation,
      task,
      executed: true,
    };
  }

  /**
   * Map command type to step action type
   */
  private mapCommandToActionType(commandType: CommandType): StepActionType | null {
    const mapping: Record<CommandType, StepActionType | null> = {
      navigation: 'move_to_location',
      manipulation: 'pickup_object', // or drop_object depending on context
      status: null, // Status queries don't create tasks
      emergency: null, // Emergency handled separately
      custom: 'custom',
    };
    return mapping[commandType] ?? null;
  }

  /**
   * Build action config from interpretation parameters
   */
  private buildActionConfig(interpretation: CommandInterpretation): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    const params = interpretation.parameters;

    if (params.destination) {
      config.location = params.destination;
    }

    if (params.target) {
      config.target = params.target;
      // Try to resolve target to zone location
      config.zoneName = params.target;
    }

    if (params.objects && params.objects.length > 0) {
      config.objectId = params.objects[0];
      config.objects = params.objects;
    }

    if (params.speed) {
      config.speed = params.speed;
    }

    if (params.quantity) {
      config.quantity = params.quantity;
    }

    return config;
  }

  /**
   * Map safety classification to task priority
   */
  private mapSafetyToPriority(safety: SafetyClassification): 'low' | 'normal' | 'high' | 'critical' {
    switch (safety) {
      case 'dangerous':
        return 'critical'; // Should be blocked anyway
      case 'caution':
        return 'high';
      case 'safe':
      default:
        return 'normal';
    }
  }
}

export const commandInterpreter = new CommandInterpreter();
