/**
 * @file message.routes.ts
 * @description Routes for message handling
 */

import { Router, type Request, type Response } from 'express';
import { conversationManager } from '../services/ConversationManager.js';
import { sendFailure } from '../utils/routeErrors.js';

export const messageRoutes = Router();

/**
 * POST /send - Send a message to an agent
 */
messageRoutes.post('/send', async (req: Request, res: Response) => {
  try {
    const { conversationId, message, targetAgentUrl } = req.body;

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const result = await conversationManager.processMessage(
      conversationId,
      message,
      targetAgentUrl
    );

    res.json({
      messageId: result.messageId,
      contextId: conversationId,
      taskId: result.task?.id,
    });
  } catch (error) {
    console.error('Error sending message:', error);
    sendFailure(res, error, 'Failed to send message', 500);
  }
});

/**
 * POST /orchestrate - Send message to be routed by orchestrator
 * The orchestrator selects the best agent based on message content and agent capabilities
 */
messageRoutes.post('/orchestrate', async (req: Request, res: Response) => {
  try {
    const { conversationId, message } = req.body;

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const result = await conversationManager.processOrchestratedMessage(conversationId, message);

    res.json({
      messageId: result.messageId,
      contextId: conversationId,
      taskId: result.task?.id,
    });
  } catch (error) {
    console.error('Error in orchestrated message:', error);
    sendFailure(res, error, 'Failed to process orchestrated message', 500);
  }
});

/**
 * POST /list - List messages for a conversation
 */
messageRoutes.post('/list', async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    const messages = await conversationManager.getMessages(conversationId);
    res.json({ messages });
  } catch (error) {
    console.error('Error listing messages:', error);
    res.status(500).json({ error: 'Failed to list messages' });
  }
});

/**
 * POST /pending - Get pending message statuses
 */
messageRoutes.post('/pending', (_req: Request, res: Response) => {
  try {
    const pending = conversationManager.getPendingMessages();
    res.json({ pending });
  } catch (error) {
    console.error('Error getting pending messages:', error);
    res.status(500).json({ error: 'Failed to get pending messages' });
  }
});
