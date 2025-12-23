/**
 * @file task.routes.ts
 * @description Routes for task management
 */

import { Router, type Request, type Response } from 'express';
import { conversationManager } from '../services/ConversationManager.js';

export const taskRoutes = Router();

/**
 * POST /list - List all tasks
 */
taskRoutes.post('/list', async (_req: Request, res: Response) => {
  try {
    const tasks = await conversationManager.listTasks();
    res.json({ tasks });
  } catch (error) {
    console.error('Error listing tasks:', error);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

/**
 * GET /:id - Get a specific task
 */
taskRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const task = await conversationManager.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ task });
  } catch (error) {
    console.error('Error getting task:', error);
    res.status(500).json({ error: 'Failed to get task' });
  }
});
