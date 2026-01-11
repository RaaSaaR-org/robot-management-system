/**
 * @file incident.routes.ts
 * @description REST API routes for incident reporting and management
 * @feature incidents
 */

import { Router, type Request, type Response } from 'express';
import { incidentService } from '../services/IncidentService.js';
import { breachAssessmentService } from '../services/BreachAssessmentService.js';
import { notificationWorkflowService } from '../services/NotificationWorkflowService.js';
import type {
  IncidentType,
  IncidentSeverity,
  IncidentStatus,
} from '../types/incident.types.js';

export const incidentRoutes = Router();

// ============================================================================
// INCIDENT CRUD
// ============================================================================

/**
 * GET / - List incidents with optional filters and pagination
 * Query params:
 *   - type: IncidentType | IncidentType[] (comma-separated)
 *   - severity: IncidentSeverity | IncidentSeverity[] (comma-separated)
 *   - status: IncidentStatus | IncidentStatus[] (comma-separated)
 *   - robotId: string
 *   - startDate: ISO date string
 *   - endDate: ISO date string
 *   - page: number (default: 1)
 *   - limit: number (default: 20)
 *   - sortBy: 'detectedAt' | 'severity' | 'status' | 'updatedAt'
 *   - sortOrder: 'asc' | 'desc'
 */
incidentRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const {
      type,
      severity,
      status,
      robotId,
      startDate,
      endDate,
      page,
      limit,
      sortBy,
      sortOrder,
    } = req.query;

    const params: {
      type?: IncidentType | IncidentType[];
      severity?: IncidentSeverity | IncidentSeverity[];
      status?: IncidentStatus | IncidentStatus[];
      robotId?: string;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      limit?: number;
      sortBy?: 'detectedAt' | 'severity' | 'status' | 'updatedAt';
      sortOrder?: 'asc' | 'desc';
    } = {};

    if (type) {
      const types = (type as string).split(',') as IncidentType[];
      params.type = types.length === 1 ? types[0] : types;
    }

    if (severity) {
      const severities = (severity as string).split(',') as IncidentSeverity[];
      params.severity = severities.length === 1 ? severities[0] : severities;
    }

    if (status) {
      const statuses = (status as string).split(',') as IncidentStatus[];
      params.status = statuses.length === 1 ? statuses[0] : statuses;
    }

    if (robotId) {
      params.robotId = robotId as string;
    }

    if (startDate) {
      params.startDate = new Date(startDate as string);
    }

    if (endDate) {
      params.endDate = new Date(endDate as string);
    }

    if (page) {
      params.page = parseInt(page as string, 10);
    }

    if (limit) {
      params.limit = parseInt(limit as string, 10);
    }

    if (sortBy) {
      params.sortBy = sortBy as 'detectedAt' | 'severity' | 'status' | 'updatedAt';
    }

    if (sortOrder) {
      params.sortOrder = sortOrder as 'asc' | 'desc';
    }

    const result = await incidentService.listIncidents(params);
    res.json(result);
  } catch (error) {
    console.error('Error listing incidents:', error);
    res.status(500).json({ error: 'Failed to list incidents' });
  }
});

/**
 * GET /dashboard - Get incident dashboard statistics
 */
incidentRoutes.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const stats = await incidentService.getDashboardStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

/**
 * GET /open - Get open (not closed) incidents
 */
incidentRoutes.get('/open', async (_req: Request, res: Response) => {
  try {
    const incidents = await incidentService.getOpenIncidents();
    res.json({ incidents });
  } catch (error) {
    console.error('Error getting open incidents:', error);
    res.status(500).json({ error: 'Failed to get open incidents' });
  }
});

/**
 * GET /overdue - Get overdue notifications
 */
incidentRoutes.get('/overdue', async (_req: Request, res: Response) => {
  try {
    const notifications = await incidentService.getOverdueNotifications();
    res.json({ notifications });
  } catch (error) {
    console.error('Error getting overdue notifications:', error);
    res.status(500).json({ error: 'Failed to get overdue notifications' });
  }
});

/**
 * GET /:id - Get a single incident by ID
 */
incidentRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const incident = await incidentService.getIncident(req.params.id);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json(incident);
  } catch (error) {
    console.error('Error getting incident:', error);
    res.status(500).json({ error: 'Failed to get incident' });
  }
});

/**
 * POST / - Create a new incident manually
 * Body: CreateIncidentInput
 */
incidentRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const { type, severity, title, description, robotId, detectedAt } = req.body;

    if (!type || !title || !description) {
      return res.status(400).json({
        error: 'Missing required fields: type, title, description',
      });
    }

    const validTypes = ['safety', 'security', 'data_breach', 'ai_malfunction', 'vulnerability'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    // Get user ID from auth if available
    const userId = (req as Request & { user?: { id: string } }).user?.id;

    const incident = await incidentService.createIncident({
      type,
      severity,
      title,
      description,
      robotId,
      detectedAt: detectedAt ? new Date(detectedAt) : undefined,
      createdBy: userId,
    });

    // Capture system snapshot
    await incidentService.captureSystemSnapshot(incident.id);

    // Create notification workflow
    await notificationWorkflowService.createNotificationWorkflow(incident.id);

    // Reload incident with notifications
    const fullIncident = await incidentService.getIncident(incident.id);

    res.status(201).json(fullIncident);
  } catch (error) {
    console.error('Error creating incident:', error);
    res.status(500).json({ error: 'Failed to create incident' });
  }
});

/**
 * PATCH /:id - Update an incident
 * Body: UpdateIncidentInput
 */
incidentRoutes.patch('/:id', async (req: Request, res: Response) => {
  try {
    const {
      status,
      severity,
      title,
      description,
      rootCause,
      resolution,
      riskScore,
      affectedDataSubjects,
      dataCategories,
    } = req.body;

    // Build update object with only provided fields
    const update: Record<string, unknown> = {};
    if (status !== undefined) update.status = status;
    if (severity !== undefined) update.severity = severity;
    if (title !== undefined) update.title = title;
    if (description !== undefined) update.description = description;
    if (rootCause !== undefined) update.rootCause = rootCause;
    if (resolution !== undefined) update.resolution = resolution;
    if (riskScore !== undefined) update.riskScore = riskScore;
    if (affectedDataSubjects !== undefined) update.affectedDataSubjects = affectedDataSubjects;
    if (dataCategories !== undefined) update.dataCategories = dataCategories;

    // Set timestamp based on status change
    if (status === 'contained') update.containedAt = new Date();
    if (status === 'resolved') update.resolvedAt = new Date();
    if (status === 'closed') update.closedAt = new Date();

    const incident = await incidentService.updateIncident(req.params.id, update);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json(incident);
  } catch (error) {
    console.error('Error updating incident:', error);
    res.status(500).json({ error: 'Failed to update incident' });
  }
});

/**
 * DELETE /:id - Delete an incident
 */
incidentRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await incidentService.deleteIncident(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting incident:', error);
    res.status(500).json({ error: 'Failed to delete incident' });
  }
});

// ============================================================================
// NOTIFICATIONS
// ============================================================================

/**
 * GET /:id/notifications - Get notification timeline for an incident
 */
incidentRoutes.get('/:id/notifications', async (req: Request, res: Response) => {
  try {
    const timeline = await notificationWorkflowService.getNotificationTimeline(req.params.id);

    if (!timeline) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json(timeline);
  } catch (error) {
    console.error('Error getting notification timeline:', error);
    res.status(500).json({ error: 'Failed to get notification timeline' });
  }
});

/**
 * POST /:id/notifications - Create notification workflow for an incident
 */
incidentRoutes.post('/:id/notifications', async (req: Request, res: Response) => {
  try {
    const notifications = await notificationWorkflowService.createNotificationWorkflow(
      req.params.id
    );
    res.status(201).json({ notifications });
  } catch (error) {
    console.error('Error creating notification workflow:', error);
    res.status(500).json({ error: 'Failed to create notification workflow' });
  }
});

/**
 * POST /:id/notifications/:notificationId/send - Mark notification as sent
 */
incidentRoutes.post(
  '/:id/notifications/:notificationId/send',
  async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;

      const notification = await notificationWorkflowService.markNotificationSent(
        req.params.notificationId,
        userId
      );

      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      res.json(notification);
    } catch (error) {
      console.error('Error marking notification as sent:', error);
      res.status(500).json({ error: 'Failed to mark notification as sent' });
    }
  }
);

/**
 * POST /:id/notifications/:notificationId/generate - Generate content from template
 */
incidentRoutes.post(
  '/:id/notifications/:notificationId/generate',
  async (req: Request, res: Response) => {
    try {
      const { templateId } = req.body;

      const content = await notificationWorkflowService.generateNotificationContent(
        req.params.notificationId,
        templateId
      );

      if (!content) {
        return res.status(404).json({ error: 'Notification or template not found' });
      }

      res.json({ content });
    } catch (error) {
      console.error('Error generating notification content:', error);
      res.status(500).json({ error: 'Failed to generate notification content' });
    }
  }
);

