/**
 * @file A2AClient.ts
 * @description Client for connecting to remote A2A agents
 */

import axios, { type AxiosInstance } from 'axios';
import type {
  A2AAgentCard,
  A2AMessage,
  A2ATask,
  JSONRPCRequest,
  JSONRPCResponse,
} from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * A2A Client - connects to remote A2A agents
 */
export class A2AClient {
  private httpClient: AxiosInstance;
  private agentCard: A2AAgentCard;

  constructor(agentCard: A2AAgentCard) {
    this.agentCard = agentCard;
    this.httpClient = axios.create({
      baseURL: agentCard.url,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get the agent card
   */
  getAgentCard(): A2AAgentCard {
    return this.agentCard;
  }

  /**
   * Send a message to the agent
   */
  async sendMessage(message: A2AMessage): Promise<A2ATask | A2AMessage> {
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: uuidv4(),
      method: 'message/send',
      params: message,
    };

    try {
      const response = await this.httpClient.post<JSONRPCResponse>('/', request);

      if (response.data.error) {
        throw new Error(`Agent error: ${response.data.error.message}`);
      }

      return response.data.result as A2ATask | A2AMessage;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to send message: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Send a message and get streaming response
   * Note: This is a simplified implementation. Real streaming would use SSE or WebSocket.
   */
  async *sendMessageStreaming(
    message: A2AMessage
  ): AsyncGenerator<A2ATask, void, unknown> {
    // For now, just send and return the result as a single yield
    const result = await this.sendMessage(message);
    if ('id' in result && 'status' in result) {
      yield result as A2ATask;
    }
  }
}

/**
 * AgentCardResolver - fetches and caches agent cards
 */
export class AgentCardResolver {
  private cache: Map<string, A2AAgentCard> = new Map();

  /**
   * Fetch agent card from a base URL
   * Tries multiple well-known paths for compatibility
   */
  async fetchAgentCard(baseUrl: string): Promise<A2AAgentCard> {
    // Check cache first
    const cached = this.cache.get(baseUrl);
    if (cached) {
      return cached;
    }

    // Normalize base URL
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

    // Try multiple well-known paths for compatibility
    const paths = [
      '/.well-known/agent-card.json',      // Standard A2A path
      '/.well-known/a2a/agent_card.json',  // Alternative path
      '/.well-known/agent.json',           // Another common variant
    ];

    let lastError: Error | null = null;

    for (const path of paths) {
      const url = `${base}${path}`;
      try {
        const response = await axios.get<A2AAgentCard>(url, {
          timeout: 10000,
        });

        const card = response.data;

        // Validate card
        if (!card.name || !card.description || !card.url) {
          throw new Error('Invalid agent card: missing required fields');
        }

        // Cache it
        this.cache.set(baseUrl, card);

        console.log(`Found agent card at ${url}`);
        return card;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          // Try next path
          continue;
        }
        lastError = error instanceof Error ? error : new Error('Unknown error');
      }
    }

    throw lastError || new Error(`Agent card not found at ${baseUrl}`);
  }

  /**
   * Clear cache for a URL
   */
  clearCache(baseUrl?: string): void {
    if (baseUrl) {
      this.cache.delete(baseUrl);
    } else {
      this.cache.clear();
    }
  }
}

// Singleton resolver instance
export const agentCardResolver = new AgentCardResolver();

/**
 * Create an A2A client for an agent
 */
export async function createA2AClient(agentUrl: string): Promise<A2AClient> {
  const card = await agentCardResolver.fetchAgentCard(agentUrl);
  return new A2AClient(card);
}
