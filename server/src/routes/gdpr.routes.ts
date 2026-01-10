/**
 * @file gdpr.routes.ts
 * @description REST API routes for GDPR data subject rights (Articles 15-22)
 * @feature gdpr
 *
 * User Self-Service Endpoints:
 * - POST /gdpr/requests/access - Submit access request (Art. 15)
 * - POST /gdpr/requests/rectification - Submit rectification (Art. 16)
 * - POST /gdpr/requests/erasure - Submit erasure request (Art. 17)
 * - POST /gdpr/requests/restriction - Submit restriction (Art. 18)
 * - POST /gdpr/requests/portability - Submit portability (Art. 20)
 * - POST /gdpr/requests/objection - Submit objection (Art. 21)
 * - POST /gdpr/requests/adm-review - Contest AI decision (Art. 22)
 * - GET /gdpr/requests - List user's requests
 * - GET /gdpr/requests/:id - Get request details
 * - DELETE /gdpr/requests/:id - Cancel pending request
 * - GET /gdpr/requests/:id/download - Download export
 * - GET /gdpr/verify/:token - Verify erasure request
 *
 * Consent Management:
 * - GET /gdpr/consents - Get user's consents
 * - POST /gdpr/consents - Update consents
 * - DELETE /gdpr/consents/:type - Revoke consent
 *
 * Admin Endpoints:
 * - GET /gdpr/admin/requests - List all requests
 * - PATCH /gdpr/admin/requests/:id - Update status
 * - POST /gdpr/admin/requests/:id/acknowledge
 * - POST /gdpr/admin/requests/:id/start-processing
 * - POST /gdpr/admin/requests/:id/complete
 * - POST /gdpr/admin/requests/:id/reject
 * - GET /gdpr/admin/metrics - SLA dashboard
 * - GET /gdpr/admin/sla-report - SLA compliance report
 * - GET /gdpr/admin/overdue - Overdue requests
 */

import { Router, type Request, type Response } from 'express';
import { gdprRequestService } from '../services/GDPRRequestService.js';
import { consentService } from '../services/ConsentService.js';
import { dataRestrictionService } from '../services/DataRestrictionService.js';
import {
  GDPRRequestTypes,
  ConsentTypes,
  RestrictionScopes,
  RestrictionReasons,
  type ConsentType,
  type RestrictionScope,
  type RestrictionReason,
} from '../types/gdpr.types.js';

export const gdprRoutes = Router();

// ============================================================================
// USER SELF-SERVICE: REQUEST SUBMISSION
// ============================================================================

/**
 * POST /gdpr/requests/access - Submit data access request (Art. 15)
 */
gdprRoutes.post('/requests/access', async (req: Request, res: Response) => {
  try {
    // For now, use a placeholder userId - in production this comes from auth middleware
    const userId = req.body.userId || 'current-user';
    const format = req.body.format || 'json';
    const includeMetadata = req.body.includeMetadata ?? true;

    const request = await gdprRequestService.createAccessRequest(userId, {
      format,
      includeMetadata,
    });

    res.status(201).json(request);
  } catch (error) {
    console.error('Error creating access request:', error);
    res.status(500).json({ error: 'Failed to create access request' });
  }
});

/**
 * POST /gdpr/requests/rectification - Submit rectification request (Art. 16)
 */
gdprRoutes.post('/requests/rectification', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId || 'current-user';
    const { fields } = req.body;

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        error: 'fields is required and must be a non-empty array',
      });
    }

    const request = await gdprRequestService.createRectificationRequest(userId, { fields });
    res.status(201).json(request);
  } catch (error) {
    console.error('Error creating rectification request:', error);
    res.status(500).json({ error: 'Failed to create rectification request' });
  }
});

/**
 * POST /gdpr/requests/erasure - Submit erasure request (Art. 17)
 */
gdprRoutes.post('/requests/erasure', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId || 'current-user';
    const { reason, scope, specificData } = req.body;

    const request = await gdprRequestService.createErasureRequest(userId, {
      reason,
      scope,
      specificData,
    });

    res.status(201).json({
      ...request,
      message: 'Verification email will be sent. Please verify to proceed with erasure.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create erasure request';
    console.error('Error creating erasure request:', error);
    res.status(400).json({ error: message });
  }
});

/**
 * POST /gdpr/requests/restriction - Submit restriction request (Art. 18)
 */
