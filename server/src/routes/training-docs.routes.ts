/**
 * @file training-docs.routes.ts
 * @description REST API endpoints for EU AI Act training data documentation
 * @feature compliance
 */

import { Router, Request, Response } from 'express';
import { trainingDataDocService } from '../services/TrainingDataDocService.js';
import type {
  UpsertProvenanceDto,
  GenerateSummaryDto,
  UpdateSummaryDto,
  CreateBiasAssessmentDto,
  UpdateBiasAssessmentDto,
  SummariesDueQuery,
  ExportFormat,
  DatasetSourceType,
} from '../types/training-docs.types.js';

export const trainingDocsRoutes = Router();

// ============================================================================
// PROVENANCE ENDPOINTS
// ============================================================================

/**
 * POST /api/training-docs/datasets/:id/provenance
 * Record or update dataset provenance
 */
trainingDocsRoutes.post(
  '/datasets/:id/provenance',
  async (req: Request, res: Response) => {
    try {
      const { id: datasetId } = req.params;
      const dto = req.body as UpsertProvenanceDto;
      // @ts-expect-error - user comes from auth middleware
      const userId = req.user?.id ?? 'system';

      // Validate required fields
      if (!dto.sourceType) {
        return res.status(400).json({ error: 'sourceType is required' });
      }

      const validSourceTypes: DatasetSourceType[] = [
        'collected',
        'purchased',
        'synthetic',
        'open_source',
        'contributed',
      ];
      if (!validSourceTypes.includes(dto.sourceType)) {
        return res.status(400).json({
          error: `Invalid sourceType. Must be one of: ${validSourceTypes.join(', ')}`,
        });
      }

      const provenance = await trainingDataDocService.recordProvenance(
        datasetId,
        dto,
        userId
      );

      res.json({
        provenance,
        message: 'Provenance recorded successfully',
      });
    } catch (error) {
      console.error('[TrainingDocsRoutes] Error recording provenance:', error);
      const message = error instanceof Error ? error.message : 'Failed to record provenance';
      res.status(400).json({ error: message });
    }
  }
);

/**
 * GET /api/training-docs/datasets/:id/provenance
 * Get dataset provenance
 */
trainingDocsRoutes.get(
  '/datasets/:id/provenance',
  async (req: Request, res: Response) => {
    try {
      const { id: datasetId } = req.params;

      const provenance = await trainingDataDocService.getProvenance(datasetId);
      if (!provenance) {
        return res.status(404).json({ error: 'Provenance not found' });
      }

      res.json({ provenance });
    } catch (error) {
      console.error('[TrainingDocsRoutes] Error getting provenance:', error);
      res.status(500).json({ error: 'Failed to get provenance' });
    }
  }
);

/**
 * GET /api/training-docs/provenance
 * List all provenance records
 */
trainingDocsRoutes.get('/provenance', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const sourceType = query.sourceType as DatasetSourceType | undefined;

    const records = await trainingDataDocService.listProvenance(sourceType);

    res.json({
      provenance: records,
      total: records.length,
    });
  } catch (error) {
    console.error('[TrainingDocsRoutes] Error listing provenance:', error);
    res.status(500).json({ error: 'Failed to list provenance' });
  }
});

// ============================================================================
// TRAINING DATA SUMMARY ENDPOINTS
// ============================================================================

/**
 * POST /api/training-docs/models/:id/summary
 * Generate training data summary for a model version
 */
trainingDocsRoutes.post(
  '/models/:id/summary',
  async (req: Request, res: Response) => {
    try {
      const { id: modelVersionId } = req.params;
      const dto = req.body as GenerateSummaryDto;
      // @ts-expect-error - user comes from auth middleware
      const userId = req.user?.id ?? 'system';

      // Validate required fields
      if (!Array.isArray(dto.datasetIds) || dto.datasetIds.length === 0) {
        return res.status(400).json({ error: 'datasetIds array is required' });
      }
      if (!dto.copyrightMeasures) {
        return res.status(400).json({ error: 'copyrightMeasures is required' });
      }
      if (!Array.isArray(dto.processingPurposes) || dto.processingPurposes.length === 0) {
        return res.status(400).json({ error: 'processingPurposes array is required' });
      }

      const summary = await trainingDataDocService.generateSummary(
        modelVersionId,
        dto,
        userId
      );

      res.status(201).json({
        summary,
        message: 'Training data summary generated successfully',
      });
    } catch (error) {
      console.error('[TrainingDocsRoutes] Error generating summary:', error);
      const message = error instanceof Error ? error.message : 'Failed to generate summary';
      res.status(400).json({ error: message });
    }
  }
);

/**
 * GET /api/training-docs/models/:id/summary
 * Get training data summary for a model version
 */
trainingDocsRoutes.get(
  '/models/:id/summary',
  async (req: Request, res: Response) => {
    try {
      const { id: modelVersionId } = req.params;

      const summary = await trainingDataDocService.getSummary(modelVersionId);
      if (!summary) {
        return res.status(404).json({ error: 'Summary not found' });
      }

      res.json({ summary });
    } catch (error) {
      console.error('[TrainingDocsRoutes] Error getting summary:', error);
      res.status(500).json({ error: 'Failed to get summary' });
    }
  }
);

/**
 * PUT /api/training-docs/models/:id/summary
 * Update training data summary
 */
trainingDocsRoutes.put(
  '/models/:id/summary',
  async (req: Request, res: Response) => {
    try {
      const { id: modelVersionId } = req.params;
      const dto = req.body as UpdateSummaryDto;

      const summary = await trainingDataDocService.updateSummary(modelVersionId, dto);

      res.json({
        summary,
        message: 'Summary updated successfully',
      });
    } catch (error) {
      console.error('[TrainingDocsRoutes] Error updating summary:', error);
      const message = error instanceof Error ? error.message : 'Failed to update summary';
      res.status(400).json({ error: message });
    }
  }
);

