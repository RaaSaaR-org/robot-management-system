/**
 * @file conversation.routes.ts
 * @description Routes for conversation management
 */

import { Router, type Request, type Response } from 'express';
import { conversationManager } from '../services/ConversationManager.js';

export const conversationRoutes = Router();

/**
 * POST /create - Create a new conversation
 */
conversationRoutes.post('/create', (req: Request, res: Response) => {
  try {
    const { robotId, name } = req.body;
    const conversation = conversationManager.createConversation(robotId, name);
    res.json({ conversation });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

/**
 * POST /list - List all conversations
 */
conversationRoutes.post('/list', (_req: Request, res: Response) => {
  try {
    const conversations = conversationManager.listConversations();
    res.json({ conversations });
  } catch (error) {
    console.error('Error listing conversations:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

/**
 * GET /:id - Get a specific conversation
 */
conversationRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    const conversation = conversationManager.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ conversation });
  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

/**
 * DELETE /:id - Delete a conversation
 */
conversationRoutes.delete('/:id', (req: Request, res: Response) => {
  try {
    const deleted = conversationManager.deleteConversation(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});
