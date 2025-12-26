/**
 * @file HttpClient.ts
 * @description Centralized HTTP client with consistent timeout and error handling
 */

import axios, { type AxiosInstance, type AxiosError, type AxiosRequestConfig } from 'axios';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Default timeout configurations in milliseconds */
export const HTTP_TIMEOUTS = {
  /** Quick health checks */
  SHORT: 5000,
  /** Standard API calls */
  MEDIUM: 10000,
  /** Long operations like commands */
  LONG: 30000,
} as const;

// ============================================================================
// ERROR TYPES
// ============================================================================

export class HttpClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'HttpClientError';
  }

  /** Check if error is a timeout */
  isTimeout(): boolean {
    return this.message.includes('timeout') || this.message.includes('ETIMEDOUT');
  }

  /** Check if error is a connection refused */
  isConnectionRefused(): boolean {
    return this.message.includes('ECONNREFUSED');
  }

  /** Check if error is a network error */
  isNetworkError(): boolean {
    return this.isTimeout() || this.isConnectionRefused();
  }
}

// ============================================================================
// HTTP CLIENT
// ============================================================================

/**
 * Centralized HTTP client for robot communication
 * Provides consistent timeout, error handling, and logging
 */
export class HttpClient {
  private axios: AxiosInstance;

  constructor(
    private readonly baseUrl?: string,
    private readonly defaultTimeout: number = HTTP_TIMEOUTS.MEDIUM
  ) {
    this.axios = axios.create({
      baseURL: baseUrl,
      timeout: defaultTimeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Extract error message from axios error
   */
  private extractErrorMessage(error: unknown, url: string): HttpClientError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status;

      if (axiosError.code === 'ECONNABORTED') {
        return new HttpClientError(`Request timeout: ${url}`, undefined, url, error);
      }

      if (axiosError.code === 'ECONNREFUSED') {
        return new HttpClientError(`Connection refused: ${url}`, undefined, url, error);
      }

      if (statusCode) {
        const message = axiosError.response?.data
          ? JSON.stringify(axiosError.response.data)
          : axiosError.message;
        return new HttpClientError(`HTTP ${statusCode}: ${message}`, statusCode, url, error);
      }

      return new HttpClientError(axiosError.message, undefined, url, error);
    }

    if (error instanceof Error) {
      return new HttpClientError(error.message, undefined, url, error);
    }

    return new HttpClientError('Unknown error', undefined, url);
  }

  /**
   * GET request
   */
  async get<T>(
    url: string,
    options?: { timeout?: number; params?: Record<string, unknown> }
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      timeout: options?.timeout ?? this.defaultTimeout,
      params: options?.params,
    };

    try {
      const response = await this.axios.get<T>(url, config);
      return response.data;
    } catch (error) {
      throw this.extractErrorMessage(error, url);
    }
  }

  /**
   * POST request
   */
  async post<T>(
    url: string,
    data?: unknown,
    options?: { timeout?: number }
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      timeout: options?.timeout ?? this.defaultTimeout,
    };

    try {
      const response = await this.axios.post<T>(url, data, config);
      return response.data;
    } catch (error) {
      throw this.extractErrorMessage(error, url);
    }
  }

  /**
   * PUT request
   */
  async put<T>(
    url: string,
    data?: unknown,
    options?: { timeout?: number }
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      timeout: options?.timeout ?? this.defaultTimeout,
    };

    try {
      const response = await this.axios.put<T>(url, data, config);
      return response.data;
    } catch (error) {
      throw this.extractErrorMessage(error, url);
    }
  }

  /**
   * DELETE request
   */
  async delete<T>(
    url: string,
    options?: { timeout?: number }
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      timeout: options?.timeout ?? this.defaultTimeout,
    };

    try {
      const response = await this.axios.delete<T>(url, config);
      return response.data;
    } catch (error) {
      throw this.extractErrorMessage(error, url);
    }
  }
}

/**
 * Create an HTTP client for a specific robot base URL
 */
export function createRobotHttpClient(baseUrl: string): HttpClient {
  return new HttpClient(baseUrl, HTTP_TIMEOUTS.MEDIUM);
}

/**
 * Singleton HTTP client for general use
 */
export const httpClient = new HttpClient();
