/**
 * @file taskMockData.ts
 * @description Mock data for tasks in development/testing mode
 * @feature mocks
 * @dependencies @/features/tasks/types
 */

import type {
  Task,
  TaskStep,
  TaskListParams,
  TaskListResponse,
  TaskActionRequest,
  TaskActionResponse,
  CreateTaskRequest,
} from '@/features/tasks/types';

export { mockDelay } from './mockData';

// ============================================================================
// MOCK TASKS
// ============================================================================

export const MOCK_TASKS: Task[] = [
  {
    id: 'task-101',
    name: 'Inventory Scan Section B',
    description: 'Perform full inventory scan of warehouse section B',
    robotId: 'robot-002',
    robotName: 'Spot-02',
    status: 'in_progress',
    priority: 'high',
    progress: 65,
    currentStepIndex: 2,
    steps: [
      {
        id: 'step-101-1',
        name: 'Navigate to Section B',
        description: 'Move to starting position in Section B',
        status: 'completed',
        order: 0,
        startedAt: new Date(Date.now() - 1800000).toISOString(),
        completedAt: new Date(Date.now() - 1500000).toISOString(),
      },
      {
        id: 'step-101-2',
        name: 'Scan Aisle B1',
        description: 'Scan all items in Aisle B1',
        status: 'completed',
        order: 1,
        startedAt: new Date(Date.now() - 1500000).toISOString(),
        completedAt: new Date(Date.now() - 900000).toISOString(),
      },
      {
        id: 'step-101-3',
        name: 'Scan Aisle B2',
        description: 'Scan all items in Aisle B2',
        status: 'in_progress',
        order: 2,
        startedAt: new Date(Date.now() - 900000).toISOString(),
      },
      {
        id: 'step-101-4',
        name: 'Scan Aisle B3',
        status: 'pending',
        order: 3,
      },
      {
        id: 'step-101-5',
        name: 'Return to Base',
        description: 'Navigate back to home position',
        status: 'pending',
        order: 4,
      },
    ],
    estimatedDuration: 3600,
    createdAt: new Date(Date.now() - 2400000).toISOString(),
    startedAt: new Date(Date.now() - 1800000).toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'dev@robomind.local',
  },
  {
    id: 'task-098',
    name: 'Pallet Transport',
    description: 'Transport pallet from Loading Dock to Warehouse A',
    robotId: 'robot-005',
    robotName: 'Heavy-05',
    status: 'failed',
    priority: 'normal',
    progress: 33,
    currentStepIndex: 1,
    steps: [
      {
        id: 'step-098-1',
        name: 'Pick up Pallet',
        status: 'completed',
        order: 0,
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        completedAt: new Date(Date.now() - 3300000).toISOString(),
      },
      {
        id: 'step-098-2',
        name: 'Transport to Warehouse A',
        status: 'failed',
        order: 1,
        startedAt: new Date(Date.now() - 3300000).toISOString(),
        completedAt: new Date(Date.now() - 3000000).toISOString(),
        error: 'Motor fault: Left wheel motor overheated',
      },
      {
        id: 'step-098-3',
        name: 'Place Pallet',
        status: 'skipped',
        order: 2,
      },
    ],
    error: 'Motor fault detected during transport',
    createdAt: new Date(Date.now() - 4000000).toISOString(),
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    completedAt: new Date(Date.now() - 3000000).toISOString(),
    updatedAt: new Date(Date.now() - 3000000).toISOString(),
    createdBy: 'dev@robomind.local',
  },
  {
    id: 'task-105',
    name: 'Package Delivery to Office 204',
    description: 'Deliver package to office 204 on floor 2',
    robotId: 'robot-008',
    robotName: 'Delivery-08',
    status: 'in_progress',
    priority: 'normal',
    progress: 50,
    currentStepIndex: 2,
    steps: [
      {
        id: 'step-105-1',
        name: 'Pick up Package',
        status: 'completed',
        order: 0,
        startedAt: new Date(Date.now() - 600000).toISOString(),
        completedAt: new Date(Date.now() - 480000).toISOString(),
      },
      {
        id: 'step-105-2',
        name: 'Navigate to Elevator',
        status: 'completed',
        order: 1,
        startedAt: new Date(Date.now() - 480000).toISOString(),
        completedAt: new Date(Date.now() - 300000).toISOString(),
      },
      {
        id: 'step-105-3',
        name: 'Take Elevator to Floor 2',
        status: 'in_progress',
        order: 2,
        startedAt: new Date(Date.now() - 300000).toISOString(),
      },
      {
        id: 'step-105-4',
        name: 'Navigate to Office 204',
        status: 'pending',
        order: 3,
      },
      {
        id: 'step-105-5',
        name: 'Deliver Package',
        status: 'pending',
        order: 4,
      },
      {
        id: 'step-105-6',
        name: 'Return to Base',
        status: 'pending',
        order: 5,
      },
    ],
    estimatedDuration: 1200,
    createdAt: new Date(Date.now() - 900000).toISOString(),
    startedAt: new Date(Date.now() - 600000).toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'dev@robomind.local',
  },
  {
    id: 'task-110',
    name: 'Floor Cleaning - Section A',
    description: 'Clean floors in warehouse section A',
    robotId: 'robot-006',
    robotName: 'Cleaner-06',
    status: 'paused',
    priority: 'low',
    progress: 20,
    currentStepIndex: 1,
    steps: [
      {
        id: 'step-110-1',
        name: 'Fill Water Tank',
        status: 'completed',
        order: 0,
        startedAt: new Date(Date.now() - 7200000).toISOString(),
        completedAt: new Date(Date.now() - 7000000).toISOString(),
      },
      {
        id: 'step-110-2',
        name: 'Clean Aisle A1',
        status: 'in_progress',
        order: 1,
        startedAt: new Date(Date.now() - 7000000).toISOString(),
      },
      {
        id: 'step-110-3',
        name: 'Clean Aisle A2',
        status: 'pending',
        order: 2,
      },
      {
        id: 'step-110-4',
        name: 'Clean Aisle A3',
        status: 'pending',
        order: 3,
      },
      {
        id: 'step-110-5',
        name: 'Empty Waste Tank',
        status: 'pending',
        order: 4,
      },
    ],
    estimatedDuration: 7200,
    createdAt: new Date(Date.now() - 7500000).toISOString(),
    startedAt: new Date(Date.now() - 7200000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    createdBy: 'dev@robomind.local',
    metadata: { pauseReason: 'Robot scheduled for maintenance' },
  },
  {
    id: 'task-112',
    name: 'Pick and Sort Orders',
    description: 'Pick items for orders #1234, #1235, #1236',
    robotId: 'robot-007',
    robotName: 'Picker-07',
    status: 'queued',
    priority: 'high',
    progress: 0,
    currentStepIndex: 0,
    steps: [
      {
        id: 'step-112-1',
        name: 'Navigate to Picking Zone',
        status: 'pending',
        order: 0,
      },
      {
        id: 'step-112-2',
        name: 'Pick Items for Order #1234',
        status: 'pending',
        order: 1,
      },
      {
        id: 'step-112-3',
        name: 'Pick Items for Order #1235',
        status: 'pending',
        order: 2,
      },
      {
        id: 'step-112-4',
        name: 'Pick Items for Order #1236',
        status: 'pending',
        order: 3,
      },
      {
        id: 'step-112-5',
        name: 'Deliver to Sorting Station',
        status: 'pending',
        order: 4,
      },
    ],
    estimatedDuration: 2400,
    createdAt: new Date(Date.now() - 300000).toISOString(),
    updatedAt: new Date(Date.now() - 300000).toISOString(),
    createdBy: 'dev@robomind.local',
  },
  {
    id: 'task-095',
    name: 'Daily Safety Inspection',
    description: 'Perform routine safety inspection of warehouse',
    robotId: 'robot-001',
    robotName: 'Atlas-01',
    status: 'completed',
    priority: 'critical',
    progress: 100,
    currentStepIndex: 3,
    steps: [
      {
        id: 'step-095-1',
        name: 'Check Emergency Exits',
        status: 'completed',
        order: 0,
        startedAt: new Date(Date.now() - 14400000).toISOString(),
        completedAt: new Date(Date.now() - 13800000).toISOString(),
      },
      {
        id: 'step-095-2',
        name: 'Inspect Fire Extinguishers',
        status: 'completed',
        order: 1,
        startedAt: new Date(Date.now() - 13800000).toISOString(),
        completedAt: new Date(Date.now() - 13200000).toISOString(),
      },
      {
        id: 'step-095-3',
        name: 'Check Hazardous Material Storage',
        status: 'completed',
        order: 2,
        startedAt: new Date(Date.now() - 13200000).toISOString(),
        completedAt: new Date(Date.now() - 12600000).toISOString(),
      },
      {
        id: 'step-095-4',
        name: 'Generate Safety Report',
        status: 'completed',
        order: 3,
        startedAt: new Date(Date.now() - 12600000).toISOString(),
        completedAt: new Date(Date.now() - 12000000).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 15000000).toISOString(),
    startedAt: new Date(Date.now() - 14400000).toISOString(),
    completedAt: new Date(Date.now() - 12000000).toISOString(),
    updatedAt: new Date(Date.now() - 12000000).toISOString(),
    createdBy: 'dev@robomind.local',
  },
  {
    id: 'task-113',
    name: 'Emergency Supply Delivery',
    description: 'Urgent delivery of medical supplies to Station 5',
    robotId: 'robot-001',
    robotName: 'Atlas-01',
    status: 'pending',
    priority: 'critical',
    progress: 0,
    currentStepIndex: 0,
    steps: [
      {
        id: 'step-113-1',
        name: 'Collect Supplies from Storage',
        status: 'pending',
        order: 0,
      },
      {
        id: 'step-113-2',
        name: 'Transport to Station 5',
        status: 'pending',
        order: 1,
      },
      {
        id: 'step-113-3',
        name: 'Verify Delivery',
        status: 'pending',
        order: 2,
      },
    ],
    estimatedDuration: 600,
    createdAt: new Date(Date.now() - 60000).toISOString(),
    updatedAt: new Date(Date.now() - 60000).toISOString(),
    createdBy: 'dev@robomind.local',
  },
  {
    id: 'task-090',
    name: 'Cancelled Maintenance Run',
    description: 'Cancelled due to higher priority task',
    robotId: 'robot-003',
    robotName: 'Cargo-03',
    status: 'cancelled',
    priority: 'low',
    progress: 0,
    currentStepIndex: 0,
    steps: [
      {
        id: 'step-090-1',
        name: 'Navigate to Maintenance Bay',
        status: 'skipped',
        order: 0,
      },
      {
        id: 'step-090-2',
        name: 'Perform Self-Diagnostic',
        status: 'skipped',
        order: 1,
      },
    ],
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    completedAt: new Date(Date.now() - 85000000).toISOString(),
    updatedAt: new Date(Date.now() - 85000000).toISOString(),
    createdBy: 'dev@robomind.local',
    metadata: { cancelReason: 'Higher priority task assigned' },
  },
];

// ============================================================================
// MOCK API HELPERS
// ============================================================================

/**
 * Get mock task list with filtering and pagination
 */
export function getMockTaskList(params?: TaskListParams): TaskListResponse {
  let filtered = [...MOCK_TASKS];

  // Apply status filter
  if (params?.status) {
    const statuses = Array.isArray(params.status) ? params.status : [params.status];
    filtered = filtered.filter((t) => statuses.includes(t.status));
  }

  // Apply priority filter
  if (params?.priority) {
    const priorities = Array.isArray(params.priority) ? params.priority : [params.priority];
    filtered = filtered.filter((t) => priorities.includes(t.priority));
  }

  // Apply robot filter
  if (params?.robotId) {
    filtered = filtered.filter((t) => t.robotId === params.robotId);
  }

  // Apply search filter
  if (params?.search) {
    const search = params.search.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.name.toLowerCase().includes(search) ||
        t.description?.toLowerCase().includes(search) ||
        t.robotName?.toLowerCase().includes(search)
    );
  }

  // Apply date filters
  if (params?.dateFrom) {
    const from = new Date(params.dateFrom).getTime();
    filtered = filtered.filter((t) => new Date(t.createdAt).getTime() >= from);
  }
  if (params?.dateTo) {
    const to = new Date(params.dateTo).getTime();
    filtered = filtered.filter((t) => new Date(t.createdAt).getTime() <= to);
  }

  // Sort
  if (params?.sortBy) {
    const sortOrder = params.sortOrder === 'desc' ? -1 : 1;
    filtered.sort((a, b) => {
      const aVal = a[params.sortBy as keyof Task];
      const bVal = b[params.sortBy as keyof Task];
      if (aVal === undefined) return 1;
      if (bVal === undefined) return -1;
      if (aVal < bVal) return -1 * sortOrder;
      if (aVal > bVal) return 1 * sortOrder;
      return 0;
    });
  } else {
    // Default sort: by priority (critical first), then by createdAt (newest first)
    filtered.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 12;
  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const tasks = filtered.slice(start, start + pageSize);

  return {
    tasks,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

/**
 * Get a single mock task by ID
 */
export function getMockTask(id: string): Task | undefined {
  return MOCK_TASKS.find((t) => t.id === id);
}

/**
 * Create a mock task
 */
export function createMockTask(data: CreateTaskRequest): Task {
  const now = new Date().toISOString();
  const robotNames: Record<string, string> = {
    'robot-001': 'Atlas-01',
    'robot-002': 'Spot-02',
    'robot-003': 'Cargo-03',
    'robot-004': 'Scout-04',
    'robot-005': 'Heavy-05',
    'robot-006': 'Cleaner-06',
    'robot-007': 'Picker-07',
    'robot-008': 'Delivery-08',
  };

  const steps: TaskStep[] = data.steps?.map((step, index) => ({
    id: `step-new-${index}`,
    name: step.name,
    description: step.description,
    status: 'pending' as const,
    order: index,
  })) ?? [
    {
      id: 'step-new-0',
      name: 'Execute Task',
      status: 'pending' as const,
      order: 0,
    },
  ];

  const task: Task = {
    id: `task-${Date.now()}`,
    name: data.name,
    description: data.description,
    robotId: data.robotId,
    robotName: robotNames[data.robotId] ?? 'Unknown Robot',
    status: 'pending',
    priority: data.priority ?? 'normal',
    progress: 0,
    currentStepIndex: 0,
    steps,
    createdAt: now,
    updatedAt: now,
    createdBy: 'dev@robomind.local',
    metadata: data.metadata,
  };

  // Add to mock tasks for this session
  MOCK_TASKS.unshift(task);

  return task;
}

/**
 * Execute a mock task action
 */
export function executeMockTaskAction(taskId: string, action: TaskActionRequest): TaskActionResponse {
  const task = MOCK_TASKS.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const now = new Date().toISOString();
  let message = '';

  switch (action.action) {
    case 'pause':
      if (task.status !== 'in_progress') {
        throw new Error('Task cannot be paused');
      }
      task.status = 'paused';
      task.updatedAt = now;
      message = 'Task paused successfully';
      break;

    case 'resume':
      if (task.status !== 'paused') {
        throw new Error('Task cannot be resumed');
      }
      task.status = 'in_progress';
      task.updatedAt = now;
      message = 'Task resumed successfully';
      break;

    case 'cancel':
      if (['completed', 'failed', 'cancelled'].includes(task.status)) {
        throw new Error('Task cannot be cancelled');
      }
      task.status = 'cancelled';
      task.completedAt = now;
      task.updatedAt = now;
      // Mark remaining steps as skipped
      task.steps.forEach((step) => {
        if (step.status === 'pending' || step.status === 'in_progress') {
          step.status = 'skipped';
        }
      });
      message = 'Task cancelled successfully';
      break;

    case 'retry':
      if (!['failed', 'cancelled'].includes(task.status)) {
        throw new Error('Task cannot be retried');
      }
      task.status = 'pending';
      task.progress = 0;
      task.currentStepIndex = 0;
      task.error = undefined;
      task.completedAt = undefined;
      task.startedAt = undefined;
      task.updatedAt = now;
      // Reset all steps
      task.steps.forEach((step) => {
        step.status = 'pending';
        step.startedAt = undefined;
        step.completedAt = undefined;
        step.error = undefined;
      });
      message = 'Task queued for retry';
      break;

    default:
      throw new Error(`Unknown action: ${action.action}`);
  }

  return { task, message };
}
