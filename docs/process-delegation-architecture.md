# Process-to-Robot Task Delegation Architecture

## Overview

RoboMindOS uses a hierarchical workflow system to delegate work to robots. This document explains how processes are defined, executed, and how individual steps are assigned to robots as tasks.

## Terminology

| Term | Description |
|------|-------------|
| **ProcessDefinition** | A reusable template/blueprint for a workflow (draft → ready → archived) |
| **ProcessInstance** | A runtime execution of a process definition |
| **StepInstance** | An individual step within a running process |
| **RobotTask** | A work item assigned to a specific robot |

## Entity Relationships

```
ProcessDefinition (Template)
│   - id, name, description, version
│   - stepTemplates[]
│   - requiredCapabilities[]
│   - status: draft | ready | archived
│
└── ProcessInstance (Runtime)
    │   - processDefinitionId
    │   - status: pending | in_progress | paused | completed | failed | cancelled
    │   - priority: low | normal | high | critical
    │   - preferredRobotIds[], assignedRobotIds[]
    │   - progress: 0-100%
    │
    └── StepInstance[] (Sequential Steps)
        │   - order, name, actionType, actionConfig
        │   - status: pending | queued | in_progress | completed | failed | skipped
        │   - assignedRobotId, robotTaskId
        │   - retryCount, maxRetries
        │
        └── RobotTask (Delegated Work)
                - robotId, status, actionType
                - processInstanceId, stepInstanceId (links back)
                - a2aTaskId (A2A protocol integration)
```

## Data Flow

### 1. Process Creation & Start

```
User creates ProcessDefinition
        │
        ▼
User calls startProcess(definitionId)
        │
        ▼
ProcessManager.startProcess()
├── Creates ProcessInstance (status: pending)
├── Creates StepInstance[] from stepTemplates
├── Emits 'process:created' event
└── Calls beginExecution()
```

### 2. Step Execution & Robot Assignment

```
ProcessManager.executeNextStep()
        │
        ▼
Get next pending step
        │
        ▼
Create RobotTask for step
├── actionType, actionConfig from step
├── instruction = step.name + description
├── source = 'process'
│
        ▼
Emit 'task:created' event
        │
        ▼
TaskDistributor picks up event
        │
        ▼
TaskDistributor.distributeTask()
├── findEligibleRobots() - filter by capabilities & status
├── scoreRobots() - multi-factor ranking
│   ├── Queue size (+10 per empty slot)
│   ├── Status (idle: +50, busy: +0)
│   ├── Battery level (+% directly)
│   ├── Proximity to task location
│   ├── High-priority capability (+25)
│   └── Preferred robot bonus (+100)
├── Sort by score descending
└── assignTaskToRobot(best robot)
        │
        ▼
Push task to robot via:
├── WebSocket 'robot:work_assigned' event
└── HTTP POST /robots/:id/tasks
```

### 3. Robot Task Execution

```
Robot receives task
        │
        ▼
TaskQueue.accept(task)
├── Validate robot status (not error/maintenance)
├── Check queue size (max 5)
├── Sort by priority
└── executeNext() if queue was empty
        │
        ▼
TaskQueue.executeAction()
├── move_to_location → robotStateManager.moveTo()
├── pickup_object → robotStateManager.pickup()
├── drop_object → robotStateManager.drop()
├── charge → robotStateManager.goToCharge()
├── return_home → robotStateManager.returnHome()
└── custom → AI agent via A2A protocol
        │
        ▼
Report status via HTTP PUT /api/processes/tasks/:id/status
```

### 4. Completion & Next Step

```
TaskDistributor.updateTaskStatus('completed')
        │
        ▼
ProcessManager.onStepCompleted(stepId, result)
├── Update step status to 'completed'
├── Emit 'step:completed' event
├── Update process progress
└── executeNextStep() OR checkProcessCompletion()
```

## Robot Selection Algorithm

The TaskDistributor uses a multi-factor scoring algorithm to select the best robot for each task:

```typescript
calculateRobotScore(robot, task):
  score = 0

  // 1. Queue capacity (prefer shorter queues)
  queueSize = countAssigned(robot)
  if queueSize >= MAX_QUEUE_SIZE: return -1  // Full
  score += (MAX_QUEUE_SIZE - queueSize) * 10

  // 2. Status (prefer idle robots)
  if robot.status == 'online': score += 50

  // 3. Battery level
  score += robot.batteryLevel

  // 4. Proximity (if task has location)
  if task.location:
    distance = calculateDistance(robot.location, task.location)
    score += max(0, 100 - distance)

  // 5. High-priority task bonus
  if task.priority in ['critical', 'high'] && robot.batteryLevel > 50:
    score += 25

  // 6. Preferred robot bonus
  if robot.id in process.preferredRobotIds:
    score += 100

  return score
```

### Scoring Breakdown

| Factor | Weight | Description |
|--------|--------|-------------|
| Queue Size | +10 per slot | Robots with shorter queues score higher |
| Idle Status | +50 | Idle robots preferred over busy ones |
| Battery | +1 per % | Higher battery = higher score |
| Proximity | +0-100 | Closer to task location = higher score |
| Priority Capable | +25 | High battery robots for critical tasks |
| Preferred | +100 | User-specified robot preference |

## Failure Handling

### Current Behavior

1. Robot task fails → TaskDistributor notifies ProcessManager
2. ProcessManager.onStepCompleted(success: false)
3. If retryCount < maxRetries: increment retry, re-execute step
4. If retryCount >= maxRetries: fail entire process

