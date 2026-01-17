/**
 * @file nats-client.ts
 * @description NATS JetStream client singleton with connection management
 * @feature messaging
 */

import {
  connect,
  NatsConnection,
  JetStreamClient,
  JetStreamManager,
  KV,
  StringCodec,
  ConnectionOptions,
  NatsError,
} from 'nats';

// ============================================================================
// TYPES
// ============================================================================

export interface NatsClientConfig {
  servers: string | string[];
  user?: string;
  pass?: string;
  name?: string;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectTimeWait?: number;
}

export type NatsConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export type NatsStatusCallback = (status: NatsConnectionStatus, error?: Error) => void;

// ============================================================================
// NATS CLIENT SINGLETON
// ============================================================================

/**
 * Singleton NATS client with JetStream support
 */
export class NatsClient {
  private static instance: NatsClient;

  private connection: NatsConnection | null = null;
  private jetstream: JetStreamClient | null = null;
  private jetstreamManager: JetStreamManager | null = null;
  private kvStores: Map<string, KV> = new Map();
  private statusCallbacks: Set<NatsStatusCallback> = new Set();
  private status: NatsConnectionStatus = 'disconnected';
  private config: NatsClientConfig | null = null;

  private readonly sc = StringCodec();

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): NatsClient {
    if (!NatsClient.instance) {
      NatsClient.instance = new NatsClient();
    }
    return NatsClient.instance;
  }

  /**
   * Connect to NATS server
   */
  async connect(config?: NatsClientConfig): Promise<void> {
    if (this.connection) {
      console.log('[NatsClient] Already connected');
      return;
    }

    this.config = config ?? this.getConfigFromEnv();
    this.setStatus('connecting');

    try {
      const options: ConnectionOptions = {
        servers: this.config.servers,
        name: this.config.name ?? 'robomind-server',
        reconnect: this.config.reconnect ?? true,
        maxReconnectAttempts: this.config.maxReconnectAttempts ?? -1, // Infinite
        reconnectTimeWait: this.config.reconnectTimeWait ?? 2000,
      };

      if (this.config.user && this.config.pass) {
        options.user = this.config.user;
        options.pass = this.config.pass;
      }

      this.connection = await connect(options);
      console.log(`[NatsClient] Connected to ${this.config.servers}`);

      // Initialize JetStream
      this.jetstream = this.connection.jetstream();
      this.jetstreamManager = await this.connection.jetstreamManager();
      console.log('[NatsClient] JetStream initialized');

      this.setStatus('connected');

      // Setup connection event handlers
      this.setupEventHandlers();
    } catch (error) {
      this.setStatus('disconnected', error as Error);
      throw error;
    }
  }

  /**
   * Setup connection event handlers
   */
  private setupEventHandlers(): void {
    if (!this.connection) return;

    // Handle connection status changes
    (async () => {
      if (!this.connection) return;

      for await (const status of this.connection.status()) {
        switch (status.type) {
          case 'disconnect':
            console.log('[NatsClient] Disconnected');
            this.setStatus('disconnected');
            break;
          case 'reconnect':
            console.log('[NatsClient] Reconnected');
            this.setStatus('connected');
            break;
          case 'reconnecting':
            console.log('[NatsClient] Reconnecting...');
            this.setStatus('reconnecting');
            break;
          case 'error':
            console.error('[NatsClient] Connection error:', status.data);
            break;
          case 'update':
            console.log('[NatsClient] Server update:', status.data);
            break;
        }
      }
    })().catch((err) => {
      console.error('[NatsClient] Status listener error:', err);
    });

    // Handle connection close
    this.connection.closed().then((err: Error | void) => {
      if (err) {
        console.error('[NatsClient] Connection closed with error:', err);
      } else {
        console.log('[NatsClient] Connection closed');
      }
      this.setStatus('closed');
    });
  }

  /**
   * Get config from environment variables
   */
  private getConfigFromEnv(): NatsClientConfig {
    return {
      servers: process.env.NATS_SERVERS ?? 'nats://localhost:4222',
      user: process.env.NATS_USER || undefined,
      pass: process.env.NATS_PASS || undefined,
      name: 'robomind-server',
    };
  }

  /**
   * Update and emit status
   */
  private setStatus(status: NatsConnectionStatus, error?: Error): void {
    this.status = status;
    this.statusCallbacks.forEach((cb) => {
      try {
        cb(status, error);
      } catch (err) {
        console.error('[NatsClient] Status callback error:', err);
      }
    });
  }

  /**
   * Subscribe to connection status changes
   */
  onStatus(callback: NatsStatusCallback): () => void {
    this.statusCallbacks.add(callback);
    // Immediately emit current status
    callback(this.status);
    return () => this.statusCallbacks.delete(callback);
  }

  /**
   * Get current connection status
   */
  getStatus(): NatsConnectionStatus {
    return this.status;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.status === 'connected' && this.connection !== null;
  }

  /**
   * Get NATS connection
   */
  getConnection(): NatsConnection {
    if (!this.connection) {
      throw new Error('NATS not connected');
    }
    return this.connection;
  }

  /**
   * Get JetStream client
   */
  getJetStream(): JetStreamClient {
    if (!this.jetstream) {
      throw new Error('JetStream not initialized');
    }
    return this.jetstream;
  }

  /**
   * Get JetStream manager
   */
  getJetStreamManager(): JetStreamManager {
    if (!this.jetstreamManager) {
      throw new Error('JetStream manager not initialized');
    }
    return this.jetstreamManager;
  }

  /**
   * Get or create a KV store
   */
  async getKV(name: string): Promise<KV> {
    if (this.kvStores.has(name)) {
      return this.kvStores.get(name)!;
    }

    if (!this.jetstream) {
      throw new Error('JetStream not initialized');
    }

    const kv = await this.jetstream.views.kv(name);
    this.kvStores.set(name, kv);
    return kv;
  }

  /**
   * Publish a message to a subject
   */
  async publish(subject: string, data: unknown): Promise<void> {
    if (!this.connection) {
      throw new Error('NATS not connected');
    }
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.connection.publish(subject, this.sc.encode(payload));
  }

  /**
   * Publish a message to JetStream with optional deduplication
   */
  async jetPublish(
    subject: string,
    data: unknown,
    options?: { msgID?: string }
  ): Promise<{ seq: number; duplicate: boolean }> {
    if (!this.jetstream) {
      throw new Error('JetStream not initialized');
    }

    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const pubAck = await this.jetstream.publish(subject, this.sc.encode(payload), {
      msgID: options?.msgID,
    });

    return {
      seq: pubAck.seq,
      duplicate: pubAck.duplicate,
    };
  }

  /**
   * Request/reply pattern
   */
  async request<T = unknown>(subject: string, data: unknown, timeout = 5000): Promise<T> {
    if (!this.connection) {
      throw new Error('NATS not connected');
    }

    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const response = await this.connection.request(subject, this.sc.encode(payload), {
      timeout,
    });

    const responseData = this.sc.decode(response.data);
    try {
      return JSON.parse(responseData) as T;
    } catch {
      return responseData as T;
    }
  }

  /**
   * Gracefully close connection
   */
  async close(): Promise<void> {
    if (!this.connection) {
      return;
    }

    console.log('[NatsClient] Closing connection...');
    await this.connection.drain();
    this.connection = null;
    this.jetstream = null;
    this.jetstreamManager = null;
    this.kvStores.clear();
    this.setStatus('closed');
    console.log('[NatsClient] Connection closed');
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const natsClient = NatsClient.getInstance();
