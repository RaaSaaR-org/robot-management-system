/**
 * @file mockData.ts
 * @description Mock data for development/testing mode
 * @feature mocks
 * @dependencies @/features/auth/types, @/features/robots/types
 */

import type { User } from '@/features/auth/types';
import type { CommandType } from '@/features/robots/types';
import type {
  CommandInterpretation,
  InterpretCommandRequest,
  SafetyClassification,
} from '@/features/command/types';

// ============================================================================
// MOCK USER
// ============================================================================

export const MOCK_USER: User = {
  id: 'dev-user-001',
  email: 'dev@neodem.local',
  name: 'Dev Admin',
  role: 'super-admin',
  avatar: undefined,
  tenantId: 'dev-tenant',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: new Date().toISOString(),
  lastLoginAt: new Date().toISOString(),
};

// ============================================================================
// MOCK VLA INTERPRETATIONS
// ============================================================================

/** Sample NL commands mapped to interpretations */
const NL_COMMAND_PATTERNS: Array<{
  patterns: string[];
  commandType: CommandType;
  safetyClassification: SafetyClassification;
  confidence: number;
}> = [
  {
    patterns: ['move to', 'go to', 'navigate to', 'head to'],
    commandType: 'move',
    safetyClassification: 'safe',
    confidence: 0.95,
  },
  {
    patterns: ['pick up', 'grab', 'lift', 'get the'],
    commandType: 'pickup',
    safetyClassification: 'caution',
    confidence: 0.88,
  },
  {
    patterns: ['drop', 'put down', 'place', 'set down'],
    commandType: 'drop',
    safetyClassification: 'safe',
    confidence: 0.92,
  },
  {
    patterns: ['stop', 'halt', 'freeze'],
    commandType: 'stop',
    safetyClassification: 'safe',
    confidence: 0.99,
  },
  {
    patterns: ['charge', 'go charge', 'recharge', 'get power'],
    commandType: 'charge',
    safetyClassification: 'safe',
    confidence: 0.97,
  },
  {
    patterns: ['return home', 'go home', 'back to base'],
    commandType: 'return_home',
    safetyClassification: 'safe',
    confidence: 0.96,
  },
  {
    patterns: ['emergency stop', 'e-stop', 'abort'],
    commandType: 'emergency_stop',
    safetyClassification: 'dangerous',
    confidence: 0.99,
  },
];

/**
 * Generate a mock VLA interpretation from natural language text
 */
export function getMockInterpretation(request: InterpretCommandRequest): CommandInterpretation {
  const text = request.text.toLowerCase().trim();

  // Find matching command pattern
  let matched = NL_COMMAND_PATTERNS.find((p) => p.patterns.some((pattern) => text.includes(pattern)));

  // Default to 'custom' if no match
  if (!matched) {
    matched = {
      patterns: [],
      commandType: 'custom',
      safetyClassification: 'caution',
      confidence: 0.65,
    };
  }

  // Extract potential target from text
  const words = text.split(' ');
  const targetIndex = words.findIndex((w) =>
    ['warehouse', 'zone', 'dock', 'station', 'area', 'office', 'room', 'bay'].includes(w)
  );
  const target = targetIndex >= 0 ? words.slice(targetIndex).join(' ') : undefined;

  // Extract objects
  const objectKeywords = ['box', 'pallet', 'package', 'item', 'crate'];
  const objects = objectKeywords.filter((obj) => text.includes(obj));

  // Generate warnings based on command type
  const warnings: string[] = [];
  if (matched.safetyClassification === 'dangerous') {
    warnings.push('This is a high-priority emergency action');
  }

  // Generate alternatives for low confidence
  const suggestedAlternatives: string[] = [];
  if (matched.confidence < 0.8) {
    suggestedAlternatives.push('Did you mean: "Move to Warehouse A"?');
    suggestedAlternatives.push('Did you mean: "Pick up the pallet"?');
  }

  return {
    id: `interp-${Date.now()}`,
    originalText: request.text,
    commandType: matched.commandType,
    parameters: {
      target: target || (matched.commandType === 'move' ? 'Warehouse A' : undefined),
      destination:
        matched.commandType === 'move'
          ? { x: 20 + Math.random() * 20, y: 10 + Math.random() * 10 }
          : undefined,
      objects: objects.length > 0 ? objects : undefined,
      quantity: text.match(/\d+/) ? parseInt(text.match(/\d+/)![0]) : undefined,
    },
    confidence: matched.confidence + (Math.random() * 0.1 - 0.05), // Add slight variance
    safetyClassification: matched.safetyClassification,
    warnings: warnings.length > 0 ? warnings : undefined,
    suggestedAlternatives: suggestedAlternatives.length > 0 ? suggestedAlternatives : undefined,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// MOCK API HELPERS
// ============================================================================

/**
 * Simulate network delay
 */
export function mockDelay(ms: number = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
