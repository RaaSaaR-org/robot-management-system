/**
 * @file agent.routes.ts
 * @description Routes for agent registration and management
 */

import { Router, type Request, type Response } from 'express';
import { conversationManager } from '../services/ConversationManager.js';
import { agentCardResolver } from '../services/A2AClient.js';

export const agentRoutes = Router();

/**
 * POST /register - Register an external agent
 */
agentRoutes.post('/register', async (req: Request, res: Response) => {
  try {
    const { agentUrl } = req.body;

    if (!agentUrl) {
      return res.status(400).json({ error: 'agentUrl is required' });
    }

    // Fetch the agent card
    const agentCard = await agentCardResolver.fetchAgentCard(agentUrl);

    // Register the agent
    await conversationManager.registerAgent(agentCard);

    res.json({ agentCard });
  } catch (error) {
    console.error('Error registering agent:', error);
    const message = error instanceof Error ? error.message : 'Failed to register agent';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /list - List all registered agents
 */
agentRoutes.post('/list', async (_req: Request, res: Response) => {
  try {
    const agents = await conversationManager.listAgentsAsync();
    res.json({ agents });
  } catch (error) {
    console.error('Error listing agents:', error);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

/**
 * DELETE /:name - Unregister an agent
 */
agentRoutes.delete('/:name', async (req: Request, res: Response) => {
  try {
    const deleted = await conversationManager.unregisterAgent(req.params.name);
    if (!deleted) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error unregistering agent:', error);
    res.status(500).json({ error: 'Failed to unregister agent' });
  }
});

/**
 * GET /:name - Get a specific registered agent
 */
agentRoutes.get('/:name', async (req: Request, res: Response) => {
  try {
    const agent = await conversationManager.getAgentAsync(req.params.name);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json({ agent });
  } catch (error) {
    console.error('Error getting agent:', error);
    res.status(500).json({ error: 'Failed to get agent' });
  }
});
