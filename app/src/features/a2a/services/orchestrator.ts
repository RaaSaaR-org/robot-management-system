/**
 * @file orchestrator.ts
 * @description LLM-powered orchestrator service using OpenRouter for intelligent agent routing
 * @feature a2a
 */

import type { A2AAgentCard } from '../types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'stepfun/step-3.5-flash:free';

/**
 * OrchestratorService uses OpenRouter to intelligently route messages
 * to the most appropriate agent based on agent capabilities and message content.
 */
export class OrchestratorService {
  private apiKey: string | null = null;
  private model: string = DEFAULT_MODEL;
  private initialized = false;

  /**
   * Initialize the orchestrator with an OpenRouter API key
   */
  initialize(apiKey: string): void {
    if (!apiKey) {
      console.warn('[Orchestrator] No API key provided');
      return;
    }

    this.apiKey = apiKey;
    this.initialized = true;
    console.log(`[Orchestrator] Initialized with OpenRouter (${this.model})`);
  }

  /**
   * Check if the orchestrator is ready to use
   */
  isReady(): boolean {
    return this.initialized && this.apiKey !== null;
  }

  /**
   * Reset the orchestrator (clear API key)
   */
  reset(): void {
    this.apiKey = null;
    this.initialized = false;
  }

  /**
   * Select the best agent for a given message using LLM analysis
   */
  async selectAgent(
    message: string,
    agents: A2AAgentCard[]
  ): Promise<A2AAgentCard | null> {
    if (!this.apiKey) {
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

    const systemPrompt = `You are an intelligent task router for a robot fleet management system. Given the user's request and available robot agents, select the BEST agent to handle the task.

Available Agents:
${agentDescriptions}

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

      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          max_tokens: 50,
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const selectedName = data.choices?.[0]?.message?.content?.trim() ?? '';

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
