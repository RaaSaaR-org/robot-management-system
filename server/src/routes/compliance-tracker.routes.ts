/**
 * @file compliance-tracker.routes.ts
 * @description REST API routes for compliance monitoring dashboard
 * @feature compliance
 *
 * Provides endpoints for:
 * - Dashboard statistics
 * - Regulatory deadlines
 * - Gap analysis
 * - Document expiry tracking
 * - Training compliance (DGUV)
 * - Inspection schedules (DGUV Vorschrift 3)
 * - Risk assessment tracking
 */

import { Router, type Request, type Response } from 'express';
import {
  complianceTrackerService,
  type RegulatoryFramework,
  type GapSeverity,
  type TrainingType,
  type InspectionType,
  type RiskAssessmentType,
} from '../services/ComplianceTrackerService.js';

export const complianceTrackerRoutes = Router();

// ============================================================================
// DASHBOARD
// ============================================================================

/**
 * GET /dashboard - Get overall dashboard statistics
 */
complianceTrackerRoutes.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const stats = await complianceTrackerService.getDashboardStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

// ============================================================================
// REGULATORY DEADLINES
// ============================================================================

/**
 * GET /deadlines - Get all regulatory deadlines
 */
complianceTrackerRoutes.get('/deadlines', async (_req: Request, res: Response) => {
  try {
    const deadlines = await complianceTrackerService.getRegulatoryDeadlines();
    res.json({ deadlines });
  } catch (error) {
    console.error('Error fetching deadlines:', error);
    res.status(500).json({ error: 'Failed to fetch regulatory deadlines' });
  }
});

/**
 * POST /deadlines - Create a new regulatory deadline
 */
complianceTrackerRoutes.post('/deadlines', async (req: Request, res: Response) => {
  try {
    const { framework, name, deadline, description, requirements, priority, notes } = req.body;

    if (!framework || !name || !deadline || !description || !requirements) {
      return res.status(400).json({
        error: 'Missing required fields: framework, name, deadline, description, requirements',
      });
    }

    const created = await complianceTrackerService.createRegulatoryDeadline({
      framework: framework as RegulatoryFramework,
      name,
      deadline: new Date(deadline),
      description,
      requirements,
      priority,
      notes,
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating deadline:', error);
    res.status(500).json({ error: 'Failed to create regulatory deadline' });
  }
});

/**
 * PUT /deadlines/:id/progress - Update deadline progress
 */
complianceTrackerRoutes.put('/deadlines/:id/progress', async (req: Request, res: Response) => {
  try {
    const { completedRequirements } = req.body;

    if (!Array.isArray(completedRequirements)) {
      return res.status(400).json({ error: 'completedRequirements must be an array' });
    }

    const updated = await complianceTrackerService.updateDeadlineProgress(
      req.params.id,
      completedRequirements,
    );

    res.json(updated);
  } catch (error) {
    console.error('Error updating deadline progress:', error);
    res.status(500).json({ error: 'Failed to update deadline progress' });
  }
});

// ============================================================================
// GAP ANALYSIS
// ============================================================================

/**
 * GET /gaps - Get compliance gaps
 * Query params:
 *   - framework: RegulatoryFramework (optional)
 *   - severity: GapSeverity (optional)
 *   - status: 'open' | 'closed' | 'in_progress' (optional)
 */
complianceTrackerRoutes.get('/gaps', async (req: Request, res: Response) => {
  try {
    const framework = req.query.framework as RegulatoryFramework | undefined;
    const severity = req.query.severity as GapSeverity | undefined;
    const status = req.query.status as 'open' | 'closed' | 'in_progress' | undefined;

    const gaps = await complianceTrackerService.getGaps({ framework, severity, status });
    res.json({ gaps });
  } catch (error) {
    console.error('Error fetching gaps:', error);
    res.status(500).json({ error: 'Failed to fetch compliance gaps' });
  }
});

/**
 * GET /gaps/summary - Get gap summary by framework
 */
complianceTrackerRoutes.get('/gaps/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await complianceTrackerService.getGapSummaryByFramework();
    res.json({ summary });
  } catch (error) {
    console.error('Error fetching gap summary:', error);
    res.status(500).json({ error: 'Failed to fetch gap summary' });
  }
});

/**
 * POST /gaps - Create a new compliance gap
 */
complianceTrackerRoutes.post('/gaps', async (req: Request, res: Response) => {
  try {
    const {
      framework,
      requirement,
      articleReference,
      severity,
      description,
      currentState,
      targetState,
      remediation,
      estimatedEffort,
      dueDate,
      assignedTo,
    } = req.body;

    if (
      !framework ||
      !requirement ||
      !articleReference ||
      !severity ||
      !description ||
      !currentState ||
      !targetState ||
      !remediation
    ) {
      return res.status(400).json({
        error:
          'Missing required fields: framework, requirement, articleReference, severity, description, currentState, targetState, remediation',
      });
    }

    const gap = await complianceTrackerService.createGap({
      framework: framework as RegulatoryFramework,
      requirement,
      articleReference,
      severity: severity as GapSeverity,
      description,
      currentState,
      targetState,
      remediation,
      estimatedEffort,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      assignedTo,
    });

    res.status(201).json(gap);
  } catch (error) {
    console.error('Error creating gap:', error);
    res.status(500).json({ error: 'Failed to create compliance gap' });
  }
});

