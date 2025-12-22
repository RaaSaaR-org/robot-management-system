/**
 * @file agent-executor.ts
 * @description A2A AgentExecutor implementation for processing natural language commands
 */

import { v4 as uuidv4 } from 'uuid';
import type { MessageData } from 'genkit';
import type { Task, TaskStatusUpdateEvent, TextPart, Message, TaskState } from '@a2a-js/sdk';
import type { AgentExecutor, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import { ai } from './genkit.js';
import { moveToLocation, stopMovement, goToCharge, returnHome } from '../tools/navigation.js';
import { pickupObject, dropObject } from '../tools/manipulation.js';
import { getRobotStatus, emergencyStop } from '../tools/status.js';
import type { RobotStateManager } from '../robot/state.js';

// Load the Genkit prompt
const robotAgentPrompt = ai.prompt('robot_agent');

// Store contexts for multi-turn conversations
const contexts: Map<string, Message[]> = new Map();

export class RobotAgentExecutor implements AgentExecutor {
  private cancelledTasks = new Set<string>();
  private robotStateManager: RobotStateManager;

  constructor(robotStateManager: RobotStateManager) {
    this.robotStateManager = robotStateManager;
  }

  public async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    this.cancelledTasks.add(taskId);
    // Also stop any ongoing robot movement
    await this.robotStateManager.stop();
  }

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    // Determine IDs for the task and context
    const taskId = existingTask?.id || uuidv4();
    const contextId = userMessage.contextId || existingTask?.contextId || uuidv4();

    console.log(
      `[RobotAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
    );

    // 1. Publish initial Task event if it's a new task
    if (!existingTask) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId: contextId,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        history: [userMessage],
        metadata: userMessage.metadata,
      };
      eventBus.publish(initialTask);
    }

    // 2. Publish "working" status update
    const workingStatusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      status: {
        state: 'working',
        message: {
          kind: 'message',
          role: 'agent',
          messageId: uuidv4(),
          parts: [{ kind: 'text', text: 'Processing your command...' }],
          taskId: taskId,
          contextId: contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    };
    eventBus.publish(workingStatusUpdate);

    // 3. Prepare messages for Genkit prompt
    const historyForGenkit = contexts.get(contextId) || [];
    if (!historyForGenkit.find((m) => m.messageId === userMessage.messageId)) {
      historyForGenkit.push(userMessage);
    }
    contexts.set(contextId, historyForGenkit);

    const messages: MessageData[] = historyForGenkit
      .map((m) => ({
        role: (m.role === 'agent' ? 'model' : 'user') as 'user' | 'model',
        content: m.parts
          .filter((p): p is TextPart => p.kind === 'text' && !!(p as TextPart).text)
          .map((p) => ({
            text: (p as TextPart).text,
          })),
      }))
      .filter((m) => m.content.length > 0);

    if (messages.length === 0) {
      console.warn(`[RobotAgentExecutor] No valid text messages found for task ${taskId}.`);
      const failureUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: taskId,
        contextId: contextId,
        status: {
          state: 'failed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: 'No message found to process.' }],
            taskId: taskId,
            contextId: contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(failureUpdate);
      return;
    }

    try {
      // 4. Get current robot state for context
      const robotState = this.robotStateManager.getState();

      // 5. Run the Genkit prompt with tools
      const response = await robotAgentPrompt(
        {
          robotId: robotState.id,
          robotName: robotState.name,
          robotClass: robotState.robotClass,
          maxPayloadKg: robotState.maxPayloadKg,
          robotDescription: robotState.description,
          currentLocation: `(${robotState.location.x.toFixed(1)}, ${robotState.location.y.toFixed(1)}) in ${robotState.location.zone || 'Unknown Zone'}, Floor ${robotState.location.floor || '1'}`,
          batteryLevel: Math.round(robotState.batteryLevel),
          status: robotState.status,
          heldObject: robotState.heldObject || 'nothing',
          now: new Date().toISOString(),
        },
        {
          messages,
          tools: [
            moveToLocation,
            stopMovement,
            goToCharge,
            returnHome,
            pickupObject,
            dropObject,
            getRobotStatus,
            emergencyStop,
          ],
        }
      );

      // Check if the request has been cancelled
      if (this.cancelledTasks.has(taskId)) {
        console.log(`[RobotAgentExecutor] Request cancelled for task: ${taskId}`);
        const cancelledUpdate: TaskStatusUpdateEvent = {
          kind: 'status-update',
          taskId: taskId,
          contextId: contextId,
          status: {
            state: 'canceled',
            timestamp: new Date().toISOString(),
          },
          final: true,
        };
        eventBus.publish(cancelledUpdate);
        return;
      }

      // 6. Parse response and determine final state
      const responseText = response.text;
      console.info(`[RobotAgentExecutor] Prompt response: ${responseText}`);

      const lines = responseText.trim().split('\n');
      const finalStateLine = lines.at(-1)?.trim().toUpperCase();
      const agentReplyText = lines.slice(0, lines.length - 1).join('\n').trim();

      let finalA2AState: TaskState = 'unknown';

      if (finalStateLine === 'COMPLETED') {
        finalA2AState = 'completed';
      } else if (finalStateLine === 'AWAITING_USER_INPUT') {
        finalA2AState = 'input-required';
      } else {
        console.warn(
          `[RobotAgentExecutor] Unexpected final state line: ${finalStateLine}. Defaulting to 'completed'.`
        );
        finalA2AState = 'completed';
      }

      // 7. Publish final task status update
      const agentMessage: Message = {
        kind: 'message',
        role: 'agent',
        messageId: uuidv4(),
        parts: [{ kind: 'text', text: agentReplyText || 'Command executed.' }],
        taskId: taskId,
        contextId: contextId,
      };
      historyForGenkit.push(agentMessage);
      contexts.set(contextId, historyForGenkit);

      const finalUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: taskId,
        contextId: contextId,
        status: {
          state: finalA2AState,
          message: agentMessage,
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(finalUpdate);

      console.log(`[RobotAgentExecutor] Task ${taskId} finished with state: ${finalA2AState}`);
    } catch (error: any) {
      console.error(`[RobotAgentExecutor] Error processing task ${taskId}:`, error);
      const errorUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: taskId,
        contextId: contextId,
        status: {
          state: 'failed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: `Error: ${error.message}` }],
            taskId: taskId,
            contextId: contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(errorUpdate);
    }
  }
}
