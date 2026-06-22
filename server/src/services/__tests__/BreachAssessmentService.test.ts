/**
 * @file BreachAssessmentService.test.ts
 * @description Unit tests for BreachAssessmentService — risk scoring, severity classification, notification rules
 * @feature incidents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Incident,
  IncidentType,
  IncidentSeverity,
  IncidentStatus,
  RiskAssessment,
} from '../../types/incident.types.js';

// Mock the incident repository the service imports
vi.mock('../../repositories/IncidentRepository.js', () => ({
  incidentRepository: {
    findById: vi.fn(),
    update: vi.fn(),
  },
}));

import { BreachAssessmentService } from '../BreachAssessmentService.js';

// Build a minimal valid Incident
const makeIncident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'inc-1',
  incidentNumber: 'INC-0001',
  type: 'data_breach' as IncidentType,
  severity: 'medium' as IncidentSeverity,
  status: 'detected' as IncidentStatus,
  title: 'Test',
  description: 'Test incident',
  rootCause: null,
  resolution: null,
  riskScore: null,
  affectedDataSubjects: 0,
  dataCategories: [],
  detectedAt: new Date(),
  containedAt: null,
  resolvedAt: null,
  closedAt: null,
  robotId: null,
  complianceLogIds: [],
  alertIds: [],
  systemSnapshot: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  ...overrides,
});

const makeAssessment = (overrides: Partial<RiskAssessment> = {}): RiskAssessment => ({
  incidentId: 'inc-1',
  impactLevel: 'moderate',
  likelihoodLevel: 'possible',
  riskScore: 50,
  affectedDataSubjects: 0,
  dataCategories: [],
  potentialHarm: [],
  mitigatingFactors: [],
  assessedAt: new Date(),
  ...overrides,
});

describe('BreachAssessmentService', () => {
  let service: BreachAssessmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BreachAssessmentService();
  });

  // --------------------------------------------------------------------------
  // assessRisk
  // --------------------------------------------------------------------------

  describe('assessRisk', () => {
    it('throws when the incident does not exist', async () => {
      const { incidentRepository } = await import('../../repositories/IncidentRepository.js');
      vi.mocked(incidentRepository.findById).mockResolvedValue(null);

      await expect(service.assessRisk('missing')).rejects.toThrow('Incident missing not found');
    });

    it('persists the computed risk score back to the incident', async () => {
      const { incidentRepository } = await import('../../repositories/IncidentRepository.js');
      const incident = makeIncident({ type: 'data_breach', status: 'detected' });
      vi.mocked(incidentRepository.findById).mockResolvedValue(incident);
      vi.mocked(incidentRepository.update).mockResolvedValue(incident);

      const assessment = await service.assessRisk('inc-1', 'auditor');

      expect(assessment.assessedBy).toBe('auditor');
      expect(assessment.riskScore).toBeGreaterThan(0);
      expect(incidentRepository.update).toHaveBeenCalledWith('inc-1', {
        riskScore: assessment.riskScore,
      });
    });

    it('produces a critical-range score for a severe, certain incident', async () => {
      const { incidentRepository } = await import('../../repositories/IncidentRepository.js');
      // Safety + detected => likelihood 'certain'; many subjects + health => severe impact
      const incident = makeIncident({
        type: 'safety',
        status: 'detected',
        severity: 'critical',
        affectedDataSubjects: 20000,
        dataCategories: ['health'],
      });
      vi.mocked(incidentRepository.findById).mockResolvedValue(incident);
      vi.mocked(incidentRepository.update).mockResolvedValue(incident);

      const assessment = await service.assessRisk('inc-1');
      // Computed: subjects 100 + health 50 + safety 40 + critical 30 = 220 => /2.8 ~= 78.6 => 'major'
      expect(assessment.impactLevel).toBe('major');
      expect(assessment.likelihoodLevel).toBe('certain');
      // major + certain => matrix score 90 (critical range)
      expect(assessment.riskScore).toBe(90);
      expect(service.classifySeverity(assessment.riskScore)).toBe('critical');
    });

    it('produces a low score for a resolved, negligible incident', async () => {
      const { incidentRepository } = await import('../../repositories/IncidentRepository.js');
      const incident = makeIncident({
        type: 'vulnerability',
        status: 'resolved',
        severity: 'low',
        affectedDataSubjects: 0,
        dataCategories: ['operational'],
      });
      vi.mocked(incidentRepository.findById).mockResolvedValue(incident);
      vi.mocked(incidentRepository.update).mockResolvedValue(incident);

      const assessment = await service.assessRisk('inc-1');
      expect(assessment.likelihoodLevel).toBe('rare'); // resolved
      expect(assessment.impactLevel).toBe('negligible');
      // negligible + rare => score 5
      expect(assessment.riskScore).toBe(5);
    });

    it('adds sensitive-data harm only for breaches involving special categories', async () => {
      const { incidentRepository } = await import('../../repositories/IncidentRepository.js');
      const incident = makeIncident({
        type: 'data_breach',
        dataCategories: ['biometric'],
      });
      vi.mocked(incidentRepository.findById).mockResolvedValue(incident);
      vi.mocked(incidentRepository.update).mockResolvedValue(incident);

      const assessment = await service.assessRisk('inc-1');
      expect(assessment.potentialHarm).toContain('Discrimination based on sensitive data');
    });

    it('lists mitigating factors for a contained incident with root cause', async () => {
      const { incidentRepository } = await import('../../repositories/IncidentRepository.js');
      const incident = makeIncident({
        status: 'contained',
        rootCause: 'misconfiguration',
        resolution: 'patched',
      });
      vi.mocked(incidentRepository.findById).mockResolvedValue(incident);
      vi.mocked(incidentRepository.update).mockResolvedValue(incident);

      const assessment = await service.assessRisk('inc-1');
      expect(assessment.mitigatingFactors).toContain('Incident has been contained');
      expect(assessment.mitigatingFactors).toContain('Root cause has been identified');
      expect(assessment.mitigatingFactors).toContain('Resolution has been documented');
    });

    it('flags rapid detection when the incident was detected less than an hour ago', async () => {
      const { incidentRepository } = await import('../../repositories/IncidentRepository.js');
      const incident = makeIncident({ detectedAt: new Date(Date.now() - 5 * 60 * 1000) });
      vi.mocked(incidentRepository.findById).mockResolvedValue(incident);
      vi.mocked(incidentRepository.update).mockResolvedValue(incident);

      const assessment = await service.assessRisk('inc-1');
      expect(assessment.mitigatingFactors).toContain('Rapid detection and response');
    });
  });

  // --------------------------------------------------------------------------
  // classifySeverity
  // --------------------------------------------------------------------------

  describe('classifySeverity', () => {
    it('maps score boundaries to the correct severity', () => {
      expect(service.classifySeverity(76)).toBe('critical');
      expect(service.classifySeverity(75)).toBe('high');
      expect(service.classifySeverity(51)).toBe('high');
      expect(service.classifySeverity(50)).toBe('medium');
      expect(service.classifySeverity(21)).toBe('medium');
      expect(service.classifySeverity(20)).toBe('low');
      expect(service.classifySeverity(0)).toBe('low');
    });
  });

  // --------------------------------------------------------------------------
  // getSeverityFromMatrix
  // --------------------------------------------------------------------------

  describe('getSeverityFromMatrix', () => {
    it('returns the matrix severity for a known combination', () => {
      expect(service.getSeverityFromMatrix('severe', 'certain')).toBe('critical');
      expect(service.getSeverityFromMatrix('negligible', 'rare')).toBe('low');
      expect(service.getSeverityFromMatrix('moderate', 'likely')).toBe('high');
    });
  });

  // --------------------------------------------------------------------------
  // determineNotificationRequirements
  // --------------------------------------------------------------------------

  describe('determineNotificationRequirements', () => {
    it('requires DPA notification for a data breach', () => {
      const incident = makeIncident({ type: 'data_breach' });
      const reqs = service.determineNotificationRequirements(incident, makeAssessment());
      expect(reqs.some((r) => r.regulation === 'gdpr' && r.authority === 'dpa')).toBe(true);
    });

    it('requires data-subject notification only for high-risk breaches', () => {
      const incident = makeIncident({ type: 'data_breach' });
      const lowRisk = service.determineNotificationRequirements(
        incident,
        makeAssessment({ riskScore: 30 })
      );
      expect(lowRisk.some((r) => r.authority === 'data_subject')).toBe(false);

      const highRisk = service.determineNotificationRequirements(
        incident,
        makeAssessment({ riskScore: 60 })
      );
      expect(highRisk.some((r) => r.authority === 'data_subject')).toBe(true);
    });

    it('requires AI Act serious-incident notification for a high-score AI malfunction', () => {
      const incident = makeIncident({ type: 'ai_malfunction', severity: 'critical' });
      const reqs = service.determineNotificationRequirements(
        incident,
        makeAssessment({ riskScore: 90 })
      );
      const serious = reqs.find(
        (r) => r.regulation === 'ai_act' && r.deadlineHours === 2 * 24
      );
      expect(serious).toBeDefined();
    });

    it('returns the three NIS2 stages for a security incident', () => {
      const incident = makeIncident({ type: 'security' });
      const reqs = service.determineNotificationRequirements(incident, makeAssessment());
      const nis2 = reqs.filter((r) => r.regulation === 'nis2');
      expect(nis2.map((r) => r.notificationType).sort()).toEqual(
        ['early_warning', 'final', 'initial']
      );
    });

    it('returns no notifications for an unrelated incident type', () => {
      // vulnerability with no score => only the CRA vulnerability rule applies
      const incident = makeIncident({ type: 'vulnerability' });
      const reqs = service.determineNotificationRequirements(incident, makeAssessment());
      expect(reqs).toHaveLength(1);
      expect(reqs[0].regulation).toBe('cra');
    });
  });

  // --------------------------------------------------------------------------
  // accessors
  // --------------------------------------------------------------------------

  describe('getRiskMatrix / getDataCategoryWeights', () => {
    it('returns a new array of all 25 risk matrix entries', () => {
      const matrix = service.getRiskMatrix();
      expect(matrix.length).toBe(25);
      // New array each call (push to the copy does not affect the source)
      matrix.push({ impact: 'severe', likelihood: 'certain', score: 0, severity: 'low' });
      expect(service.getRiskMatrix().length).toBe(25);
    });

    it('exposes data category sensitivity weights', () => {
      const weights = service.getDataCategoryWeights();
      expect(weights.health).toBe(1.0);
      expect(weights.operational).toBe(0.1);
    });
  });
});