/**
 * PUT /gaps/:id/close - Close a compliance gap
 */
complianceTrackerRoutes.put('/gaps/:id/close', async (req: Request, res: Response) => {
  try {
    const { closedBy } = req.body;

    if (!closedBy) {
      return res.status(400).json({ error: 'closedBy is required' });
    }

    const gap = await complianceTrackerService.closeGap(req.params.id, closedBy);
    res.json(gap);
  } catch (error) {
    console.error('Error closing gap:', error);
    res.status(500).json({ error: 'Failed to close compliance gap' });
  }
});

// ============================================================================
// DOCUMENT EXPIRY
// ============================================================================

/**
 * GET /documents/expiring - Get expiring documents
 * Query params:
 *   - withinDays: number (optional, default 30)
 */
complianceTrackerRoutes.get('/documents/expiring', async (req: Request, res: Response) => {
  try {
    const withinDays = parseInt(req.query.withinDays as string) || 30;
    const documents = await complianceTrackerService.getExpiringDocuments(withinDays);
    res.json({ documents });
  } catch (error) {
    console.error('Error fetching expiring documents:', error);
    res.status(500).json({ error: 'Failed to fetch expiring documents' });
  }
});

// ============================================================================
// TRAINING RECORDS (DGUV)
// ============================================================================

/**
 * GET /training - Get training records
 * Query params:
 *   - userId: string (optional)
 *   - trainingType: TrainingType (optional)
 *   - status: 'valid' | 'expiring_soon' | 'expired' (optional)
 */
complianceTrackerRoutes.get('/training', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string | undefined;
    const trainingType = req.query.trainingType as TrainingType | undefined;
    const status = req.query.status as 'valid' | 'expiring_soon' | 'expired' | undefined;

    const records = await complianceTrackerService.getTrainingRecords({
      userId,
      trainingType,
      status,
    });
    res.json({ records });
  } catch (error) {
    console.error('Error fetching training records:', error);
    res.status(500).json({ error: 'Failed to fetch training records' });
  }
});

/**
 * GET /training/summary - Get training compliance summary
 */
complianceTrackerRoutes.get('/training/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await complianceTrackerService.getTrainingSummary();
    res.json(summary);
  } catch (error) {
    console.error('Error fetching training summary:', error);
    res.status(500).json({ error: 'Failed to fetch training summary' });
  }
});

/**
 * POST /training - Create a new training record
 */
complianceTrackerRoutes.post('/training', async (req: Request, res: Response) => {
  try {
    const {
      userId,
      userName,
      userEmail,
      trainingType,
      completedAt,
      expiresAt,
      certificateUrl,
      trainingProvider,
      notes,
    } = req.body;

    if (!userId || !userName || !trainingType || !completedAt || !expiresAt) {
      return res.status(400).json({
        error: 'Missing required fields: userId, userName, trainingType, completedAt, expiresAt',
      });
    }

    const record = await complianceTrackerService.createTrainingRecord({
      userId,
      userName,
      userEmail,
      trainingType: trainingType as TrainingType,
      completedAt: new Date(completedAt),
      expiresAt: new Date(expiresAt),
      certificateUrl,
      trainingProvider,
      notes,
    });

    res.status(201).json(record);
  } catch (error) {
    console.error('Error creating training record:', error);
    res.status(500).json({ error: 'Failed to create training record' });
  }
});

// ============================================================================
// INSPECTION SCHEDULES (DGUV Vorschrift 3)
// ============================================================================

/**
 * GET /inspections - Get inspection schedules
 * Query params:
 *   - robotId: string (optional)
 *   - inspectionType: InspectionType (optional)
 *   - status: 'current' | 'due_soon' | 'overdue' (optional)
 */
complianceTrackerRoutes.get('/inspections', async (req: Request, res: Response) => {
  try {
    const robotId = req.query.robotId as string | undefined;
    const inspectionType = req.query.inspectionType as InspectionType | undefined;
    const status = req.query.status as 'current' | 'due_soon' | 'overdue' | undefined;

    const schedules = await complianceTrackerService.getInspectionSchedules({
      robotId,
      inspectionType,
      status,
    });
    res.json({ schedules });
  } catch (error) {
    console.error('Error fetching inspection schedules:', error);
    res.status(500).json({ error: 'Failed to fetch inspection schedules' });
  }
});

/**
 * GET /inspections/summary - Get inspection schedule summary
 */
complianceTrackerRoutes.get('/inspections/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await complianceTrackerService.getInspectionSummary();
    res.json(summary);
  } catch (error) {
    console.error('Error fetching inspection summary:', error);
    res.status(500).json({ error: 'Failed to fetch inspection summary' });
  }
});

/**
 * POST /inspections - Create a new inspection schedule
 */
