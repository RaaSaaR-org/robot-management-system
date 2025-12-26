/**
 * @file websocket.ts
 * @description WebSocket client for real-time telemetry streaming
 */

import WebSocket from 'ws';
import type { RobotTelemetry, RobotAlert } from './types.js';

export interface TelemetryStreamOptions {
  onTelemetry: (telemetry: RobotTelemetry) => void;
  onAlert: (alert: RobotAlert) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  onConnect?: () => void;
}

interface TelemetryMessage {
  type: 'telemetry' | 'alert' | 'pong';
  data?: RobotTelemetry;
  alert?: RobotAlert;
}

export class TelemetryStream {
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private options: TelemetryStreamOptions | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private pingInterval: NodeJS.Timeout | null = null;

  /**
   * Connect to telemetry WebSocket
   */
  connect(url: string, options: TelemetryStreamOptions): void {
    this.url = url;
    this.options = options;
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  private doConnect(): void {
    if (!this.url || !this.options) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.options?.onConnect?.();
        this.startPing();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as TelemetryMessage;

          if (message.type === 'telemetry' && message.data) {
            this.options?.onTelemetry(message.data);
          } else if (message.type === 'alert' && message.alert) {
            this.options?.onAlert(message.alert);
          }
        } catch {
          // Ignore parse errors
        }
      });

      this.ws.on('error', (error: Error) => {
        this.options?.onError(error);
      });

      this.ws.on('close', () => {
        this.stopPing();

        // Try to reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.doConnect(), 1000 * this.reconnectAttempts);
        } else {
          this.options?.onClose();
        }
      });
    } catch (error) {
      this.options?.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private startPing(): void {
    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.stopPing();
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Create a new telemetry stream
 */
export function createTelemetryStream(): TelemetryStream {
  return new TelemetryStream();
}