gdprRoutes.post('/requests/restriction', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId || 'current-user';
    const { scope, reason, details } = req.body;

    if (!scope || !RestrictionScopes.includes(scope)) {
      return res.status(400).json({
        error: `scope is required and must be one of: ${RestrictionScopes.join(', ')}`,
      });
    }

    if (!reason || !RestrictionReasons.includes(reason)) {
      return res.status(400).json({
        error: `reason is required and must be one of: ${RestrictionReasons.join(', ')}`,
      });
    }

    const request = await gdprRequestService.createRestrictionRequest(userId, {
      scope: scope as RestrictionScope,
      reason: reason as RestrictionReason,
      details,
    });

    res.status(201).json(request);
  } catch (error) {
    console.error('Error creating restriction request:', error);
    res.status(500).json({ error: 'Failed to create restriction request' });
  }
});

/**
 * POST /gdpr/requests/portability - Submit portability request (Art. 20)
 */
gdprRoutes.post('/requests/portability', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId || 'current-user';
    const format = req.body.format || 'json';
    const dataCategories = req.body.dataCategories;

    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({
        error: 'format must be either "json" or "csv"',
      });
    }

    const request = await gdprRequestService.createPortabilityRequest(userId, {
      format,
      dataCategories,
    });

    res.status(201).json(request);
  } catch (error) {
    console.error('Error creating portability request:', error);
    res.status(500).json({ error: 'Failed to create portability request' });
  }
});

/**
 * POST /gdpr/requests/objection - Submit objection request (Art. 21)
 */
gdprRoutes.post('/requests/objection', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId || 'current-user';
    const { processingActivity, reason, details } = req.body;

    if (!processingActivity) {
      return res.status(400).json({
        error: 'processingActivity is required',
      });
    }

    if (!reason) {
      return res.status(400).json({
        error: 'reason is required',
      });
    }

    const request = await gdprRequestService.createObjectionRequest(userId, {
      processingActivity,
      reason,
      details,
    });

    res.status(201).json(request);
  } catch (error) {
    console.error('Error creating objection request:', error);
    res.status(500).json({ error: 'Failed to create objection request' });
  }
});

/**
 * POST /gdpr/requests/adm-review - Submit ADM review request (Art. 22)
 */
gdprRoutes.post('/requests/adm-review', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId || 'current-user';
    const { decisionId, contestReason, evidence } = req.body;

    if (!decisionId) {
      return res.status(400).json({
        error: 'decisionId is required',
      });
    }

    if (!contestReason) {
      return res.status(400).json({
        error: 'contestReason is required',
      });
    }

    const request = await gdprRequestService.createADMReviewRequest(userId, {
      decisionId,
      contestReason,
      evidence,
    });

    res.status(201).json(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create ADM review request';
    console.error('Error creating ADM review request:', error);
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// USER SELF-SERVICE: REQUEST MANAGEMENT
// ============================================================================

/**
 * GET /gdpr/requests - List user's requests
 */
gdprRoutes.get('/requests', async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || 'current-user';
    const requests = await gdprRequestService.getUserRequests(userId);
    res.json({ requests });
  } catch (error) {
    console.error('Error fetching user requests:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

/**
 * GET /gdpr/requests/:id - Get request details
 */
gdprRoutes.get('/requests/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const request = await gdprRequestService.getRequest(id);

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Include status history
    const history = await gdprRequestService.getStatusHistory(id);

    res.json({ request, history });
  } catch (error) {
    console.error('Error fetching request:', error);
    res.status(500).json({ error: 'Failed to fetch request' });
  }
});

/**
 * DELETE /gdpr/requests/:id - Cancel pending request
 */
gdprRoutes.delete('/requests/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req.query.userId as string) || 'current-user';

    const request = await gdprRequestService.cancelRequest(id, userId);
    res.json(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel request';
    console.error('Error cancelling request:', error);
    res.status(400).json({ error: message });
  }
});

/**
 * GET /gdpr/requests/:id/download - Download export for completed request
 */
gdprRoutes.get('/requests/:id/download', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const request = await gdprRequestService.getRequest(id);

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (request.status !== 'completed') {
      return res.status(400).json({ error: 'Request is not yet completed' });
    }

    if (!request.responseData) {
      return res.status(404).json({ error: 'No export data available' });
    }

    // Return the export data
    res.json(request.responseData);
  } catch (error) {
    console.error('Error downloading export:', error);
    res.status(500).json({ error: 'Failed to download export' });
  }
});

/**
 * GET /gdpr/verify/:token - Verify erasure request
 */