/**
 * GET /api/training-docs/models/:id/summary/export
 * Export training data documentation
 */
trainingDocsRoutes.get(
  '/models/:id/summary/export',
  async (req: Request, res: Response) => {
    try {
      const { id: modelVersionId } = req.params;
      const query = req.query as Record<string, string | undefined>;

      const format = (query.format ?? 'markdown') as ExportFormat;
      const includeProvenance = query.includeProvenance !== 'false';
      const includeBiasAssessment = query.includeBiasAssessment !== 'false';

      const document = await trainingDataDocService.exportDocumentation(
        modelVersionId,
        format,
        includeProvenance,
        includeBiasAssessment
      );

      // Set appropriate content type
      switch (format) {
        case 'json':
          res.setHeader('Content-Type', 'application/json');
          break;
        case 'markdown':
          res.setHeader('Content-Type', 'text/markdown');
          break;
        case 'pdf':
          res.setHeader('Content-Type', 'text/markdown'); // PDF not implemented
          break;
      }

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${document.filename}"`
      );

      res.send(document.content);
    } catch (error) {
      console.error('[TrainingDocsRoutes] Error exporting documentation:', error);
      const message = error instanceof Error ? error.message : 'Failed to export documentation';
      res.status(400).json({ error: message });
    }
  }
);

/**
 * GET /api/training-docs/updates-due
 * Get summaries that need to be updated
 */
trainingDocsRoutes.get('/updates-due', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const params: SummariesDueQuery = {
      daysAhead: query.daysAhead ? parseInt(query.daysAhead, 10) : undefined,
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    };

    const result = await trainingDataDocService.getSummariesDue(params);

    res.json(result);
  } catch (error) {
    console.error('[TrainingDocsRoutes] Error getting updates due:', error);
    res.status(500).json({ error: 'Failed to get updates due' });
  }
});

// ============================================================================
// BIAS ASSESSMENT ENDPOINTS
// ============================================================================

/**
 * POST /api/training-docs/models/:id/bias-assessment
 * Create bias assessment for a model version
 */
trainingDocsRoutes.post(
  '/models/:id/bias-assessment',
  async (req: Request, res: Response) => {
    try {
      const { id: modelVersionId } = req.params;
      const dto = req.body as CreateBiasAssessmentDto;
      // @ts-expect-error - user comes from auth middleware
      const userId = req.user?.id ?? 'system';

      // Validate required fields
      if (!dto.demographicCoverage || typeof dto.demographicCoverage !== 'object') {
        return res.status(400).json({ error: 'demographicCoverage object is required' });
      }
      if (!Array.isArray(dto.knownLimitations)) {
        return res.status(400).json({ error: 'knownLimitations array is required' });
      }
      if (!Array.isArray(dto.potentialBiasSources)) {
        return res.status(400).json({ error: 'potentialBiasSources array is required' });
      }
      if (!Array.isArray(dto.mitigationMeasures)) {
        return res.status(400).json({ error: 'mitigationMeasures array is required' });
      }

      const assessment = await trainingDataDocService.createBiasAssessment(
        modelVersionId,
        dto,
        userId
      );

      res.status(201).json({
        assessment,
        message: 'Bias assessment created successfully',
      });
    } catch (error) {
      console.error('[TrainingDocsRoutes] Error creating bias assessment:', error);
      const message = error instanceof Error ? error.message : 'Failed to create bias assessment';
      res.status(400).json({ error: message });
    }
  }
);

/**
 * GET /api/training-docs/models/:id/bias-assessment
 * Get latest bias assessment for a model version
 */
trainingDocsRoutes.get(
  '/models/:id/bias-assessment',
  async (req: Request, res: Response) => {
    try {
      const { id: modelVersionId } = req.params;

      const assessment = await trainingDataDocService.getBiasAssessment(modelVersionId);
      if (!assessment) {
        return res.status(404).json({ error: 'Bias assessment not found' });
      }

      res.json({ assessment });
    } catch (error) {
      console.error('[TrainingDocsRoutes] Error getting bias assessment:', error);
      res.status(500).json({ error: 'Failed to get bias assessment' });
    }
  }
);

/**
 * GET /api/training-docs/models/:id/bias-assessment/history
 * Get all bias assessments for a model version
 */
trainingDocsRoutes.get(
  '/models/:id/bias-assessment/history',
  async (req: Request, res: Response) => {
    try {
      const { id: modelVersionId } = req.params;

      const assessments = await trainingDataDocService.getBiasAssessmentHistory(
        modelVersionId
      );

      res.json({
        assessments,
        total: assessments.length,
      });
    } catch (error) {
      console.error('[TrainingDocsRoutes] Error getting bias assessment history:', error);
      res.status(500).json({ error: 'Failed to get bias assessment history' });
    }
  }
);

/**
 * PUT /api/training-docs/bias-assessments/:id
 * Update bias assessment
 */
trainingDocsRoutes.put(
  '/bias-assessments/:id',
  async (req: Request, res: Response) => {
    try {
      const { id: assessmentId } = req.params;
      const dto = req.body as UpdateBiasAssessmentDto;
      // @ts-expect-error - user comes from auth middleware
      const userId = req.user?.id ?? 'system';

      const assessment = await trainingDataDocService.updateBiasAssessment(
        assessmentId,
        dto,
        userId
      );

      res.json({
        assessment,
        message: 'Bias assessment updated successfully',
      });
    } catch (error) {
      console.error('[TrainingDocsRoutes] Error updating bias assessment:', error);
      const message = error instanceof Error ? error.message : 'Failed to update bias assessment';
      res.status(400).json({ error: message });
    }
  }
);
