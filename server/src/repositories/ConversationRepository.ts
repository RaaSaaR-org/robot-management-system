/**
 * @file ConversationRepository.ts
 * @description Data access layer for Conversation entities
 */

import { prisma } from '../database/index.js';
import {
  dbConversationToDomain,
  dbMessageToDomain,
  domainMessageToDb,
} from '../database/types.js';
import type { A2AConversation, A2AMessage } from '../types/index.js';

export class ConversationRepository {
  /**
   * Find a conversation by ID
   */
  async findById(id: string, includeMessages = true): Promise<A2AConversation | null> {
    const conversation = await prisma.conversation.findUnique({
      where: { id, deletedAt: null },
      include: {
        messages: includeMessages ? { orderBy: { timestamp: 'asc' } } : false,
        tasks: true,
      },
    });
    return conversation ? dbConversationToDomain(conversation) : null;
  }

  /**
   * Find all conversations (not deleted)
   */
  async findAll(): Promise<A2AConversation[]> {
    const conversations = await prisma.conversation.findMany({
      where: { deletedAt: null },
      include: {
        messages: { orderBy: { timestamp: 'asc' } },
        tasks: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return conversations.map(dbConversationToDomain);
  }

  /**
   * Find conversations by robot ID
   */
  async findByRobotId(robotId: string): Promise<A2AConversation[]> {
    const conversations = await prisma.conversation.findMany({
      where: { robotId, deletedAt: null },
      include: {
        messages: { orderBy: { timestamp: 'asc' } },
        tasks: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return conversations.map(dbConversationToDomain);
  }

  /**
   * Create a new conversation
   */
  async create(data: { robotId?: string; name: string }): Promise<A2AConversation> {
    const conversation = await prisma.conversation.create({
      data: {
        name: data.name,
        robotId: data.robotId,
        isActive: true,
      },
      include: {
        messages: true,
        tasks: true,
      },
    });
    return dbConversationToDomain(conversation);
  }

  /**
   * Delete a conversation (soft delete)
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.conversation.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update conversation
   */
  async update(id: string, data: Partial<{ name: string; isActive: boolean }>): Promise<boolean> {
    try {
      await prisma.conversation.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(conversationId: string, message: A2AMessage): Promise<A2AMessage> {
    const messageData = domainMessageToDb(message, conversationId);

    const dbMessage = await prisma.message.create({
      data: messageData,
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return dbMessageToDomain(dbMessage);
  }

  /**
   * Get all messages for a conversation
   */
  async getMessages(conversationId: string): Promise<A2AMessage[]> {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'asc' },
    });
    return messages.map(dbMessageToDomain);
  }

  /**
   * Get the count of conversations
   */
  async count(): Promise<number> {
    return prisma.conversation.count({
      where: { deletedAt: null },
    });
  }

}

export const conversationRepository = new ConversationRepository();