gdprRoutes.get('/verify/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const request = await gdprRequestService.verifyRequest(token);

    res.json({
      message: 'Request verified successfully',
      request,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    console.error('Error verifying request:', error);
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// CONSENT MANAGEMENT
// ============================================================================

/**
 * GET /gdpr/consents - Get user's consents
 */
gdprRoutes.get('/consents', async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || 'current-user';
    const consents = await consentService.getUserConsents(userId);
    res.json({ consents });
  } catch (error) {
    console.error('Error fetching consents:', error);
    res.status(500).json({ error: 'Failed to fetch consents' });
  }
});

/**
 * POST /gdpr/consents - Update consent
 */
gdprRoutes.post('/consents', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId || 'current-user';
    const { type, granted, consents } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    // Handle batch update
    if (consents && Array.isArray(consents)) {
      const updated = await consentService.updateMultipleConsents(userId, {
        consents,
        ipAddress,
        userAgent,
      });
      return res.json({ consents: updated });
    }

    // Single consent update
    if (!type || !ConsentTypes.includes(type)) {
      return res.status(400).json({
        error: `type is required and must be one of: ${ConsentTypes.join(', ')}`,
      });
    }

    if (typeof granted !== 'boolean') {
      return res.status(400).json({
        error: 'granted must be a boolean',
      });
    }

    const consent = await consentService.updateConsent(
      userId,
      type as ConsentType,
      granted,
      ipAddress,
      userAgent,
    );

    res.json(consent);
  } catch (error) {
    console.error('Error updating consent:', error);
    res.status(500).json({ error: 'Failed to update consent' });
  }
});

/**
 * DELETE /gdpr/consents/:type - Revoke specific consent
 */
gdprRoutes.delete('/consents/:type', async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const userId = (req.query.userId as string) || 'current-user';

    if (!ConsentTypes.includes(type as ConsentType)) {
      return res.status(400).json({
        error: `Invalid consent type. Must be one of: ${ConsentTypes.join(', ')}`,
      });
    }

    const consent = await consentService.revokeConsent(userId, type as ConsentType);
    res.json(consent);
  } catch (error) {
    console.error('Error revoking consent:', error);
    res.status(500).json({ error: 'Failed to revoke consent' });
  }
});

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

/**
 * GET /gdpr/admin/requests - List all requests with filters
 */
gdprRoutes.get('/admin/requests', async (req: Request, res: Response) => {
  try {
    const {
      status,
      requestType,
      userId,
      assignedTo,
      fromDate,
      toDate,
      overdue,
      page,
      limit,
    } = req.query;

    const filters: Record<string, unknown> = {};
    if (status) filters.status = status;
    if (requestType) filters.requestType = requestType;
    if (userId) filters.userId = userId;
    if (assignedTo) filters.assignedTo = assignedTo;
    if (fromDate) filters.fromDate = new Date(fromDate as string);
    if (toDate) filters.toDate = new Date(toDate as string);
    if (overdue === 'true') filters.overdue = true;

    const result = await gdprRequestService.getAllRequests(
      filters,
      parseInt(page as string) || 1,
      parseInt(limit as string) || 20,
    );

    res.json(result);
  } catch (error) {
    console.error('Error fetching admin requests:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

/**
 * POST /gdpr/admin/requests/:id/acknowledge - Acknowledge a request
 */
gdprRoutes.post('/admin/requests/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.body.adminId || 'admin';

    const request = await gdprRequestService.acknowledgeRequest(id, adminId);
    res.json(request);
  } catch (error) {
    console.error('Error acknowledging request:', error);
    res.status(500).json({ error: 'Failed to acknowledge request' });
  }
});

/**
 * POST /gdpr/admin/requests/:id/start-processing - Start processing a request
 */
gdprRoutes.post('/admin/requests/:id/start-processing', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.body.adminId || 'admin';

    const request = await gdprRequestService.startProcessing(id, adminId);
    res.json(request);
  } catch (error) {
    console.error('Error starting processing:', error);
    res.status(500).json({ error: 'Failed to start processing' });
  }
});

/**
 * POST /gdpr/admin/requests/:id/complete - Complete a request
 */
gdprRoutes.post('/admin/requests/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.body.adminId || 'admin';
    const responseData = req.body.responseData || {};

    // For access/portability requests, generate export
    const existingRequest = await gdprRequestService.getRequest(id);
    if (
      existingRequest &&
      (existingRequest.requestType === 'access' || existingRequest.requestType === 'portability')
    ) {
      const format = (existingRequest.requestData as Record<string, unknown>)?.format as
        | 'json'
        | 'csv'
        | undefined;
      const exportResult = await gdprRequestService.generateDataExport(
        existingRequest.userId,
        format || 'json',
      );
      responseData.export = exportResult;
    }

    const request = await gdprRequestService.completeRequest(id, adminId, responseData);
    res.json(request);
  } catch (error) {
    console.error('Error completing request:', error);
    res.status(500).json({ error: 'Failed to complete request' });
  }
});

