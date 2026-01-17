/**
 * @file vla-client.ts
 * @description gRPC client for VLA inference with connection management
 * @feature vla
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type {
  VLAClientConfig,
  ConnectionState,
  VLAClientEvent,
  Observation,
  ActionChunk,
  ModelInfo,
  HealthStatus,
  InferenceMetrics,
} from './types.js';
import { VLAMetrics } from './metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Default configuration values */
const DEFAULT_CONFIG: Required<Omit<VLAClientConfig, 'restFallbackUrl'>> & {
  restFallbackUrl: string | undefined;
} = {
  host: 'localhost',
  port: 50051,
  poolSize: 4,
  healthCheckIntervalMs: 5000,
  reconnectDelayMs: 100,
  maxReconnectDelayMs: 30000,
  restFallbackUrl: undefined,
  timeoutMs: 5000,
};

/** Proto file path relative to this module */
const PROTO_PATH = join(__dirname, 'proto', 'vla_inference.proto');

/**
 * gRPC client type for VLA inference service.
 */
interface VLAInferenceClient {
  Predict(
    request: ProtoObservation,
    callback: (error: grpc.ServiceError | null, response: ProtoActionChunk) => void
  ): void;
  Predict(
    request: ProtoObservation,
    metadata: grpc.Metadata,
    callback: (error: grpc.ServiceError | null, response: ProtoActionChunk) => void
  ): void;
  StreamControl(): grpc.ClientDuplexStream<ProtoObservation, ProtoActionChunk>;
  GetModelInfo(
    request: Record<string, never>,
    callback: (error: grpc.ServiceError | null, response: ProtoModelInfo) => void
  ): void;
  HealthCheck(
    request: Record<string, never>,
    callback: (error: grpc.ServiceError | null, response: ProtoHealthStatus) => void
  ): void;
}

/** Proto message types (from proto-loader) */
interface ProtoObservation {
  camera_image: Buffer;
  joint_positions: number[];
  joint_velocities: number[];
  language_instruction: string;
  timestamp: number;
  embodiment_tag: string;
  session_id?: string;
}

interface ProtoAction {
  joint_commands: number[];
  gripper_command: number;
  timestamp: number;
}

interface ProtoActionChunk {
  actions: ProtoAction[];
  inference_time_ms: number;
  model_version: string;
  confidence: number;
  sequence_number: number;
}

interface ProtoModelInfo {
  model_name: string;
  model_version: string;
  action_dim: number;
  chunk_size: number;
  supported_embodiments: string[];
  image_width: number;
  image_height: number;
  base_model: string;
}

interface ProtoHealthStatus {
  ready: boolean;
  gpu_utilization: number;
  memory_utilization: number;
  queue_depth: number;
  uptime_seconds: number;
  total_requests: number;
  avg_latency_ms: number;
}

/**
 * Connection pool entry.
 */
interface PooledConnection {
  client: VLAInferenceClient;
  inUse: boolean;
  lastUsed: number;
}

/**
 * VLAClient provides gRPC communication with the VLA inference server.
 *
 * Features:
 * - Connection pooling for parallel requests
 * - Automatic reconnection with exponential backoff
 * - Health check polling
 * - REST fallback on gRPC failure
 * - Latency metrics tracking
 */
export class VLAClient extends EventEmitter {
  private config: Required<Omit<VLAClientConfig, 'restFallbackUrl'>> & {
    restFallbackUrl: string | undefined;
  };
  private connectionPool: PooledConnection[] = [];
  private _state: ConnectionState = 'connecting';
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentReconnectDelay: number;
  private protoDefinition: grpc.GrpcObject | null = null;
  private metrics: VLAMetrics;
  private _lastHealthStatus: HealthStatus | null = null;
  private _modelInfo: ModelInfo | null = null;
  private streamCall: grpc.ClientDuplexStream<ProtoObservation, ProtoActionChunk> | null = null;