### Enhanced Behavior (Implemented)

The system supports **retry-then-reassign**:

1. Robot task fails → Same robot retries (up to N times)
2. After N same-robot retries: reassign to different robot
3. Track `failedRobotIds` on step to exclude from reassignment
4. Continue until success OR all eligible robots exhausted

```
Step fails on Robot A
        │
        ▼
retryCount < maxRetries?
├── YES: Retry on Robot A, increment retryCount
│
└── NO: Check eligible robots excluding failedRobotIds
        │
        ▼
        Eligible robots remaining?
        ├── YES: Reset retryCount, add Robot A to failedRobotIds
        │        Reassign to next best robot
        │
        └── NO: Fail process (all robots exhausted)
```

## WebSocket Events

### Process Events (ProcessManager)

| Event | Payload | Description |
|-------|---------|-------------|
| `process:created` | ProcessInstance | New process started |
| `process:updated` | ProcessInstance | Status changed |
| `process:completed` | ProcessInstance | All steps done |
| `process:failed` | ProcessInstance, error | Process failed |
| `step:started` | processInstanceId, StepInstance | Step queued |
| `step:completed` | processInstanceId, StepInstance | Step done |
| `step:failed` | processInstanceId, StepInstance, error | Step failed |

### Task Events (TaskDistributor)

| Event | Payload | Description |
|-------|---------|-------------|
| `task:created` | RobotTask | New task created |
| `task:assigned` | RobotTask, robotId | Task assigned to robot |
| `task:progress` | taskId, robotId, progress | Execution progress |
| `task:completed` | RobotTask, result | Task done |
| `task:failed` | RobotTask, error | Task failed |

### Robot Events

| Event | Payload | Description |
|-------|---------|-------------|
| `robot:work_assigned` | robotId, RobotTask | Push task to robot |
| `robot:work_cancelled` | robotId, taskId, reason | Cancel robot task |

## API Reference

### Process Definitions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/processes` | List definitions |
| POST | `/api/processes` | Create definition |
| GET | `/api/processes/:id` | Get definition |
| PUT | `/api/processes/:id` | Update definition |
| POST | `/api/processes/:id/publish` | Publish (draft → ready) |
| DELETE | `/api/processes/:id` | Archive definition |

### Process Instances

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/processes/:id/start` | Start new instance |
| GET | `/api/processes/instances/list` | List instances |
| GET | `/api/processes/instances/:id` | Get instance |
| PUT | `/api/processes/instances/:id/pause` | Pause execution |
| PUT | `/api/processes/instances/:id/resume` | Resume execution |
| PUT | `/api/processes/instances/:id/cancel` | Cancel execution |

### Robot Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/processes/tasks` | Create manual task |
| GET | `/api/processes/tasks/list` | List tasks |
| GET | `/api/processes/tasks/:id` | Get task |
| PUT | `/api/processes/tasks/:id/status` | Update status (robot reports) |
| PUT | `/api/processes/tasks/:id/cancel` | Cancel task |
| GET | `/api/processes/tasks/queue/stats` | Queue statistics |

## Key Files

### Server

| File | Purpose |
|------|---------|
| `src/types/process.types.ts` | Process/Step type definitions |
| `src/types/robotTask.types.ts` | Robot task type definitions |
| `src/services/ProcessManager.ts` | Process lifecycle orchestration |
| `src/services/TaskDistributor.ts` | Robot selection and task assignment |
| `src/routes/process.routes.ts` | REST API endpoints |
| `src/repositories/ProcessRepository.ts` | Process data access |
| `src/repositories/RobotTaskRepository.ts` | Task data access |

### Robot Agent

| File | Purpose |
|------|---------|
| `src/robot/TaskQueue.ts` | Task queue with priority sorting |
| `src/robot/state.ts` | Robot state manager facade |
| `src/api/rest-routes.ts` | Task reception endpoint |
| `src/agent/agent-executor.ts` | A2A protocol for AI tasks |

### App (Frontend)

| File | Purpose |
|------|---------|
| `src/features/processes/types/process.types.ts` | Frontend type definitions |
| `src/features/processes/store/tasksStore.ts` | Zustand state management |
| `src/features/processes/api/tasksApi.ts` | API client |
| `src/features/processes/hooks/useTasks.ts` | React hooks |
| `src/features/processes/components/` | UI components |

## Step Action Types

| Action Type | Description | Robot Method |
|-------------|-------------|--------------|
| `move_to_location` | Navigate to coordinates or zone | `moveTo(location)` |
| `pickup_object` | Pick up an object | `pickup(objectId)` |
| `drop_object` | Drop held object | `drop()` |
| `wait` | Wait for duration | `sleep(duration)` |
| `inspect` | Perform inspection | AI agent |
| `charge` | Go to charging station | `goToCharge()` |
| `return_home` | Return to home base | `returnHome()` |
| `custom` | Custom action via AI | A2A protocol |

## Multi-Robot Execution

A single process can have its steps executed by different robots:

- Each step is independently assigned to the best available robot
- `ProcessInstance.assignedRobotIds[]` tracks all robots involved
- `ProcessInstance.preferredRobotIds[]` allows bias toward specific robots
- Step execution is sequential (parallel steps planned for future)

## Related Documentation

- [System Architecture](./architecture.md)
- [A2A Protocol](./humanoid-robot-communication-protocols.md)
- [Frontend Architecture](./app-architecture.md)
