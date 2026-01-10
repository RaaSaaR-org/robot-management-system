/**
 * @file ProviderDocumentationService.ts
 * @description Service for managing AI provider documentation
 * @feature compliance
 *
 * EU AI Act requires maintaining documentation from AI system providers.
 * This service tracks technical docs, risk assessments, and conformity declarations.
 */

import { prisma } from '../database/index.js';
import type {
  ProviderDocumentation,
  ProviderDocInput,
  ProviderSummary,
} from '../types/retention.types.js';

export class ProviderDocumentationService {
  constructor() {
    console.log('[ProviderDocumentationService] Initialized');
  }

  /**
   * Add new provider documentation
   */
  async addDocumentation(input: ProviderDocInput): Promise<ProviderDocumentation> {
    const doc = await prisma.providerDocumentation.create({
      data: {
        providerName: input.providerName,
        modelVersion: input.modelVersion,
        documentType: input.documentType,
        documentUrl: input.documentUrl,
        content: input.content,
        validFrom: input.validFrom,
        validTo: input.validTo,
      },
    });

    console.log(
      `[ProviderDocumentationService] Added ${input.documentType} for ${input.providerName} ${input.modelVersion}`,
    );

    return {
      id: doc.id,
      providerName: doc.providerName,
      modelVersion: doc.modelVersion,
      documentType: doc.documentType,
      documentUrl: doc.documentUrl,
      content: doc.content,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * Update existing documentation
   */
  async updateDocumentation(
    id: string,
    input: Partial<ProviderDocInput>,
  ): Promise<ProviderDocumentation | null> {
    try {
      const doc = await prisma.providerDocumentation.update({
        where: { id },
        data: {
          ...(input.providerName && { providerName: input.providerName }),
          ...(input.modelVersion && { modelVersion: input.modelVersion }),
          ...(input.documentType && { documentType: input.documentType }),
          ...(input.documentUrl !== undefined && { documentUrl: input.documentUrl }),
          ...(input.content && { content: input.content }),
          ...(input.validFrom && { validFrom: input.validFrom }),
          ...(input.validTo !== undefined && { validTo: input.validTo }),
        },
      });

      return {
        id: doc.id,
        providerName: doc.providerName,
        modelVersion: doc.modelVersion,
        documentType: doc.documentType,
        documentUrl: doc.documentUrl,
        content: doc.content,
        validFrom: doc.validFrom,
        validTo: doc.validTo,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get documentation by ID
   */
  async getDocumentation(id: string): Promise<ProviderDocumentation | null> {
    const doc = await prisma.providerDocumentation.findUnique({
      where: { id },
    });

    if (!doc) return null;

    return {
      id: doc.id,
      providerName: doc.providerName,
      modelVersion: doc.modelVersion,
      documentType: doc.documentType,
      documentUrl: doc.documentUrl,
      content: doc.content,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * Get all documentation for a specific provider
   */
  async getDocumentationByProvider(providerName: string): Promise<ProviderDocumentation[]> {
    const docs = await prisma.providerDocumentation.findMany({
      where: { providerName },
      orderBy: [{ modelVersion: 'desc' }, { documentType: 'asc' }],
    });

    return docs.map((doc) => ({
      id: doc.id,
      providerName: doc.providerName,
      modelVersion: doc.modelVersion,
      documentType: doc.documentType,
      documentUrl: doc.documentUrl,
      content: doc.content,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  }

  /**
   * Get documentation for a specific model version
   */
  async getDocumentationByModel(
    providerName: string,
    modelVersion: string,
  ): Promise<ProviderDocumentation[]> {
    const docs = await prisma.providerDocumentation.findMany({
      where: { providerName, modelVersion },
      orderBy: { documentType: 'asc' },
    });

    return docs.map((doc) => ({
      id: doc.id,
      providerName: doc.providerName,
      modelVersion: doc.modelVersion,
      documentType: doc.documentType,
      documentUrl: doc.documentUrl,
      content: doc.content,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  }

  /**
   * Get all documentation
   */
  async getAllDocumentation(): Promise<ProviderDocumentation[]> {
    const docs = await prisma.providerDocumentation.findMany({
      orderBy: [{ providerName: 'asc' }, { modelVersion: 'desc' }, { documentType: 'asc' }],
    });

    return docs.map((doc) => ({
      id: doc.id,
      providerName: doc.providerName,
      modelVersion: doc.modelVersion,
      documentType: doc.documentType,
      documentUrl: doc.documentUrl,
      content: doc.content,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  }

  /**
   * Get summary of all providers
   */
  async getAllProviders(): Promise<ProviderSummary[]> {
    const docs = await prisma.providerDocumentation.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    // Group by provider
    const providerMap = new Map<
      string,
      { versions: Set<string>; count: number; lastUpdated: Date }
    >();

    for (const doc of docs) {
      const existing = providerMap.get(doc.providerName);
      if (existing) {
        existing.versions.add(doc.modelVersion);
        existing.count++;
        if (doc.updatedAt > existing.lastUpdated) {
          existing.lastUpdated = doc.updatedAt;
        }
      } else {
        providerMap.set(doc.providerName, {
          versions: new Set([doc.modelVersion]),
          count: 1,
          lastUpdated: doc.updatedAt,
        });
      }
    }

    return Array.from(providerMap.entries()).map(([providerName, data]) => ({
      providerName,
      modelVersions: Array.from(data.versions),
      documentCount: data.count,
      lastUpdated: data.lastUpdated,
    }));
  }

  /**
   * Delete documentation
   */
  async deleteDocumentation(id: string): Promise<boolean> {
    try {
      await prisma.providerDocumentation.delete({
        where: { id },
      });
      console.log(`[ProviderDocumentationService] Deleted documentation: ${id}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get currently valid documentation (validTo is null or in future)
   */
  async getValidDocumentation(providerName?: string): Promise<ProviderDocumentation[]> {
    const now = new Date();
    const docs = await prisma.providerDocumentation.findMany({
      where: {
        ...(providerName && { providerName }),
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      orderBy: [{ providerName: 'asc' }, { modelVersion: 'desc' }],
    });

    return docs.map((doc) => ({
      id: doc.id,
      providerName: doc.providerName,
      modelVersion: doc.modelVersion,
      documentType: doc.documentType,
      documentUrl: doc.documentUrl,
      content: doc.content,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  }

  /**
   * Initialize default documentation entries
   */
  async initializeDefaults(): Promise<void> {
    const existingCount = await prisma.providerDocumentation.count();
    if (existingCount > 0) {
      console.log(
        '[ProviderDocumentationService] Documentation already exists, skipping initialization',
      );
      return;
    }

    const defaultDocs: ProviderDocInput[] = [
      {
        providerName: 'Google Gemini',
        modelVersion: 'gemini-2.0-flash',
        documentType: 'technical_doc',
        documentUrl: 'https://ai.google.dev/gemini-api/docs',
        content: `Google Gemini 2.0 Flash is a multimodal AI model designed for fast, efficient inference.

Key capabilities:
- Text generation and understanding
- Image and video analysis
- Code generation and explanation
- Multilingual support

Safety features:
- Content filtering
- Harm reduction training
- Prompt injection defenses`,
        validFrom: new Date('2024-01-01'),
      },
      {
        providerName: 'Google Gemini',
        modelVersion: 'gemini-2.0-flash',
        documentType: 'model_card',
        documentUrl: 'https://ai.google.dev/gemini-api/docs/models',
        content: `Model Card: Gemini 2.0 Flash

Model Details:
- Type: Large Language Model (LLM)
- Architecture: Transformer-based multimodal
- Training: Supervised learning with RLHF
- Context window: 1M tokens

Intended Use:
- Command interpretation for robotics
- Natural language understanding
- Task planning and reasoning

Limitations:
- May generate incorrect information
- Should not be used for safety-critical decisions without human oversight
- Performance varies by language and domain`,
        validFrom: new Date('2024-01-01'),
      },
    ];

    for (const doc of defaultDocs) {
      await this.addDocumentation(doc);
    }

    console.log('[ProviderDocumentationService] Default documentation initialized');
  }
}

// Export singleton instance
export const providerDocumentationService = new ProviderDocumentationService();