complianceTrackerRoutes.post('/inspections', async (req: Request, res: Response) => {
  try {
    const {
      inspectionType,
      robotId,
      robotName,
      lastInspectionDate,
      nextDueDate,
      intervalYears,
      inspectorName,
      inspectorCompany,
      reportUrl,
      notes,
    } = req.body;

    if (!inspectionType || !lastInspectionDate || !nextDueDate || !intervalYears) {
      return res.status(400).json({
        error:
          'Missing required fields: inspectionType, lastInspectionDate, nextDueDate, intervalYears',
      });
    }

    const schedule = await complianceTrackerService.createInspectionSchedule({
      inspectionType: inspectionType as InspectionType,
      robotId,
      robotName,
      lastInspectionDate: new Date(lastInspectionDate),
      nextDueDate: new Date(nextDueDate),
      intervalYears,
      inspectorName,
      inspectorCompany,
      reportUrl,
      notes,
    });

    res.status(201).json(schedule);
  } catch (error) {
    console.error('Error creating inspection schedule:', error);
    res.status(500).json({ error: 'Failed to create inspection schedule' });
  }
});

/**
 * PUT /inspections/:id/complete - Record inspection completion
 */
complianceTrackerRoutes.put('/inspections/:id/complete', async (req: Request, res: Response) => {
  try {
    const { reportUrl, inspectorName } = req.body;

    const schedule = await complianceTrackerService.recordInspectionCompletion(
      req.params.id,
      reportUrl,
      inspectorName,
    );

    res.json(schedule);
  } catch (error) {
    console.error('Error completing inspection:', error);
    res.status(500).json({ error: 'Failed to record inspection completion' });
  }
});

// ============================================================================
// RISK ASSESSMENTS
// ============================================================================

/**
 * GET /risk-assessments - Get risk assessments
 * Query params:
 *   - assessmentType: RiskAssessmentType (optional)
 *   - status: 'current' | 'review_needed' | 'update_required' (optional)
 */
complianceTrackerRoutes.get('/risk-assessments', async (req: Request, res: Response) => {
  try {
    const assessmentType = req.query.assessmentType as RiskAssessmentType | undefined;
    const status = req.query.status as 'current' | 'review_needed' | 'update_required' | undefined;

    const assessments = await complianceTrackerService.getRiskAssessments({
      assessmentType,
      status,
    });
    res.json({ assessments });
  } catch (error) {
    console.error('Error fetching risk assessments:', error);
    res.status(500).json({ error: 'Failed to fetch risk assessments' });
  }
});

/**
 * POST /risk-assessments - Create a new risk assessment
 */
complianceTrackerRoutes.post('/risk-assessments', async (req: Request, res: Response) => {
  try {
    const {
      assessmentType,
      name,
      version,
      description,
      lastUpdated,
      nextReviewDate,
      triggerConditions,
      documentUrl,
      responsiblePerson,
    } = req.body;

    if (!assessmentType || !name || !version || !lastUpdated || !nextReviewDate) {
      return res.status(400).json({
        error:
          'Missing required fields: assessmentType, name, version, lastUpdated, nextReviewDate',
      });
    }

    const assessment = await complianceTrackerService.createRiskAssessment({
      assessmentType: assessmentType as RiskAssessmentType,
      name,
      version,
      description,
      lastUpdated: new Date(lastUpdated),
      nextReviewDate: new Date(nextReviewDate),
      triggerConditions,
      documentUrl,
      responsiblePerson,
    });

    res.status(201).json(assessment);
  } catch (error) {
    console.error('Error creating risk assessment:', error);
    res.status(500).json({ error: 'Failed to create risk assessment' });
  }
});

/**
 * PUT /risk-assessments/:id/update - Update a risk assessment version
 */
complianceTrackerRoutes.put('/risk-assessments/:id/update', async (req: Request, res: Response) => {
  try {
    const { newVersion, nextReviewDate, documentUrl } = req.body;

    if (!newVersion || !nextReviewDate) {
      return res.status(400).json({ error: 'newVersion and nextReviewDate are required' });
    }

    const assessment = await complianceTrackerService.updateRiskAssessment(
      req.params.id,
      newVersion,
      new Date(nextReviewDate),
      documentUrl,
    );

    res.json(assessment);
  } catch (error) {
    console.error('Error updating risk assessment:', error);
    res.status(500).json({ error: 'Failed to update risk assessment' });
  }
});

// ============================================================================
// ACTIVITY
// ============================================================================

/**
 * GET /activity - Get recent compliance activity
 * Query params:
 *   - limit: number (optional, default 20)
 */
complianceTrackerRoutes.get('/activity', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const activity = await complianceTrackerService.getRecentActivity(limit);
    res.json({ activity });
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({ error: 'Failed to fetch compliance activity' });
  }
});

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * POST /initialize - Initialize default regulatory deadlines
 */
complianceTrackerRoutes.post('/initialize', async (_req: Request, res: Response) => {
  try {
    await complianceTrackerService.initializeDefaults();
    res.json({ message: 'Default regulatory deadlines initialized' });
  } catch (error) {
    console.error('Error initializing defaults:', error);
    res.status(500).json({ error: 'Failed to initialize defaults' });
  }
});
