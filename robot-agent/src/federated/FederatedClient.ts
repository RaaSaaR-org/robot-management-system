/**
 * @file FederatedClient.ts
 * @description HTTP client for communicating with the server's Federated Learning API
 * @feature Federated Learning
 */

import type { FederatedRound } from './types.js';

/** Response when joining a round */
export interface JoinRoundResponse {
  success: boolean;
  participantId: string;
  message: string;
}

/** Response when uploading gradients */
export interface UploadGradientsResponse {
  success: boolean;
  message: string;
  receivedAt: string;
}

/** Response when downloading the global model */
export interface DownloadModelResponse {
  success: boolean;
  modelUri: string;
  roundNumber: number;
  aggregatedFrom: number;
}

/**
 * HTTP client for the server's Federated Learning rounds API.
 * Communicates with endpoints at /api/federated/rounds/...
 */
export class FederatedClient {
  private readonly baseUrl: string;
  private readonly robotId: string;
  private readonly timeoutMs: number;

  constructor(serverUrl: string, robotId: string, timeoutMs: number = 30000) {
    this.baseUrl = `${serverUrl}/api/federated`;
    this.robotId = robotId;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Poll for open federated learning rounds.
   *
   * @returns Array of open rounds, or empty array if none available
   */
  async getOpenRounds(): Promise<FederatedRound[]> {
    const response = await this.request<{ rounds: FederatedRound[] }>(
      '/rounds?status=open',
      'GET',
    );
    return response.rounds;
  }

  /**
   * Join a federated learning round.
   *
   * @param roundId - The round to join
   * @returns Join confirmation with participant ID
   */
  async joinRound(roundId: string): Promise<JoinRoundResponse> {
    return this.request<JoinRoundResponse>(
      `/rounds/${roundId}/join`,
      'POST',
      { robotId: this.robotId },
    );
  }

  /**
   * Upload locally computed (and DP-protected) gradients for a round.
   *
   * @param roundId - The round to upload gradients for
   * @param gradients - DP-protected gradient matrices
   * @param metadata - Optional training metadata (loss, steps, etc.)
   * @returns Upload confirmation
   */
  async uploadGradients(
    roundId: string,
    gradients: number[][],
    metadata?: { loss: number; steps: number; duration_ms: number },
  ): Promise<UploadGradientsResponse> {
    return this.request<UploadGradientsResponse>(
      `/rounds/${roundId}/gradients`,
      'POST',
      {
        robotId: this.robotId,
        gradients,
        metadata,
      },
    );
  }

  /**
   * Download the aggregated global model after a round completes.
   *
   * @param roundId - The round whose model to download
   * @returns Model URI and metadata
   */
  async downloadGlobalModel(roundId: string): Promise<DownloadModelResponse> {
    return this.request<DownloadModelResponse>(
      `/rounds/${roundId}/model`,
      'GET',
    );
  }

  /**
   * Get the current status of a federated learning round.
   *
   * @param roundId - The round to query
   * @returns Round metadata
   */
  async getRoundStatus(roundId: string): Promise<FederatedRound> {
    return this.request<FederatedRound>(
      `/rounds/${roundId}`,
      'GET',
    );
  }

  /**
   * Send an HTTP request with timeout handling.
   */
  private async request<T>(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Robot-Id': this.robotId,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error');
        throw new Error(
          `Federated API error: ${response.status} ${response.statusText} — ${errorBody}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Federated API timeout after ${this.timeoutMs}ms: ${method} ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
