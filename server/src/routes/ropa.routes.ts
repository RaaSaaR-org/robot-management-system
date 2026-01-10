/**
 * @file ropa.routes.ts
 * @description REST API routes for Records of Processing Activities (RoPA)
 * @feature compliance
 *
 * GDPR Article 30 requires maintaining records of processing activities.
 */

import { Router, type Request, type Response } from 'express';
import { ropaService } from '../services/RopaService.js';

export const ropaRoutes = Router();

/**
 * GET /ropa - List all RoPA entries
 */
ropaRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const entries = await ropaService.getAllEntries();
    res.json({ entries });
  } catch (error) {
    console.error('Error fetching RoPA entries:', error);
    res.status(500).json({ error: 'Failed to fetch RoPA entries' });
  }
});

/**
 * GET /ropa/report - Generate RoPA report for regulatory submission
 * Query params:
 *   - organizationName: string (optional, default: 'RoboMindOS')
 */
ropaRoutes.get('/report', async (req: Request, res: Response) => {
  try {
    const organizationName = (req.query.organizationName as string) || 'RoboMindOS';
    const report = await ropaService.generateReport(organizationName);

    // Set headers for download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ropa-report-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    res.json(report);
  } catch (error) {
    console.error('Error generating RoPA report:', error);
    res.status(500).json({ error: 'Failed to generate RoPA report' });
  }
});

/**
 * GET /ropa/:id - Get a specific RoPA entry
 */
ropaRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const entry = await ropaService.getEntry(req.params.id);

    if (!entry) {
      return res.status(404).json({ error: 'RoPA entry not found' });
    }

    res.json(entry);
  } catch (error) {
    console.error('Error fetching RoPA entry:', error);
    res.status(500).json({ error: 'Failed to fetch RoPA entry' });
  }
});

/**
 * POST /ropa - Create a new RoPA entry
 * Body:
 *   - processingActivity: string (required)
 *   - purpose: string (required)
 *   - dataCategories: string[] (required)
 *   - dataSubjects: string[] (required)
 *   - recipients: string[] (required)
 *   - thirdCountryTransfers: string (optional)
 *   - retentionPeriod: string (required)
 *   - securityMeasures: string[] (required)
 *   - legalBasis: string (required)
 */
ropaRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const {
      processingActivity,
      purpose,
      dataCategories,
      dataSubjects,
      recipients,
      thirdCountryTransfers,
      retentionPeriod,
      securityMeasures,
      legalBasis,
    } = req.body;

    // Validation
    if (
      !processingActivity ||
      !purpose ||
      !dataCategories ||
      !dataSubjects ||
      !recipients ||
      !retentionPeriod ||
      !securityMeasures ||
      !legalBasis
    ) {
      return res.status(400).json({
        error:
          'Missing required fields: processingActivity, purpose, dataCategories, dataSubjects, recipients, retentionPeriod, securityMeasures, legalBasis',
      });
    }

    if (
      !Array.isArray(dataCategories) ||
      !Array.isArray(dataSubjects) ||
      !Array.isArray(recipients) ||
      !Array.isArray(securityMeasures)
    ) {
      return res.status(400).json({
        error: 'dataCategories, dataSubjects, recipients, and securityMeasures must be arrays',
      });
    }

    const entry = await ropaService.createEntry({
      processingActivity,
      purpose,
      dataCategories,
      dataSubjects,
      recipients,
      thirdCountryTransfers,
      retentionPeriod,
      securityMeasures,
      legalBasis,
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error('Error creating RoPA entry:', error);
    res.status(500).json({ error: 'Failed to create RoPA entry' });
  }
});

/**
 * PUT /ropa/:id - Update a RoPA entry
 * Body: Partial RoPA entry fields
 */
ropaRoutes.put('/:id', async (req: Request, res: Response) => {
  try {
    const {
      processingActivity,
      purpose,
      dataCategories,
      dataSubjects,
      recipients,
      thirdCountryTransfers,
      retentionPeriod,
      securityMeasures,
      legalBasis,
    } = req.body;

    // Validate arrays if provided
    if (dataCategories && !Array.isArray(dataCategories)) {
      return res.status(400).json({ error: 'dataCategories must be an array' });
    }
    if (dataSubjects && !Array.isArray(dataSubjects)) {
      return res.status(400).json({ error: 'dataSubjects must be an array' });
    }
    if (recipients && !Array.isArray(recipients)) {
      return res.status(400).json({ error: 'recipients must be an array' });
    }
    if (securityMeasures && !Array.isArray(securityMeasures)) {
      return res.status(400).json({ error: 'securityMeasures must be an array' });
    }

    const entry = await ropaService.updateEntry(req.params.id, {
      processingActivity,
      purpose,
      dataCategories,
      dataSubjects,
      recipients,
      thirdCountryTransfers,
      retentionPeriod,
      securityMeasures,
      legalBasis,
    });

    if (!entry) {
      return res.status(404).json({ error: 'RoPA entry not found' });
    }

    res.json(entry);
  } catch (error) {
    console.error('Error updating RoPA entry:', error);
    res.status(500).json({ error: 'Failed to update RoPA entry' });
  }
});

/**
 * DELETE /ropa/:id - Delete a RoPA entry
 */
ropaRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await ropaService.deleteEntry(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'RoPA entry not found' });
    }

    res.json({ message: 'RoPA entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting RoPA entry:', error);
    res.status(500).json({ error: 'Failed to delete RoPA entry' });
  }
});
