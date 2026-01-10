/**
 * @file ExplainabilityService.ts
 * @description Service for AI explainability and transparency per EU AI Act Art. 13, Art. 50
 */

import {
  decisionRepository,
  type DecisionExplanation,
  type CreateDecisionInput,
  type DecisionListResponse,
  type DecisionQueryParams,
  type AIPerformanceMetrics,
  type AIDocumentation,
  type DecisionInputFactors,
  type AlternativeConsidered,
  type DecisionSafetyFactors,
  type DecisionType,
  type SafetyClassification,
} from '../repositories/DecisionRepository.js';

// ============================================================================
// RE-EXPORT TYPES
// ============================================================================

export {
  type DecisionExplanation,
  type CreateDecisionInput,
  type DecisionListResponse,
  type DecisionQueryParams,
  type AIPerformanceMetrics,
  type AIDocumentation,
  type DecisionInputFactors,
  type AlternativeConsidered,
  type DecisionSafetyFactors,
  type DecisionType,
  type SafetyClassification,
};

// ============================================================================
// FORMATTED EXPLANATION
// ============================================================================

export interface FormattedExplanation {
  id: string;
  summary: string;
  decisionType: string;
  confidence: {
    score: number;
    level: 'high' | 'medium' | 'low';
    description: string;
  };
  inputFactors: {
    title: string;
    items: Array<{ label: string; value: string }>;
  };
  reasoning: {
    title: string;
    steps: string[];
  };
  alternatives: {
    title: string;
    items: Array<{ action: string; reason: string; rejected?: string }>;
  };
  safety: {
    classification: SafetyClassification;
    warnings: string[];
    constraints: string[];
  };
  metadata: {
    modelUsed: string;
    timestamp: string;
    robotId: string;
  };
}

// ============================================================================
// STATIC AI DOCUMENTATION
// ============================================================================

