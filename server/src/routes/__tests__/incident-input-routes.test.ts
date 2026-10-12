/**
 * @file incident-input-routes.test.ts
 * @description Incident writes refuse unknown enums and out-of-range numbers
 *   with 400, list pagination refuses garbage, and a wrong-typed field is never
 *   answered 404 (TASK-386).
 * @feature incidents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';

const { mockIncidentService } = vi.hoisted(() => ({
  mockIncidentService: {
    listIncidents: vi.fn(),
    createIncident: vi.fn(),
    updateIncident: vi.fn(),
    getIncident: vi.fn(),
    captureSystemSnapshot: vi.fn(),
  },
}));

vi.mock('../../services/IncidentService.js', () => ({ incidentService: mockIncidentService }));
vi.mock('../../services/BreachAssessmentService.js', () => ({ breachAssessmentService: {} }));
vi.mock('../../services/NotificationWorkflowService.js', () => ({
  notificationWorkflowService: { createNotificationWorkflow: vi.fn() },
}));

import { incidentRoutes } from '../incident.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/incidents', incidentRoutes);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIncidentService.listIncidents.mockResolvedValue({ incidents: [], total: 0 });
  mockIncidentService.updateIncident.mockResolvedValue({ id: 'i-1' });
});

describe('POST /incidents', () => {
  const base = { type: 'safety', title: 't', description: 'd' };

  it('refuses an unknown severity and lists the allowed values', async () => {
    const res = await request(app()).post('/incidents').send({ ...base, severity: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('critical, high, medium, low');
    expect(mockIncidentService.createIncident).not.toHaveBeenCalled();
  });
});

describe('PATCH /incidents/:id', () => {
  it.each([
    [{ status: 'bogus' }, 'Invalid status'],
    [{ severity: 'urgent' }, 'Invalid severity'],
    [{ riskScore: -500 }, 'Invalid riskScore'],
    [{ riskScore: 101 }, 'Invalid riskScore'],
    [{ riskScore: 'high' }, 'Invalid riskScore'],
    [{ riskScore: 1.5 }, 'Invalid riskScore'],
  ])('refuses %j with 400', async (body, message) => {
    const res = await request(app()).patch('/incidents/i-1').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
    expect(mockIncidentService.updateIncident).not.toHaveBeenCalled();
  });

  it('accepts a valid status, severity and riskScore', async () => {
    const res = await request(app())
      .patch('/incidents/i-1')
      .send({ status: 'investigating', severity: 'low', riskScore: 40 });
    expect(res.status).toBe(200);
  });

  it('answers a database validation failure as 400, not 404', async () => {
    mockIncidentService.updateIncident.mockRejectedValue(
      new Prisma.PrismaClientValidationError('Invalid value', { clientVersion: '5.0.0' })
    );
    const res = await request(app()).patch('/incidents/i-1').send({ title: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('GET /incidents', () => {
  it.each(['page=abc', 'page=0', 'limit=-1', 'limit=0'])('refuses ?%s with 400', async (qs) => {
    const res = await request(app()).get(`/incidents?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^(page|limit) must be/);
    expect(mockIncidentService.listIncidents).not.toHaveBeenCalled();
  });

  it('passes valid pagination through', async () => {
    const res = await request(app()).get('/incidents?page=2&limit=5');
    expect(res.status).toBe(200);
    expect(mockIncidentService.listIncidents).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 5 })
    );
  });
});
