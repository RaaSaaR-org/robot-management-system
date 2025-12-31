/**
 * @file process.routes.ts
 * @description REST API routes for process and task management
 * @feature processes
 */

import { Router, type Request, type Response } from 'express';
import { processManager } from '../services/ProcessManager.js';
import { taskDistributor } from '../services/TaskDistributor.js';
import { robotTaskRepository } from '../repositories/RobotTaskRepository.js';
import type {
  CreateProcessDefinitionRequest,
  UpdateProcessDefinitionRequest,
  StartProcessRequest,
  ProcessListFilters,
  ProcessInstanceListFilters,
  PaginationParams,
} from '../types/process.types.js';
import type {
  CreateRobotTaskRequest,
  RobotTaskListFilters,
} from '../types/robotTask.types.js';

export const processRoutes = Router();

// ============================================================================
// PROCESS DEFINITION ROUTES
// ============================================================================

/**
 * GET /processes - List process definitions
 */
processRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const filters: ProcessListFilters = {
      status: req.query.status as ProcessListFilters['status'],
      search: req.query.search as string,
      tags: req.query.tags ? (req.query.tags as string).split(',') : undefined,
    };
    const pagination: PaginationParams = {
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      sortBy: req.query.sortBy as string,
      sortOrder: req.query.sortOrder as 'asc' | 'desc',
    };

    const result = await processManager.listDefinitions(filters, pagination);
    res.json(result);
  } catch (error) {
    console.error('Error listing processes:', error);
    res.status(500).json({ error: 'Failed to list processes' });
  }
});

/**
 * GET /processes/:id - Get a process definition
 */
processRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const process = await processManager.getDefinition(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }
    res.json(process);
  } catch (error) {
    console.error('Error getting process:', error);
    res.status(500).json({ error: 'Failed to get process' });
  }
});

/**
 * POST /processes - Create a process definition
 */
processRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const request: CreateProcessDefinitionRequest = req.body;

    if (!request.name || !request.stepTemplates || request.stepTemplates.length === 0) {
      return res.status(400).json({ error: 'name and stepTemplates are required' });
    }

    // TODO: Get createdBy from auth context
    const createdBy = 'system';
    const process = await processManager.createDefinition(request, createdBy);
    res.status(201).json(process);
  } catch (error) {
    console.error('Error creating process:', error);
    res.status(500).json({ error: 'Failed to create process' });
  }
});

/**
 * PUT /processes/:id - Update a process definition
 */
processRoutes.put('/:id', async (req: Request, res: Response) => {
  try {
    const request: UpdateProcessDefinitionRequest = req.body;
    const process = await processManager.updateDefinition(req.params.id, request);

    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }
    res.json(process);
  } catch (error) {
    console.error('Error updating process:', error);
    res.status(500).json({ error: 'Failed to update process' });
  }
});

/**
 * POST /processes/:id/publish - Publish a process definition
 */
processRoutes.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const process = await processManager.publishDefinition(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }
    res.json(process);
  } catch (error) {
    console.error('Error publishing process:', error);
    res.status(500).json({ error: 'Failed to publish process' });
  }
});

/**
 * DELETE /processes/:id - Archive a process definition
 */
processRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const success = await processManager.archiveDefinition(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Process not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error archiving process:', error);
    res.status(500).json({ error: 'Failed to archive process' });
  }
});

// ============================================================================
// PROCESS INSTANCE ROUTES
// ============================================================================

/**
 * POST /processes/:id/start - Start a new process instance
 */
processRoutes.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const request: StartProcessRequest = req.body;
    // TODO: Get createdBy from auth context
    const createdBy = 'system';

    const instance = await processManager.startProcess(req.params.id, request, createdBy);
    if (!instance) {
      return res.status(400).json({ error: 'Failed to start process. Definition may not exist or not be ready.' });
    }
    res.status(201).json(instance);
  } catch (error) {
    console.error('Error starting process:', error);
    res.status(500).json({ error: 'Failed to start process' });
  }
});

/**
 * GET /process-instances - List process instances
 */
processRoutes.get('/instances/list', async (req: Request, res: Response) => {
  try {
    const filters: ProcessInstanceListFilters = {
      status: req.query.status as ProcessInstanceListFilters['status'],
      priority: req.query.priority as ProcessInstanceListFilters['priority'],
      processDefinitionId: req.query.processDefinitionId as string,
      robotId: req.query.robotId as string,
      createdBy: req.query.createdBy as string,
    };
    const pagination: PaginationParams = {
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      sortBy: req.query.sortBy as string,
      sortOrder: req.query.sortOrder as 'asc' | 'desc',
    };

    const result = await processManager.listInstances(filters, pagination);
    res.json(result);
  } catch (error) {
    console.error('Error listing process instances:', error);
    res.status(500).json({ error: 'Failed to list process instances' });
  }
});

/**
 * GET /process-instances/:id - Get a process instance
 */
