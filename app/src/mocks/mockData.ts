/**
 * @file mockData.ts
 * @description Mock data for development/testing mode
 * @feature mocks
 * @dependencies @/features/auth/types, @/features/robots/types
 */

import type { User } from '@/features/auth/types';
import type { RobotCommand, CommandType } from '@/features/robots/types';
import type {
  CommandInterpretation,
  CommandHistoryEntry,
  CommandHistoryResponse,
  InterpretCommandRequest,
  SafetyClassification,
} from '@/features/command/types';

// ============================================================================
// MOCK USER
// ============================================================================

export const MOCK_USER: User = {
  id: 'dev-user-001',
  email: 'dev@robomind.local',
  name: 'Dev Admin',
  role: 'admin',
  avatar: undefined,
  tenantId: 'dev-tenant',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: new Date().toISOString(),
  lastLoginAt: new Date().toISOString(),
};

// ============================================================================
// MOCK COMMAND HISTORY
// ============================================================================

export const MOCK_COMMAND_HISTORY: RobotCommand[] = [
  // Robot 001 - Atlas
  {
    id: 'cmd-001',
    robotId: 'robot-001',
    type: 'move',
    payload: { destination: { x: 12.5, y: 8.3 } },
    status: 'completed',
    priority: 'normal',
    createdAt: new Date(Date.now() - 300000).toISOString(),
    startedAt: new Date(Date.now() - 295000).toISOString(),
    completedAt: new Date(Date.now() - 120000).toISOString(),
  },
  {
    id: 'cmd-004',
    robotId: 'robot-001',
    type: 'pickup',
    payload: { item: 'Pallet-B45' },
    status: 'completed',
    priority: 'normal',
    createdAt: new Date(Date.now() - 900000).toISOString(),
    startedAt: new Date(Date.now() - 895000).toISOString(),
    completedAt: new Date(Date.now() - 600000).toISOString(),
  },
  {
    id: 'cmd-005',
    robotId: 'robot-001',
    type: 'drop',
    payload: { location: 'Zone A-3' },
    status: 'completed',
    priority: 'normal',
    createdAt: new Date(Date.now() - 1200000).toISOString(),
    startedAt: new Date(Date.now() - 1195000).toISOString(),
    completedAt: new Date(Date.now() - 1000000).toISOString(),
  },
  // Robot 002 - Spot
  {
    id: 'cmd-002',
    robotId: 'robot-002',
    type: 'pickup',
    payload: { item: 'Box-A123' },
    status: 'executing',
    priority: 'high',
    createdAt: new Date(Date.now() - 60000).toISOString(),
    startedAt: new Date(Date.now() - 55000).toISOString(),
  },
  {
    id: 'cmd-006',
    robotId: 'robot-002',
    type: 'move',
    payload: { destination: { x: 25.1, y: 14.7 } },
    status: 'completed',
    priority: 'normal',
    createdAt: new Date(Date.now() - 180000).toISOString(),
    startedAt: new Date(Date.now() - 175000).toISOString(),
    completedAt: new Date(Date.now() - 90000).toISOString(),
  },
  // Robot 003 - Cargo
  {
    id: 'cmd-007',
    robotId: 'robot-003',
    type: 'charge',
    payload: {},
    status: 'executing',
    priority: 'normal',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    startedAt: new Date(Date.now() - 1795000).toISOString(),
  },
  // Robot 005 - Heavy (error state)
  {
    id: 'cmd-003',
    robotId: 'robot-005',
    type: 'move',
    payload: { destination: { x: 20.0, y: 25.0 } },
    status: 'failed',
    priority: 'normal',
    errorMessage: 'Motor fault detected',
    createdAt: new Date(Date.now() - 600000).toISOString(),
    startedAt: new Date(Date.now() - 590000).toISOString(),
    completedAt: new Date(Date.now() - 500000).toISOString(),
  },
  {
    id: 'cmd-008',
    robotId: 'robot-005',
    type: 'pickup',
    payload: { item: 'Heavy-Pallet-01' },
    status: 'completed',
    priority: 'high',
    createdAt: new Date(Date.now() - 1500000).toISOString(),
    startedAt: new Date(Date.now() - 1495000).toISOString(),
    completedAt: new Date(Date.now() - 1200000).toISOString(),
  },
  // Robot 007 - Picker
  {
    id: 'cmd-009',
    robotId: 'robot-007',
    type: 'return_home',
    payload: {},
    status: 'completed',
    priority: 'low',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    startedAt: new Date(Date.now() - 3595000).toISOString(),
    completedAt: new Date(Date.now() - 3300000).toISOString(),
  },
  // Robot 008 - Delivery
  {
    id: 'cmd-010',
    robotId: 'robot-008',
    type: 'move',
    payload: { destination: { x: 15.8, y: 28.4, floor: '2' } },
    status: 'executing',
    priority: 'normal',
    createdAt: new Date(Date.now() - 120000).toISOString(),
    startedAt: new Date(Date.now() - 115000).toISOString(),
  },
  {
    id: 'cmd-011',
    robotId: 'robot-008',
    type: 'pickup',
    payload: { item: 'Package-204' },
    status: 'completed',
    priority: 'normal',
    createdAt: new Date(Date.now() - 600000).toISOString(),
    startedAt: new Date(Date.now() - 595000).toISOString(),
    completedAt: new Date(Date.now() - 300000).toISOString(),
  },
];

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
// MOCK COMMAND HISTORY (NL Commands)
// ============================================================================