const AI_DOCUMENTATION: AIDocumentation = {
  intendedPurpose:
    'Interpret natural language commands for humanoid robot control and provide intelligent task execution decisions.',
  capabilities: [
    'Natural language command interpretation',
    'Safety classification of commands',
    'Confidence scoring for decision accuracy',
    'Context-aware command processing',
    'Task prioritization and routing',
    'Alternative suggestion generation',
  ],
  limitations: [
    'May misinterpret ambiguous or complex multi-step commands',
    'Performance degrades with non-English commands',
    'Cannot process commands requiring real-time visual input',
    'Limited understanding of domain-specific terminology outside trained scope',
    'Confidence scores are estimates, not guarantees of correctness',
    'Safety classifications are conservative and may flag safe commands as caution',
  ],
  operatingConditions: [
    'Requires stable network connection to LLM service',
    'Best performance with clear, concise commands under 200 characters',
    'Optimal for warehouse, manufacturing, and logistics environments',
    'Indoor operation with mapped environment zones',
    'Supports standard robot actions: navigation, manipulation, status queries',
  ],
  humanOversightRequirements: [
    'Human approval required for commands classified as "dangerous"',
    'Manual confirmation recommended for commands with confidence below 0.7',
    'Emergency stop capability must remain accessible at all times',
    'Operator must monitor robot operations in restricted zones',
    'Periodic review of AI decisions required for compliance',
  ],
  version: '1.0.0',
  lastUpdated: new Date().toISOString().split('T')[0],
};

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class ExplainabilityService {
  constructor() {
    console.log('[ExplainabilityService] Initialized');
  }

  // ==========================================================================
  // DECISION CRUD
  // ==========================================================================

  /**
   * Store a new AI decision for explainability tracking
   */
  async storeDecision(input: CreateDecisionInput): Promise<DecisionExplanation> {
    console.log(`[ExplainabilityService] Storing decision for entity ${input.entityId}`);
    return decisionRepository.create(input);
  }

  /**
   * Get a decision by ID
   */
  async getDecision(id: string): Promise<DecisionExplanation | null> {
    return decisionRepository.findById(id);
  }

  /**
   * Get a decision by entity ID (e.g., CommandInterpretation ID)
   */
  async getDecisionByEntityId(entityId: string): Promise<DecisionExplanation | null> {
    return decisionRepository.findByEntityId(entityId);
  }

  /**
   * List decisions with optional filters and pagination
   */
  async listDecisions(params?: DecisionQueryParams): Promise<DecisionListResponse> {
    return decisionRepository.findAll(params);
  }

  /**
   * List decisions for a specific robot
   */
  async listRobotDecisions(
    robotId: string,
    params?: Omit<DecisionQueryParams, 'robotId'>
  ): Promise<DecisionListResponse> {
    return decisionRepository.findByRobotId(robotId, params);
  }

  /**
   * Delete a decision
   */
  async deleteDecision(id: string): Promise<boolean> {
    return decisionRepository.delete(id);
  }

  // ==========================================================================
  // FORMATTED EXPLANATIONS (Art. 13(1))
  // ==========================================================================

  /**
   * Get a human-readable formatted explanation for a decision
   */
  async getFormattedExplanation(id: string): Promise<FormattedExplanation | null> {
    const decision = await decisionRepository.findById(id);
    if (!decision) return null;

    return this.formatExplanation(decision);
  }

  /**
   * Format a decision into a human-readable explanation
   */
  formatExplanation(decision: DecisionExplanation): FormattedExplanation {
    const confidenceLevel = this.getConfidenceLevel(decision.confidence);

    return {
      id: decision.id,
      summary: this.generateSummary(decision),
      decisionType: this.formatDecisionType(decision.decisionType),
      confidence: {
        score: decision.confidence,
        level: confidenceLevel,
        description: this.getConfidenceDescription(decision.confidence, confidenceLevel),
      },
      inputFactors: {
        title: 'Input Factors',
        items: this.formatInputFactors(decision.inputFactors),
      },
      reasoning: {
        title: 'Decision Reasoning',
        steps: decision.reasoning,
      },
      alternatives: {
        title: 'Alternatives Considered',
        items: decision.alternatives.map((alt) => ({
          action: alt.action,
          reason: alt.reason,
          rejected: alt.rejectionReason,
        })),
      },
      safety: {
        classification: decision.safetyFactors.classification,
        warnings: decision.safetyFactors.warnings,
        constraints: decision.safetyFactors.constraints,
      },
      metadata: {
        modelUsed: decision.modelUsed,
        timestamp: decision.createdAt,
        robotId: decision.robotId,
      },
    };
  }

  /**
   * Generate a plain-English summary of the decision
   */
  private generateSummary(decision: DecisionExplanation): string {
    const action = decision.inputFactors.userCommand || 'Unknown command';
    const typeLabel = this.formatDecisionType(decision.decisionType);
    const confidence = Math.round(decision.confidence * 100);
    const safety = decision.safetyFactors.classification;

    return `${typeLabel}: "${action}" was processed with ${confidence}% confidence. Safety classification: ${safety}.`;
  }

  /**
   * Format decision type for display
   */
  private formatDecisionType(type: DecisionType): string {
    const labels: Record<DecisionType, string> = {
      command_interpretation: 'Command Interpretation',
      task_execution: 'Task Execution',
      safety_action: 'Safety Action',
    };
    return labels[type] || type;
  }

  /**
   * Get confidence level category
   */
  private getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.6) return 'medium';
    return 'low';
  }

  /**
   * Get confidence description
   */
  private getConfidenceDescription(
    confidence: number,
    level: 'high' | 'medium' | 'low'
  ): string {
    const percentage = Math.round(confidence * 100);
    switch (level) {
      case 'high':
        return `The AI is ${percentage}% confident in this interpretation. The command was clear and unambiguous.`;
      case 'medium':
        return `The AI is ${percentage}% confident in this interpretation. Some ambiguity was detected.`;
      case 'low':
        return `The AI is only ${percentage}% confident in this interpretation. Human verification recommended.`;
    }
  }

  /**
   * Format input factors for display
   */
  private formatInputFactors(
    factors: DecisionInputFactors
  ): Array<{ label: string; value: string }> {
    const items: Array<{ label: string; value: string }> = [];

    if (factors.userCommand) {
      items.push({ label: 'User Command', value: factors.userCommand });
    }

    if (factors.robotState) {
      if (factors.robotState.status) {
        items.push({ label: 'Robot Status', value: factors.robotState.status });
      }
      if (factors.robotState.batteryLevel !== undefined) {
        items.push({
          label: 'Battery Level',
          value: `${factors.robotState.batteryLevel}%`,
        });
      }
      if (factors.robotState.location) {
        const loc = factors.robotState.location;
        items.push({
          label: 'Robot Location',
          value: `(${loc.x}, ${loc.y}${loc.z !== undefined ? `, ${loc.z}` : ''})`,
        });
      }
      if (factors.robotState.heldObject) {
        items.push({ label: 'Held Object', value: factors.robotState.heldObject });
      }
    }

    if (factors.environmentContext) {
      if (factors.environmentContext.zones?.length) {
        items.push({
          label: 'Active Zones',
          value: factors.environmentContext.zones.join(', '),
        });
      }
      if (factors.environmentContext.restrictions?.length) {
        items.push({
          label: 'Restrictions',
          value: factors.environmentContext.restrictions.join(', '),
        });
      }
    }

    if (factors.conversationHistory?.length) {
      items.push({
        label: 'Conversation Context',
        value: `${factors.conversationHistory.length} previous messages`,
      });
    }

    return items;
  }

  // ==========================================================================
  // PERFORMANCE METRICS (Art. 13(3)(b))
  // ==========================================================================

  /**
   * Get AI performance metrics for a time period
   */
  async getPerformanceMetrics(
    period: 'daily' | 'weekly' | 'monthly' = 'weekly',
    robotId?: string
  ): Promise<AIPerformanceMetrics> {
    return decisionRepository.getMetrics(period, robotId);
  }

  // ==========================================================================
  // DOCUMENTATION (Art. 13(3)(a))
  // ==========================================================================

  /**
   * Get AI system documentation
   */
  getDocumentation(): AIDocumentation {
    return { ...AI_DOCUMENTATION };
  }

  // ==========================================================================
  // LIMITATIONS (Art. 13(3)(c))
  // ==========================================================================

  /**
   * Get AI system limitations
   */
  getLimitations(): string[] {
    return [...AI_DOCUMENTATION.limitations];
  }

  /**
   * Get operating conditions
   */
  getOperatingConditions(): string[] {
    return [...AI_DOCUMENTATION.operatingConditions];
  }

  /**
   * Get human oversight requirements
   */
  getHumanOversightRequirements(): string[] {
    return [...AI_DOCUMENTATION.humanOversightRequirements];
  }

  // ==========================================================================
  // HELPER FOR COMMAND INTERPRETER INTEGRATION
  // ==========================================================================

  /**
   * Create a decision record from a command interpretation result
   * Helper method to be called from CommandInterpreter
   */
  async createFromCommandInterpretation(params: {
    entityId: string;
    robotId: string;
    originalText: string;
    commandType: string;
    confidence: number;
    safetyClassification: SafetyClassification;
    warnings: string[];
    suggestedAlternatives: string[];
    modelUsed: string;
    robotState?: DecisionInputFactors['robotState'];
  }): Promise<DecisionExplanation> {
    const input: CreateDecisionInput = {
      decisionType: 'command_interpretation',
      entityId: params.entityId,
      robotId: params.robotId,
      inputFactors: {
        userCommand: params.originalText,
        robotState: params.robotState || {},
      },
      reasoning: [
        `Interpreted command as: ${params.commandType}`,
        `Applied safety rules to classify as: ${params.safetyClassification}`,
        `Calculated confidence based on command clarity: ${Math.round(params.confidence * 100)}%`,
        ...(params.warnings.length > 0
          ? [`Generated ${params.warnings.length} warning(s) for user review`]
          : []),
      ],
      modelUsed: params.modelUsed,
      confidence: params.confidence,
      alternatives: params.suggestedAlternatives.map((alt) => ({
        action: alt,
        reason: 'Suggested as alternative interpretation',
      })),
      safetyFactors: {
        classification: params.safetyClassification,
        warnings: params.warnings,
        constraints: [],
      },
    };

    return this.storeDecision(input);
  }
}

export const explainabilityService = new ExplainabilityService();
