/**
 * @file provider-docs.routes.ts
 * @description REST API routes for AI provider documentation management
 * @feature compliance
 *
 * EU AI Act requires maintaining documentation from AI system providers.
 */

import { Router, type Request, type Response } from 'express';
import { providerDocumentationService } from '../services/ProviderDocumentationService.js';
import type { DocumentType } from '../types/retention.types.js';

export const providerDocsRoutes = Router();

/**
 * GET /providers - List all providers with summary
 */
providerDocsRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const providers = await providerDocumentationService.getAllProviders();
    res.json({ providers });
  } catch (error) {
    console.error('Error fetching providers:', error);
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
});

/**
 * GET /providers/docs - Get all documentation
 */
providerDocsRoutes.get('/docs', async (_req: Request, res: Response) => {
  try {
    const documentation = await providerDocumentationService.getAllDocumentation();
    res.json({ documentation });
  } catch (error) {
    console.error('Error fetching documentation:', error);
    res.status(500).json({ error: 'Failed to fetch documentation' });
  }
});

/**
 * GET /providers/docs/valid - Get currently valid documentation
 * Query params:
 *   - providerName: string (optional) - Filter by provider
 */
providerDocsRoutes.get('/docs/valid', async (req: Request, res: Response) => {
  try {
    const providerName = req.query.providerName as string | undefined;
    const documentation = await providerDocumentationService.getValidDocumentation(providerName);
    res.json({ documentation });
  } catch (error) {
    console.error('Error fetching valid documentation:', error);
    res.status(500).json({ error: 'Failed to fetch valid documentation' });
  }
});

/**
 * GET /providers/docs/:id - Get specific documentation by ID
 */
providerDocsRoutes.get('/docs/:id', async (req: Request, res: Response) => {
  try {
    const doc = await providerDocumentationService.getDocumentation(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Documentation not found' });
    }

    res.json(doc);
  } catch (error) {
    console.error('Error fetching documentation:', error);
    res.status(500).json({ error: 'Failed to fetch documentation' });
  }
});

/**
 * GET /providers/:providerName/docs - Get all documentation for a provider
 */
providerDocsRoutes.get('/:providerName/docs', async (req: Request, res: Response) => {
  try {
    const documentation = await providerDocumentationService.getDocumentationByProvider(
      req.params.providerName,
    );
    res.json({ documentation });
  } catch (error) {
    console.error('Error fetching provider documentation:', error);
    res.status(500).json({ error: 'Failed to fetch provider documentation' });
  }
});

/**
 * GET /providers/:providerName/:modelVersion/docs - Get documentation for specific model
 */
providerDocsRoutes.get('/:providerName/:modelVersion/docs', async (req: Request, res: Response) => {
  try {
    const documentation = await providerDocumentationService.getDocumentationByModel(
      req.params.providerName,
      req.params.modelVersion,
    );
    res.json({ documentation });
  } catch (error) {
    console.error('Error fetching model documentation:', error);
    res.status(500).json({ error: 'Failed to fetch model documentation' });
  }
});

/**
 * POST /providers/docs - Add new documentation
 * Body:
 *   - providerName: string (required)
 *   - modelVersion: string (required)
 *   - documentType: string (required) - 'technical_doc' | 'risk_assessment' | 'conformity_declaration' | 'user_manual' | 'training_data_description' | 'model_card'
 *   - documentUrl: string (optional)
 *   - content: string (required)
 *   - validFrom: string (required) - ISO date string
 *   - validTo: string (optional) - ISO date string
 */
providerDocsRoutes.post('/docs', async (req: Request, res: Response) => {
  try {
    const { providerName, modelVersion, documentType, documentUrl, content, validFrom, validTo } =
      req.body;

    // Validation
    if (!providerName || !modelVersion || !documentType || !content || !validFrom) {
      return res.status(400).json({
        error:
          'Missing required fields: providerName, modelVersion, documentType, content, validFrom',
      });
    }

    const validDocTypes = [
      'technical_doc',
      'risk_assessment',
      'conformity_declaration',
      'user_manual',
      'training_data_description',
      'model_card',
    ];
    if (!validDocTypes.includes(documentType)) {
      return res.status(400).json({
        error: `Invalid documentType. Must be one of: ${validDocTypes.join(', ')}`,
      });
    }

    const doc = await providerDocumentationService.addDocumentation({
      providerName,
      modelVersion,
      documentType: documentType as DocumentType,
      documentUrl,
      content,
      validFrom: new Date(validFrom),
      validTo: validTo ? new Date(validTo) : undefined,
    });

    res.status(201).json(doc);
  } catch (error) {
    console.error('Error adding documentation:', error);
    res.status(500).json({ error: 'Failed to add documentation' });
  }
});

/**
 * PUT /providers/docs/:id - Update documentation
 * Body: Partial documentation fields
 */
providerDocsRoutes.put('/docs/:id', async (req: Request, res: Response) => {
  try {
    const { providerName, modelVersion, documentType, documentUrl, content, validFrom, validTo } =
      req.body;

    // Validate documentType if provided
    if (documentType) {
      const validDocTypes = [
        'technical_doc',
        'risk_assessment',
        'conformity_declaration',
        'user_manual',
        'training_data_description',
        'model_card',
      ];
      if (!validDocTypes.includes(documentType)) {
        return res.status(400).json({
          error: `Invalid documentType. Must be one of: ${validDocTypes.join(', ')}`,
        });
      }
    }

    const doc = await providerDocumentationService.updateDocumentation(req.params.id, {
      providerName,
      modelVersion,
      documentType: documentType as DocumentType | undefined,
      documentUrl,
      content,
      validFrom: validFrom ? new Date(validFrom) : undefined,
      validTo: validTo ? new Date(validTo) : undefined,
    });

    if (!doc) {
      return res.status(404).json({ error: 'Documentation not found' });
    }

    res.json(doc);
  } catch (error) {
    console.error('Error updating documentation:', error);
    res.status(500).json({ error: 'Failed to update documentation' });
  }
});

/**
 * DELETE /providers/docs/:id - Delete documentation
 */
providerDocsRoutes.delete('/docs/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await providerDocumentationService.deleteDocumentation(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Documentation not found' });
    }

    res.json({ message: 'Documentation deleted successfully' });
  } catch (error) {
    console.error('Error deleting documentation:', error);
    res.status(500).json({ error: 'Failed to delete documentation' });
  }
});