export const MOCK_NL_COMMAND_HISTORY: CommandHistoryEntry[] = [
  {
    id: 'hist-001',
    robotId: 'robot-001',
    robotName: 'Atlas-01',
    originalText: 'Move to Warehouse B',
    interpretation: {
      id: 'interp-hist-001',
      originalText: 'Move to Warehouse B',
      commandType: 'move',
      parameters: { target: 'Warehouse B', destination: { x: 25.1, y: 14.7 } },
      confidence: 0.94,
      safetyClassification: 'safe',
      timestamp: new Date(Date.now() - 1800000).toISOString(),
    },
    executedCommand: MOCK_COMMAND_HISTORY[0],
    status: 'executed',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    executedAt: new Date(Date.now() - 1795000).toISOString(),
  },
  {
    id: 'hist-002',
    robotId: 'robot-002',
    robotName: 'Spot-02',
    originalText: 'Pick up the box near the dock',
    interpretation: {
      id: 'interp-hist-002',
      originalText: 'Pick up the box near the dock',
      commandType: 'pickup',
      parameters: { target: 'dock', objects: ['box'] },
      confidence: 0.87,
      safetyClassification: 'caution',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
    },
    executedCommand: MOCK_COMMAND_HISTORY[3],
    status: 'executed',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    executedAt: new Date(Date.now() - 3595000).toISOString(),
  },
  {
    id: 'hist-003',
    robotId: 'robot-005',
    robotName: 'Heavy-05',
    originalText: 'Go to loading dock',
    interpretation: {
      id: 'interp-hist-003',
      originalText: 'Go to loading dock',
      commandType: 'move',
      parameters: { target: 'loading dock', destination: { x: 18.3, y: 22.1 } },
      confidence: 0.91,
      safetyClassification: 'safe',
      warnings: ['Robot has active errors - command may fail'],
      timestamp: new Date(Date.now() - 7200000).toISOString(),
    },
    executedCommand: MOCK_COMMAND_HISTORY[6],
    status: 'failed',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    executedAt: new Date(Date.now() - 7195000).toISOString(),
  },
  {
    id: 'hist-004',
    robotId: 'robot-003',
    robotName: 'Cargo-03',
    originalText: 'Go charge',
    interpretation: {
      id: 'interp-hist-004',
      originalText: 'Go charge',
      commandType: 'charge',
      parameters: {},
      confidence: 0.98,
      safetyClassification: 'safe',
      timestamp: new Date(Date.now() - 5400000).toISOString(),
    },
    status: 'executed',
    createdAt: new Date(Date.now() - 5400000).toISOString(),
    executedAt: new Date(Date.now() - 5395000).toISOString(),
  },
  {
    id: 'hist-005',
    robotId: 'robot-007',
    robotName: 'Picker-07',
    originalText: 'Return home base',
    interpretation: {
      id: 'interp-hist-005',
      originalText: 'Return home base',
      commandType: 'return_home',
      parameters: { target: 'home base' },
      confidence: 0.95,
      safetyClassification: 'safe',
      timestamp: new Date(Date.now() - 10800000).toISOString(),
    },
    status: 'executed',
    createdAt: new Date(Date.now() - 10800000).toISOString(),
    executedAt: new Date(Date.now() - 10795000).toISOString(),
  },
];

/**
 * Get mock NL command history with pagination
 */
export function getMockNLCommandHistory(
  page: number = 1,
  pageSize: number = 10,
  robotId?: string
): CommandHistoryResponse {
  let filtered = [...MOCK_NL_COMMAND_HISTORY];

  if (robotId) {
    filtered = filtered.filter((h) => h.robotId === robotId);
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const entries = filtered.slice(start, start + pageSize);

  return {
    entries,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
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
