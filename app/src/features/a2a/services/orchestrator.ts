/**
 * @file orchestrator.ts
 * @description LLM-powered orchestrator service using Google Gemini for intelligent agent routing
 * @feature a2a
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type { A2AAgentCard } from '../types';

/**
 * OrchestratorService uses Google Gemini to intelligently route messages
 * to the most appropriate agent based on agent capabilities and message content.
 */
export class OrchestratorService {
  private genAI: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;
  private initialized = false;

  /**
   * Initialize the orchestrator with a Gemini API key
   */
  initialize(apiKey: string): void {
    if (!apiKey) {
      console.warn('[Orchestrator] No API key provided');
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      this.initialized = true;
      console.log('[Orchestrator] Initialized with Gemini 2.5 Flash');
    } catch (error) {
      console.error('[Orchestrator] Failed to initialize:', error);
      this.initialized = false;
    }
  }

  /**
   * Check if the orchestrator is ready to use
   */
  isReady(): boolean {
    return this.initialized && this.model !== null;
  }

  /**
   * Reset the orchestrator (clear API key)
   */
  reset(): void {
    this.genAI = null;
    this.model = null;
    this.initialized = false;
  }

  /**
   * Select the best agent for a given message using LLM analysis
   */
  async selectAgent(
    message: string,
    agents: A2AAgentCard[]
  ): Promise<A2AAgentCard | null> {
    if (!this.model) {
      console.warn('[Orchestrator] Not initialized, cannot select agent');
      return agents.length > 0 ? agents[0] : null;
    }

    if (agents.length === 0) {
      console.warn('[Orchestrator] No agents available');
      return null;
    }

    if (agents.length === 1) {
      console.log('[Orchestrator] Only one agent available, selecting:', agents[0].name);
      return agents[0];
    }

    // Build agent descriptions for the prompt
    const agentDescriptions = agents
      .map((a, i) => `${i + 1}. ${a.name}: ${a.description}`)
      .join('\n');

    const prompt = `You are an intelligent task router for a robot fleet management system. Given the user's request and available robot agents, select the BEST agent to handle the task.

Available Agents:
${agentDescriptions}

User Request: "${message}"

Instructions:
- Analyze the user's request carefully
- Consider each agent's capabilities and description
- Select the agent that is best suited for the task
- If a task mentions weight, payload, or heavy items, consider the agent's max payload capacity
- For delicate or precise tasks, prefer agents described as nimble or precise
- For heavy-duty tasks, prefer agents described as industrial or heavy-duty

Respond with ONLY the exact agent name (nothing else). Example response: "TitanBot"`;

    try {
      console.log('[Orchestrator] Selecting agent for:', message);
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const selectedName = response.text().trim();

      console.log('[Orchestrator] LLM selected:', selectedName);

      // Find the agent by name (case-insensitive)
      const selectedAgent = agents.find(
        (a) => a.name.toLowerCase() === selectedName.toLowerCase()
      );

      if (selectedAgent) {
        console.log('[Orchestrator] Routing to:', selectedAgent.name);
        return selectedAgent;
      }

      // Fallback: try partial match
      const partialMatch = agents.find(
        (a) => a.name.toLowerCase().includes(selectedName.toLowerCase()) ||
               selectedName.toLowerCase().includes(a.name.toLowerCase())
      );

      if (partialMatch) {
        console.log('[Orchestrator] Partial match, routing to:', partialMatch.name);
        return partialMatch;
      }

      // Last resort: return first agent
      console.warn('[Orchestrator] No match found, defaulting to first agent');
      return agents[0];
    } catch (error) {
      console.error('[Orchestrator] Error selecting agent:', error);
      // Fallback to first agent on error
      return agents[0];
    }
  }
}

// Singleton instance for global use
export const orchestrator = new OrchestratorService();