  constructor(config: Partial<VLAClientConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentReconnectDelay = this.config.reconnectDelayMs;
    this.metrics = new VLAMetrics();
  }

  /**
   * Get current connection state.
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Get last health status.
   */
  get lastHealthStatus(): HealthStatus | null {
    return this._lastHealthStatus;
  }

  /**
   * Get cached model info.
   */
  get modelInfo(): ModelInfo | null {
    return this._modelInfo;
  }

  /**
   * Initialize the client and establish connections.
   */
  async connect(): Promise<void> {
    try {
      this._state = 'connecting';

      // Load proto definition
      const packageDefinition = await protoLoader.load(PROTO_PATH, {
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      this.protoDefinition = grpc.loadPackageDefinition(packageDefinition);

      // Create connection pool
      await this.initializePool();

      // Start health check polling
      this.startHealthCheck();

      // Fetch model info
      await this.refreshModelInfo();

      this._state = 'ready';
      this.currentReconnectDelay = this.config.reconnectDelayMs;
      this.emit('connected');
    } catch (error) {
      this._state = 'error';
      this.emit('error', error);
      this.scheduleReconnect();
      throw error;
    }
  }

  /**
   * Initialize the connection pool.
   */
  private async initializePool(): Promise<void> {
    if (!this.protoDefinition) {
      throw new Error('Proto definition not loaded');
    }

    const VLAInference = (this.protoDefinition.vla as grpc.GrpcObject)
      .VLAInference as grpc.ServiceClientConstructor;

    const address = `${this.config.host}:${this.config.port}`;

    for (let i = 0; i < this.config.poolSize; i++) {
      const client = new VLAInference(
        address,
        grpc.credentials.createInsecure(),
        {
          'grpc.max_send_message_length': 16 * 1024 * 1024, // 16MB
          'grpc.max_receive_message_length': 16 * 1024 * 1024,
          'grpc.keepalive_time_ms': 10000,
          'grpc.keepalive_timeout_ms': 5000,
        }
      ) as unknown as VLAInferenceClient;

      this.connectionPool.push({
        client,
        inUse: false,
        lastUsed: Date.now(),
      });
    }
  }

  /**
   * Get an available connection from the pool.
   */
  private acquireConnection(): PooledConnection | null {
    const available = this.connectionPool.find((conn) => !conn.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available;
    }
    return null;
  }

  /**
   * Release a connection back to the pool.
   */
  private releaseConnection(conn: PooledConnection): void {
    conn.inUse = false;
    conn.lastUsed = Date.now();
  }

  /**
   * Start health check polling.
   */
  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckTimer = setInterval(async () => {
      try {
        const status = await this.healthCheck();
        this._lastHealthStatus = status;
        this.emit('healthCheck', status);

        if (!status.ready && this._state === 'ready') {
          console.warn('[VLAClient] Server not ready, will retry...');
        }
      } catch (error) {
        console.error('[VLAClient] Health check failed:', error);
        if (this._state === 'ready') {
          this._state = 'error';
          this.emit('error', error);
          this.scheduleReconnect();
        }
      }
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Stop health check polling.
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.emit('reconnecting', this.currentReconnectDelay);
    console.log(
      `[VLAClient] Scheduling reconnect in ${this.currentReconnectDelay}ms`
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        await this.reconnect();
      } catch (error) {
        // Exponential backoff
        this.currentReconnectDelay = Math.min(
          this.currentReconnectDelay * 2,
          this.config.maxReconnectDelayMs
        );
        this.scheduleReconnect();
      }
    }, this.currentReconnectDelay);
  }

  /**
   * Attempt to reconnect.
   */
  private async reconnect(): Promise<void> {
    // Clear old connections
    this.connectionPool = [];

    // Reinitialize
    await this.connect();
  }

  /**
   * Perform a single VLA inference.
   */
  async predict(observation: Observation): Promise<ActionChunk> {
    const startTime = Date.now();

    try {
      const result = await this.predictGrpc(observation);
      this.metrics.recordSuccess(Date.now() - startTime);
      return result;
    } catch (error) {
      // Try REST fallback if configured
      if (this.config.restFallbackUrl) {
        try {
          const result = await this.predictRestFallback(observation);
          this.metrics.recordFallback(Date.now() - startTime);
          console.warn('[VLAClient] gRPC failed, used REST fallback');
          return result;
        } catch (fallbackError) {
          this.metrics.recordFailure();
          throw fallbackError;
        }
      }

      this.metrics.recordFailure();
      throw error;
    }
  }

  /**
   * Perform gRPC prediction.
   */
  private async predictGrpc(observation: Observation): Promise<ActionChunk> {
    const conn = this.acquireConnection();
    if (!conn) {
      throw new Error('No available connections in pool');
    }

    const request = this.toProtoObservation(observation);

    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + this.config.timeoutMs);
      const metadata = new grpc.Metadata();
      metadata.set('deadline', deadline.toISOString());

      conn.client.Predict(request, metadata, (error, response) => {
        this.releaseConnection(conn);

        if (error) {
          reject(error);
          return;
        }

        resolve(this.fromProtoActionChunk(response));
      });
    });
  }

  /**
   * Fallback to REST API.
   */
  private async predictRestFallback(
    observation: Observation
  ): Promise<ActionChunk> {
    if (!this.config.restFallbackUrl) {
      throw new Error('REST fallback URL not configured');
    }

    const response = await fetch(`${this.config.restFallbackUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera_image: observation.cameraImage.toString('base64'),
        joint_positions: observation.jointPositions,
        joint_velocities: observation.jointVelocities,
        language_instruction: observation.languageInstruction,
        timestamp: observation.timestamp,
        embodiment_tag: observation.embodimentTag,
        session_id: observation.sessionId,
      }),
    });

    if (!response.ok) {
      throw new Error(`REST fallback failed: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      actions: Array<{
        joint_commands: number[];
        gripper_command: number;
        timestamp: number;
      }>;
      inference_time_ms: number;
      model_version: string;
      confidence: number;
      sequence_number?: number;
    };
    return {
      actions: data.actions.map((a) => ({
        jointCommands: a.joint_commands,
        gripperCommand: a.gripper_command,
        timestamp: a.timestamp,
      })),
      inferenceTimeMs: data.inference_time_ms,
      modelVersion: data.model_version,
      confidence: data.confidence,
      sequenceNumber: data.sequence_number || 0,
    };
  }

  /**
   * Start bidirectional streaming for continuous control.
   */
  startStream(
    onActionChunk: (chunk: ActionChunk) => void,
    onError?: (error: Error) => void
  ): void {
    const conn = this.acquireConnection();
    if (!conn) {
      throw new Error('No available connections in pool');
    }

    this.streamCall = conn.client.StreamControl();

    this.streamCall.on('data', (response: ProtoActionChunk) => {
      const chunk = this.fromProtoActionChunk(response);
      this.metrics.recordSuccess(chunk.inferenceTimeMs);
      onActionChunk(chunk);
    });

    this.streamCall.on('error', (error: Error) => {
      this.releaseConnection(conn);
      this.streamCall = null;
      this.metrics.recordFailure();
      if (onError) onError(error);
    });

    this.streamCall.on('end', () => {
      this.releaseConnection(conn);
      this.streamCall = null;
    });
  }

  /**
   * Send an observation through the stream.
   */
  sendObservation(observation: Observation): void {
    if (!this.streamCall) {
      throw new Error('Stream not started. Call startStream() first.');
    }
    this.streamCall.write(this.toProtoObservation(observation));
  }

  /**
   * End the streaming session.
   */
  endStream(): void {
    if (this.streamCall) {
      this.streamCall.end();
      this.streamCall = null;
    }
  }

  /**
   * Get model info from server.
   */
  async getModelInfo(): Promise<ModelInfo> {
    const conn = this.acquireConnection();
    if (!conn) {
      throw new Error('No available connections in pool');
    }

    return new Promise((resolve, reject) => {
      conn.client.GetModelInfo({}, (error, response) => {
        this.releaseConnection(conn);

        if (error) {
          reject(error);
          return;
        }

        resolve(this.fromProtoModelInfo(response));
      });
    });
  }

  /**
   * Refresh cached model info.
   */
  async refreshModelInfo(): Promise<ModelInfo> {
    try {
      this._modelInfo = await this.getModelInfo();
      return this._modelInfo;
    } catch (error) {
      console.warn('[VLAClient] Failed to get model info:', error);
      throw error;
    }
  }

  /**
   * Perform health check.
   */
  async healthCheck(): Promise<HealthStatus> {
    const conn = this.acquireConnection();
    if (!conn) {
      throw new Error('No available connections in pool');
    }

    return new Promise((resolve, reject) => {
      conn.client.HealthCheck({}, (error, response) => {
        this.releaseConnection(conn);

        if (error) {
          reject(error);
          return;
        }

        resolve(this.fromProtoHealthStatus(response));
      });
    });
  }

  /**
   * Get current inference metrics.
   */
  getMetrics(): InferenceMetrics {
    return this.metrics.getMetrics();
  }

  /**
   * Get metrics in Prometheus format.
   */
  getPrometheusMetrics(): string {
    return this.metrics.toPrometheusFormat();
  }

  /**
   * Close the client and release resources.
   */
  close(): void {
    this.stopHealthCheck();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.endStream();

    for (const conn of this.connectionPool) {
      (conn.client as unknown as grpc.Client).close();
    }
    this.connectionPool = [];

    this._state = 'closed';
    this.emit('disconnected');
  }

  /**
   * Convert to proto observation.
   */
  private toProtoObservation(obs: Observation): ProtoObservation {
    return {
      camera_image: obs.cameraImage,
      joint_positions: obs.jointPositions,
      joint_velocities: obs.jointVelocities,
      language_instruction: obs.languageInstruction,
      timestamp: obs.timestamp,
      embodiment_tag: obs.embodimentTag,
      session_id: obs.sessionId,
    };
  }

  /**
   * Convert from proto action chunk.
   */
  private fromProtoActionChunk(proto: ProtoActionChunk): ActionChunk {
    return {
      actions: (proto.actions || []).map((a) => ({
        // Ensure jointCommands is always an array (proto defaults may return undefined)
        jointCommands: Array.isArray(a.joint_commands) ? a.joint_commands : [],
        gripperCommand: typeof a.gripper_command === 'number' ? a.gripper_command : 0.5,
        timestamp: a.timestamp || Date.now() / 1000,
      })),
      inferenceTimeMs: proto.inference_time_ms || 0,
      modelVersion: proto.model_version || 'unknown',
      confidence: proto.confidence || 0,
      sequenceNumber: proto.sequence_number || 0,
    };
  }

  /**
   * Convert from proto model info.
   */
  private fromProtoModelInfo(proto: ProtoModelInfo): ModelInfo {
    return {
      modelName: proto.model_name,
      modelVersion: proto.model_version,
      actionDim: proto.action_dim,
      chunkSize: proto.chunk_size,
      supportedEmbodiments: proto.supported_embodiments,
      imageWidth: proto.image_width,
      imageHeight: proto.image_height,
      baseModel: proto.base_model,
    };
  }

  /**
   * Convert from proto health status.
   */
  private fromProtoHealthStatus(proto: ProtoHealthStatus): HealthStatus {
    return {
      ready: proto.ready,
      gpuUtilization: proto.gpu_utilization,
      memoryUtilization: proto.memory_utilization,
      queueDepth: proto.queue_depth,
      uptimeSeconds: proto.uptime_seconds,
      totalRequests: proto.total_requests,
      avgLatencyMs: proto.avg_latency_ms,
    };
  }
}
