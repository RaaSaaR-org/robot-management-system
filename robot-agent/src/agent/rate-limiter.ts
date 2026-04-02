/**
 * @file rate-limiter.ts
 * @description Token-bucket rate limiter for free-tier LLM providers (e.g., OpenRouter ~20 req/min)
 */

export interface RateLimiterConfig {
  maxRequestsPerMinute: number;
  maxRetries: number;
  baseRetryDelayMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequestsPerMinute: 18, // conservative vs 20 limit
  maxRetries: 3,
  baseRetryDelayMs: 3000,
};

export class RateLimiter {
  private timestamps: number[] = [];
  private readonly config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Wait until a request slot is available (pre-request throttling).
   */
  async acquireSlot(): Promise<void> {
    const now = Date.now();
    const windowStart = now - 60_000;

    // Prune old timestamps
    this.timestamps = this.timestamps.filter((t) => t > windowStart);

    if (this.timestamps.length >= this.config.maxRequestsPerMinute) {
      const oldestInWindow = this.timestamps[0];
      const waitMs = oldestInWindow + 60_000 - now + 100; // +100ms buffer
      console.warn(
        `[RateLimiter] Rate limit reached (${this.timestamps.length}/${this.config.maxRequestsPerMinute} req/min). Waiting ${waitMs}ms...`
      );
      await this.sleep(waitMs);
    }

    this.timestamps.push(Date.now());
  }

  /**
   * Execute a function with pre-request throttling + retry on 429 errors.
   */
  async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot();

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (this.isRateLimitError(error) && attempt < this.config.maxRetries) {
          const delay = this.config.baseRetryDelayMs * Math.pow(2, attempt);
          console.warn(
            `[RateLimiter] 429 rate limit hit (attempt ${attempt + 1}/${this.config.maxRetries + 1}). Retrying in ${delay}ms...`
          );
          await this.sleep(delay);
          await this.acquireSlot();
        } else {
          throw error;
        }
      }
    }
    throw lastError;
  }

  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      if (error.message.includes("429") || error.message.toLowerCase().includes("rate limit")) {
        return true;
      }
      const statusError = error as { status?: number; statusCode?: number };
      if (statusError.status === 429 || statusError.statusCode === 429) {
        return true;
      }
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