/**
 * PATCH /:id/notifications/:notificationId - Update notification content
 */
incidentRoutes.patch(
  '/:id/notifications/:notificationId',
  async (req: Request, res: Response) => {
    try {
      const { content } = req.body;

      if (!content) {
        return res.status(400).json({ error: 'Content is required' });
      }

      const notification = await notificationWorkflowService.updateNotificationContent(
        req.params.notificationId,
        content
      );

      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      res.json(notification);
    } catch (error) {
      console.error('Error updating notification:', error);
      res.status(500).json({ error: 'Failed to update notification' });
    }
  }
);

// ============================================================================
// RISK ASSESSMENT
// ============================================================================

/**
 * POST /:id/assess - Assess risk for an incident
 */
incidentRoutes.post('/:id/assess', async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;

    const assessment = await breachAssessmentService.assessRisk(req.params.id, userId);
    res.json(assessment);
  } catch (error) {
    console.error('Error assessing risk:', error);
    res.status(500).json({ error: 'Failed to assess risk' });
  }
});

/**
 * GET /risk-matrix - Get the risk matrix reference
 */
incidentRoutes.get('/risk-matrix', async (_req: Request, res: Response) => {
  try {
    const matrix = breachAssessmentService.getRiskMatrix();
    res.json({ matrix });
  } catch (error) {
    console.error('Error getting risk matrix:', error);
    res.status(500).json({ error: 'Failed to get risk matrix' });
  }
});

// ============================================================================
// EVIDENCE
// ============================================================================

/**
 * GET /:id/evidence - Get linked evidence for an incident
 */
incidentRoutes.get('/:id/evidence', async (req: Request, res: Response) => {
  try {
    const incident = await incidentService.getIncident(req.params.id);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json({
      complianceLogIds: incident.complianceLogIds,
      alertIds: incident.alertIds,
      systemSnapshot: incident.systemSnapshot,
    });
  } catch (error) {
    console.error('Error getting evidence:', error);
    res.status(500).json({ error: 'Failed to get evidence' });
  }
});

/**
 * POST /:id/evidence - Link evidence to an incident
 */
incidentRoutes.post('/:id/evidence', async (req: Request, res: Response) => {
  try {
    const { complianceLogIds, alertIds } = req.body;

    const incident = await incidentService.linkEvidence(
      req.params.id,
      complianceLogIds,
      alertIds
    );

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json(incident);
  } catch (error) {
    console.error('Error linking evidence:', error);
    res.status(500).json({ error: 'Failed to link evidence' });
  }
});

/**
 * POST /:id/snapshot - Capture system snapshot
 */
incidentRoutes.post('/:id/snapshot', async (req: Request, res: Response) => {
  try {
    const incident = await incidentService.captureSystemSnapshot(req.params.id);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json(incident);
  } catch (error) {
    console.error('Error capturing snapshot:', error);
    res.status(500).json({ error: 'Failed to capture snapshot' });
  }
});

// ============================================================================
// TEMPLATES
// ============================================================================

export const templateRoutes = Router();

/**
 * GET / - Get all notification templates
 */
templateRoutes.get('/', async (_req: Request, res: Response) => {
  try {
    const templates = await notificationWorkflowService.getTemplates();
    res.json({ templates });
  } catch (error) {
    console.error('Error getting templates:', error);
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

/**
 * GET /:id - Get a template by ID
 */
templateRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const template = await notificationWorkflowService.getTemplate(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(template);
  } catch (error) {
    console.error('Error getting template:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

/**
 * POST / - Create a new template
 */
templateRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const { name, regulation, authority, type, subject, body, isDefault } = req.body;

    if (!name || !regulation || !authority || !type || !subject || !body) {
      return res.status(400).json({
        error: 'Missing required fields: name, regulation, authority, type, subject, body',
      });
    }

    const template = await notificationWorkflowService.createTemplate({
      name,
      regulation,
      authority,
      type,
      subject,
      body,
      isDefault,
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

/**
 * PUT /:id - Update a template
 */
templateRoutes.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, subject, body, isDefault } = req.body;

    const template = await notificationWorkflowService.updateTemplate(req.params.id, {
      name,
      subject,
      body,
      isDefault,
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

/**
 * DELETE /:id - Delete a template
 */
templateRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await notificationWorkflowService.deleteTemplate(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});