processRoutes.get('/instances/:id', async (req: Request, res: Response) => {
  try {
    const instance = await processManager.getInstance(req.params.id);
    if (!instance) {
      return res.status(404).json({ error: 'Process instance not found' });
    }
    res.json(instance);
  } catch (error) {
    console.error('Error getting process instance:', error);
    res.status(500).json({ error: 'Failed to get process instance' });
  }
});

/**
 * PUT /process-instances/:id/pause - Pause a process instance
 */
processRoutes.put('/instances/:id/pause', async (req: Request, res: Response) => {
  try {
    const instance = await processManager.pauseProcess(req.params.id);
    if (!instance) {
      return res.status(400).json({ error: 'Cannot pause process. It may not be running.' });
    }
    res.json(instance);
  } catch (error) {
    console.error('Error pausing process:', error);
    res.status(500).json({ error: 'Failed to pause process' });
  }
});

/**
 * PUT /process-instances/:id/resume - Resume a process instance
 */
processRoutes.put('/instances/:id/resume', async (req: Request, res: Response) => {
  try {
    const instance = await processManager.resumeProcess(req.params.id);
    if (!instance) {
      return res.status(400).json({ error: 'Cannot resume process. It may not be paused.' });
    }
    res.json(instance);
  } catch (error) {
    console.error('Error resuming process:', error);
    res.status(500).json({ error: 'Failed to resume process' });
  }
});

/**
 * PUT /process-instances/:id/cancel - Cancel a process instance
 */
processRoutes.put('/instances/:id/cancel', async (req: Request, res: Response) => {
  try {
    const instance = await processManager.cancelProcess(req.params.id);
    if (!instance) {
      return res.status(400).json({ error: 'Cannot cancel process. It may already be completed.' });
    }
    res.json(instance);
  } catch (error) {
    console.error('Error cancelling process:', error);
    res.status(500).json({ error: 'Failed to cancel process' });
  }
});

/**
 * PUT /process-instances/:id/retry - Retry a failed or cancelled process instance
 */
processRoutes.put('/instances/:id/retry', async (req: Request, res: Response) => {
  try {
    const instance = await processManager.retryProcess(req.params.id);
    if (!instance) {
      return res.status(400).json({ error: 'Cannot retry process. It must be in failed or cancelled state.' });
    }
    res.json(instance);
  } catch (error) {
    console.error('Error retrying process:', error);
    res.status(500).json({ error: 'Failed to retry process' });
  }
});

// ============================================================================
// ROBOT TASK ROUTES
// ============================================================================

/**
 * GET /tasks - List robot tasks
 */
processRoutes.get('/tasks/list', async (req: Request, res: Response) => {
  try {
    const filters: RobotTaskListFilters = {
      status: req.query.status as RobotTaskListFilters['status'],
      priority: req.query.priority as RobotTaskListFilters['priority'],
      robotId: req.query.robotId as string,
      processInstanceId: req.query.processInstanceId as string,
      source: req.query.source as RobotTaskListFilters['source'],
    };
    const pagination: PaginationParams = {
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      sortBy: req.query.sortBy as string,
      sortOrder: req.query.sortOrder as 'asc' | 'desc',
    };

    const result = await robotTaskRepository.findAll(filters, pagination);
    res.json(result);
  } catch (error) {
    console.error('Error listing tasks:', error);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

/**
 * GET /tasks/:id - Get a robot task
 */
processRoutes.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const task = await taskDistributor.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    console.error('Error getting task:', error);
    res.status(500).json({ error: 'Failed to get task' });
  }
});

/**
 * POST /tasks - Create a robot task (manual or from command)
 */
processRoutes.post('/tasks', async (req: Request, res: Response) => {
  try {
    const request: CreateRobotTaskRequest = req.body;

    if (!request.actionType || !request.instruction) {
      return res.status(400).json({ error: 'actionType and instruction are required' });
    }

    const task = await taskDistributor.createTask(request, 'manual');
    res.status(201).json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

/**
 * PUT /tasks/:id/status - Update task status (from robot)
 */
processRoutes.put('/tasks/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, result, error, a2aTaskId, a2aContextId } = req.body;

    if (!status || !['executing', 'completed', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Valid status (executing, completed, failed) is required' });
    }

    const task = await taskDistributor.updateTaskStatus(req.params.id, status, {
      a2aTaskId,
      a2aContextId,
      result,
      error,
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    console.error('Error updating task status:', error);
    res.status(500).json({ error: 'Failed to update task status' });
  }
});

/**
 * PUT /tasks/:id/cancel - Cancel a task
 */
processRoutes.put('/tasks/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    const task = await taskDistributor.cancelTask(req.params.id, reason);

    if (!task) {
      return res.status(400).json({ error: 'Cannot cancel task. It may already be completed.' });
    }
    res.json(task);
  } catch (error) {
    console.error('Error cancelling task:', error);
    res.status(500).json({ error: 'Failed to cancel task' });
  }
});

/**
 * GET /tasks/queue/stats - Get task queue statistics
 */
processRoutes.get('/tasks/queue/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await taskDistributor.getQueueStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting queue stats:', error);
    res.status(500).json({ error: 'Failed to get queue stats' });
  }
});