/**
 * POST /gdpr/admin/requests/:id/reject - Reject a request
 */
gdprRoutes.post('/admin/requests/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.body.adminId || 'admin';
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        error: 'reason is required',
      });
    }

    const request = await gdprRequestService.rejectRequest(id, adminId, reason);
    res.json(request);
  } catch (error) {
    console.error('Error rejecting request:', error);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

/**
 * POST /gdpr/admin/requests/:id/execute-erasure - Execute erasure for approved request
 */
gdprRoutes.post('/admin/requests/:id/execute-erasure', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.body.adminId || 'admin';

    const existingRequest = await gdprRequestService.getRequest(id);
    if (!existingRequest) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (existingRequest.requestType !== 'erasure') {
      return res.status(400).json({ error: 'This is not an erasure request' });
    }

    if (existingRequest.status !== 'in_progress') {
      return res.status(400).json({ error: 'Request must be in progress to execute erasure' });
    }

    // Execute erasure
    const erasureResult = await gdprRequestService.executeErasure(existingRequest.userId);

    // Complete the request
    const request = await gdprRequestService.completeRequest(id, adminId, {
      erasureResult,
    });

    res.json({ request, erasureResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute erasure';
    console.error('Error executing erasure:', error);
    res.status(400).json({ error: message });
  }
});

/**
 * GET /gdpr/admin/metrics - Get GDPR metrics dashboard
 */
gdprRoutes.get('/admin/metrics', async (_req: Request, res: Response) => {
  try {
    const metrics = await gdprRequestService.getMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * GET /gdpr/admin/sla-report - Get SLA compliance report
 */
gdprRoutes.get('/admin/sla-report', async (_req: Request, res: Response) => {
  try {
    const report = await gdprRequestService.getSLAReport();
    res.json(report);
  } catch (error) {
    console.error('Error fetching SLA report:', error);
    res.status(500).json({ error: 'Failed to fetch SLA report' });
  }
});

/**
 * GET /gdpr/admin/overdue - Get overdue requests
 */
gdprRoutes.get('/admin/overdue', async (_req: Request, res: Response) => {
  try {
    const overdueRequests = await gdprRequestService.getOverdueRequests();
    res.json({ requests: overdueRequests });
  } catch (error) {
    console.error('Error fetching overdue requests:', error);
    res.status(500).json({ error: 'Failed to fetch overdue requests' });
  }
});

/**
 * GET /gdpr/admin/nearing-deadline - Get requests nearing SLA deadline
 */
gdprRoutes.get('/admin/nearing-deadline', async (req: Request, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string) || 48;
    const requests = await gdprRequestService.getRequestsNearingSLA(hours);
    res.json({ requests });
  } catch (error) {
    console.error('Error fetching nearing deadline requests:', error);
    res.status(500).json({ error: 'Failed to fetch nearing deadline requests' });
  }
});

/**
 * GET /gdpr/admin/consent-metrics - Get consent statistics
 */
gdprRoutes.get('/admin/consent-metrics', async (_req: Request, res: Response) => {
  try {
    const metrics = await consentService.getConsentMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('Error fetching consent metrics:', error);
    res.status(500).json({ error: 'Failed to fetch consent metrics' });
  }
});

/**
 * GET /gdpr/admin/restriction-stats - Get restriction statistics
 */
gdprRoutes.get('/admin/restriction-stats', async (_req: Request, res: Response) => {
  try {
    const stats = await dataRestrictionService.getRestrictionStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching restriction stats:', error);
    res.status(500).json({ error: 'Failed to fetch restriction stats' });
  }
});

/**
 * GET /gdpr/admin/restrictions - Get all active restrictions
 */
gdprRoutes.get('/admin/restrictions', async (_req: Request, res: Response) => {
  try {
    const restrictions = await dataRestrictionService.getActiveRestrictions();
    res.json({ restrictions });
  } catch (error) {
    console.error('Error fetching restrictions:', error);
    res.status(500).json({ error: 'Failed to fetch restrictions' });
  }
});

/**
 * POST /gdpr/admin/restrictions/:id/lift - Lift a restriction
 */
gdprRoutes.post('/admin/restrictions/:id/lift', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.body.adminId || 'admin';

    const restriction = await dataRestrictionService.liftRestriction(id, adminId);
    res.json(restriction);
  } catch (error) {
    console.error('Error lifting restriction:', error);
    res.status(500).json({ error: 'Failed to lift restriction' });
  }
});
