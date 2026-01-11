/**
 * @file ComplianceTrackerService.ts
 * @description Service for compliance monitoring dashboard - aggregates regulatory compliance data
 * @feature compliance
 *
 * Tracks compliance across multiple frameworks:
 * - EU AI Act (August 2027)
 * - Machinery Regulation (January 2027)
 * - GDPR (ongoing)
 * - NIS2 (April 2025)
 * - CRA (December 2027)
 * - RED EN 18031 (August 2025)
 * - DGUV (ongoing)
 */

import { prisma } from '../database/index.js';

// ============================================================================
// TYPES
// ============================================================================

export type RegulatoryFramework =
  | 'ai_act'
  | 'machinery_regulation'
  | 'gdpr'
  | 'nis2'
  | 'cra'
  | 'red'
  | 'dguv';

export type ComplianceStatus =
  | 'compliant'
  | 'in_progress'
  | 'at_risk'
  | 'overdue'
  | 'not_started';

export type GapSeverity = 'critical' | 'high' | 'medium' | 'low';
export type TrainingType = 'operator_competence' | 'safety_training' | 'emergency_response' | 'first_aid' | 'maintenance_training';
export type InspectionType = 'electrical' | 'force_verification' | 'biomechanical' | 'safety_function' | 'protective_device';
export type RiskAssessmentType = 'ai_risk' | 'machinery_risk' | 'dpia' | 'cybersecurity' | 'occupational';

export interface DashboardStats {
  overallScore: number;
  frameworkScores: FrameworkScore[];
  alerts: ComplianceAlerts;
  lastUpdated: string;
}

export interface FrameworkScore {
  framework: RegulatoryFramework;
  score: number;
  status: ComplianceStatus;
  openItems: number;
  totalItems: number;
}

export interface ComplianceAlerts {
  criticalGaps: number;
  expiringDocuments: number;
  overdueTraining: number;
  overdueInspections: number;
  upcomingDeadlines: number;
  pendingRiskReviews: number;
}

export interface TrainingRecordInput {
  userId: string;
  userName: string;
  userEmail?: string;
  trainingType: TrainingType;
  completedAt: Date;
  expiresAt: Date;
  certificateUrl?: string;
  trainingProvider?: string;
  notes?: string;
}

export interface InspectionScheduleInput {
  inspectionType: InspectionType;
  robotId?: string;
  robotName?: string;
  lastInspectionDate: Date;
  nextDueDate: Date;
  intervalYears: number;
  inspectorName?: string;
  inspectorCompany?: string;
  reportUrl?: string;
  notes?: string;
}

export interface RiskAssessmentInput {
  assessmentType: RiskAssessmentType;
  name: string;
  version: string;
  description?: string;
  lastUpdated: Date;
  nextReviewDate: Date;
  triggerConditions?: string[];
  documentUrl?: string;
  responsiblePerson?: string;
}

export interface ComplianceGapInput {
  framework: RegulatoryFramework;
  requirement: string;
  articleReference: string;
  severity: GapSeverity;
  description: string;
  currentState: string;
  targetState: string;
  remediation: string;
  estimatedEffort?: 'low' | 'medium' | 'high';
  dueDate?: Date;
  assignedTo?: string;
}

export interface RegulatoryDeadlineInput {
  framework: RegulatoryFramework;
  name: string;
  deadline: Date;
  description: string;
  requirements: string[];
  priority?: 'critical' | 'high' | 'medium' | 'low';
  notes?: string;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ComplianceTrackerService {
  constructor() {
    console.log('[ComplianceTrackerService] Initialized');
  }

  // ==========================================================================
  // DASHBOARD
  // ==========================================================================

  /**
   * Get overall dashboard statistics
   */
  async getDashboardStats(): Promise<DashboardStats> {
    const now = new Date();

    // Get framework scores
    const frameworkScores = await this.calculateFrameworkScores();

    // Calculate alerts
    const alerts = await this.calculateAlerts();

    // Calculate overall score (weighted average of framework scores)
    const totalWeight = frameworkScores.length;
    const overallScore = totalWeight > 0
      ? Math.round(frameworkScores.reduce((sum, fs) => sum + fs.score, 0) / totalWeight)
      : 100;

    return {
      overallScore,
      frameworkScores,
      alerts,
      lastUpdated: now.toISOString(),
    };
  }

  private async calculateFrameworkScores(): Promise<FrameworkScore[]> {
    const frameworks: RegulatoryFramework[] = [
      'ai_act', 'machinery_regulation', 'gdpr', 'nis2', 'cra', 'red', 'dguv'
    ];

    const scores: FrameworkScore[] = [];

    for (const framework of frameworks) {
      const gaps = await prisma.complianceGap.findMany({
        where: { framework, status: { not: 'closed' } },
      });

      const deadlines = await prisma.regulatoryDeadline.findMany({
        where: { framework },
      });

      const totalItems = gaps.length + deadlines.length;
      const openItems = gaps.filter(g => g.status === 'open').length +
        gaps.filter(g => g.severity === 'critical').length;

      // Calculate score: 100 - (weighted gaps)
      const criticalGaps = gaps.filter(g => g.severity === 'critical').length;
      const highGaps = gaps.filter(g => g.severity === 'high').length;
      const mediumGaps = gaps.filter(g => g.severity === 'medium').length;

      const penaltyPoints = (criticalGaps * 20) + (highGaps * 10) + (mediumGaps * 5);
      const score = Math.max(0, 100 - penaltyPoints);

      let status: ComplianceStatus;
      if (score >= 90) status = 'compliant';
      else if (score >= 70) status = 'in_progress';
      else if (score >= 50) status = 'at_risk';
      else if (criticalGaps > 0) status = 'overdue';
      else status = 'not_started';

      scores.push({
        framework,
        score,
        status,
        openItems,
        totalItems,
      });
    }

    return scores;
  }

  private async calculateAlerts(): Promise<ComplianceAlerts> {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Critical gaps
    const criticalGaps = await prisma.complianceGap.count({
      where: { severity: 'critical', status: { not: 'closed' } },
    });

    // Expiring documents (from ProviderDocumentation)
    const expiringDocuments = await prisma.providerDocumentation.count({
      where: {
        validTo: { lte: thirtyDaysFromNow, gt: now },
      },
    });

    // Overdue training
    const overdueTraining = await prisma.trainingRecord.count({
      where: { expiresAt: { lt: now } },
    });

    // Overdue inspections
    const overdueInspections = await prisma.inspectionSchedule.count({
      where: { nextDueDate: { lt: now } },
    });

    // Upcoming deadlines (within 90 days)
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const upcomingDeadlines = await prisma.regulatoryDeadline.count({
      where: { deadline: { lte: ninetyDaysFromNow, gt: now } },
    });

    // Pending risk reviews
    const pendingRiskReviews = await prisma.riskAssessment.count({
      where: { nextReviewDate: { lt: now } },
    });

    return {
      criticalGaps,
      expiringDocuments,
      overdueTraining,
      overdueInspections,
      upcomingDeadlines,
      pendingRiskReviews,
    };
  }

  // ==========================================================================
  // REGULATORY DEADLINES
  // ==========================================================================

  async getRegulatoryDeadlines() {
    const now = new Date();
    const deadlines = await prisma.regulatoryDeadline.findMany({
      orderBy: { deadline: 'asc' },
    });

    return deadlines.map(d => {
      const daysUntilDeadline = Math.ceil((d.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const completionRate = d.requirements.length > 0
        ? d.completedRequirements.length / d.requirements.length
        : 1;

      let status: ComplianceStatus;
      if (completionRate >= 1) status = 'compliant';
      else if (daysUntilDeadline < 0) status = 'overdue';
      else if (daysUntilDeadline < 90 && completionRate < 0.5) status = 'at_risk';
      else if (completionRate > 0) status = 'in_progress';
      else status = 'not_started';

      return {
        ...d,
        daysUntilDeadline,
        status,
      };
    });
  }

  async createRegulatoryDeadline(input: RegulatoryDeadlineInput) {
    return prisma.regulatoryDeadline.create({
      data: {
        framework: input.framework,
        name: input.name,
        deadline: input.deadline,
        description: input.description,
        requirements: input.requirements,
        completedRequirements: [],
        priority: input.priority || 'medium',
        notes: input.notes,
      },
    });
  }

  async updateDeadlineProgress(id: string, completedRequirements: string[]) {
    return prisma.regulatoryDeadline.update({
      where: { id },
      data: { completedRequirements },
    });
  }

  // ==========================================================================
  // GAP ANALYSIS
  // ==========================================================================

  async getGaps(options?: { framework?: RegulatoryFramework; severity?: GapSeverity; status?: 'open' | 'closed' | 'in_progress' }) {
    const now = new Date();
    const gaps = await prisma.complianceGap.findMany({
      where: {
        ...(options?.framework && { framework: options.framework }),
        ...(options?.severity && { severity: options.severity }),
        ...(options?.status && { status: options.status }),
      },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });

    return gaps.map(g => ({
      ...g,
      daysUntilDue: g.dueDate ? Math.ceil((g.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null,
    }));
  }

  async createGap(input: ComplianceGapInput) {
    const gap = await prisma.complianceGap.create({
      data: {
        framework: input.framework,
        requirement: input.requirement,
        articleReference: input.articleReference,
        severity: input.severity,
        description: input.description,
        currentState: input.currentState,
        targetState: input.targetState,
        remediation: input.remediation,
        estimatedEffort: input.estimatedEffort || 'medium',
        dueDate: input.dueDate,
        assignedTo: input.assignedTo,
        status: 'open',
      },
    });

    // Log activity
    await this.logActivity('gap_closed', `New gap identified: ${input.requirement}`, input.framework);

    return gap;
  }

  async closeGap(id: string, closedBy: string) {
    const gap = await prisma.complianceGap.update({
      where: { id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        closedBy,
      },
    });

    // Log activity
    await this.logActivity('gap_closed', `Gap closed: ${gap.requirement}`, gap.framework as RegulatoryFramework);

    return gap;
  }

  async getGapSummaryByFramework(): Promise<Record<RegulatoryFramework, { total: number; critical: number; high: number; medium: number; low: number }>> {
    const gaps = await prisma.complianceGap.findMany({
      where: { status: { not: 'closed' } },
    });

    const summary: Record<string, { total: number; critical: number; high: number; medium: number; low: number }> = {};

    for (const gap of gaps) {
      if (!summary[gap.framework]) {
        summary[gap.framework] = { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
      }
      summary[gap.framework].total++;
      summary[gap.framework][gap.severity as GapSeverity]++;
    }

    return summary as Record<RegulatoryFramework, { total: number; critical: number; high: number; medium: number; low: number }>;
  }

  // ==========================================================================
  // DOCUMENT EXPIRY
  // ==========================================================================

  async getExpiringDocuments(withinDays: number = 30) {
    const now = new Date();
    const futureDate = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

    const docs = await prisma.providerDocumentation.findMany({
      where: {
        validTo: { lte: futureDate },
      },
      orderBy: { validTo: 'asc' },
    });

    return docs.map(d => {
      const daysUntilExpiry = d.validTo
        ? Math.ceil((d.validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      let status: 'valid' | 'expiring_soon' | 'expired';
      if (!d.validTo || d.validTo > futureDate) status = 'valid';
      else if (d.validTo < now) status = 'expired';
      else status = 'expiring_soon';

      return {
        ...d,
        daysUntilExpiry,
        status,
      };
    });
  }

  // ==========================================================================
  // TRAINING RECORDS (DGUV)
  // ==========================================================================

  async getTrainingRecords(options?: { userId?: string; trainingType?: TrainingType; status?: 'valid' | 'expiring_soon' | 'expired' }) {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const records = await prisma.trainingRecord.findMany({
      where: {
        ...(options?.userId && { userId: options.userId }),
        ...(options?.trainingType && { trainingType: options.trainingType }),
      },
      orderBy: { expiresAt: 'asc' },
    });

    return records
      .map(r => {
        const daysUntilExpiry = Math.ceil((r.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        let status: 'valid' | 'expiring_soon' | 'expired';
        if (r.expiresAt < now) status = 'expired';
        else if (r.expiresAt <= thirtyDaysFromNow) status = 'expiring_soon';
        else status = 'valid';

        return { ...r, daysUntilExpiry, status };
      })
      .filter(r => !options?.status || r.status === options.status);
  }

  async createTrainingRecord(input: TrainingRecordInput) {
    const record = await prisma.trainingRecord.create({
      data: {
        userId: input.userId,
        userName: input.userName,
        userEmail: input.userEmail,
        trainingType: input.trainingType,
        completedAt: input.completedAt,
        expiresAt: input.expiresAt,
        certificateUrl: input.certificateUrl,
        trainingProvider: input.trainingProvider,
        notes: input.notes,
      },
    });

    // Log activity
    await this.logActivity('training_completed', `${input.userName} completed ${input.trainingType}`, 'dguv');

    return record;
  }

  async getTrainingSummary() {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const allRecords = await prisma.trainingRecord.findMany();

    const expired = allRecords.filter(r => r.expiresAt < now).length;
    const expiringSoon = allRecords.filter(r => r.expiresAt >= now && r.expiresAt <= thirtyDaysFromNow).length;
    const valid = allRecords.filter(r => r.expiresAt > thirtyDaysFromNow).length;

    // Count unique users
    const uniqueUsers = new Set(allRecords.map(r => r.userId)).size;

    return {
      totalRecords: allRecords.length,
      totalEmployees: uniqueUsers,
      valid,
      expiringSoon,
      expired,
    };
  }

  // ==========================================================================
  // INSPECTION SCHEDULES (DGUV Vorschrift 3)
  // ==========================================================================

  async getInspectionSchedules(options?: { robotId?: string; inspectionType?: InspectionType; status?: 'current' | 'due_soon' | 'overdue' }) {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const schedules = await prisma.inspectionSchedule.findMany({
      where: {
        ...(options?.robotId && { robotId: options.robotId }),
        ...(options?.inspectionType && { inspectionType: options.inspectionType }),
      },
      orderBy: { nextDueDate: 'asc' },
    });

    return schedules
      .map(s => {
        const daysUntilDue = Math.ceil((s.nextDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        let status: 'current' | 'due_soon' | 'overdue';
        if (s.nextDueDate < now) status = 'overdue';
        else if (s.nextDueDate <= thirtyDaysFromNow) status = 'due_soon';
        else status = 'current';

        return { ...s, daysUntilDue, status };
      })
      .filter(s => !options?.status || s.status === options.status);
  }

  async createInspectionSchedule(input: InspectionScheduleInput) {
    return prisma.inspectionSchedule.create({
      data: {
        inspectionType: input.inspectionType,
        robotId: input.robotId,
        robotName: input.robotName,
        lastInspectionDate: input.lastInspectionDate,
        nextDueDate: input.nextDueDate,
        intervalYears: input.intervalYears,
        inspectorName: input.inspectorName,
        inspectorCompany: input.inspectorCompany,
        reportUrl: input.reportUrl,
        notes: input.notes,
      },
    });
  }

  async recordInspectionCompletion(id: string, reportUrl?: string, inspectorName?: string) {
    const schedule = await prisma.inspectionSchedule.findUnique({ where: { id } });
    if (!schedule) throw new Error('Inspection schedule not found');

    const now = new Date();
    const nextDueDate = new Date(now);
    nextDueDate.setFullYear(nextDueDate.getFullYear() + schedule.intervalYears);

    const updated = await prisma.inspectionSchedule.update({
      where: { id },
      data: {
        lastInspectionDate: now,
        nextDueDate,
        reportUrl: reportUrl || schedule.reportUrl,
        inspectorName: inspectorName || schedule.inspectorName,
      },
    });

    // Log activity
    await this.logActivity('inspection_done', `Inspection completed: ${schedule.inspectionType}`, 'dguv', id, 'inspection');

    return updated;
  }

  async getInspectionSummary() {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const allSchedules = await prisma.inspectionSchedule.findMany();

    const overdue = allSchedules.filter(s => s.nextDueDate < now).length;
    const dueSoon = allSchedules.filter(s => s.nextDueDate >= now && s.nextDueDate <= thirtyDaysFromNow).length;
    const current = allSchedules.filter(s => s.nextDueDate > thirtyDaysFromNow).length;

    // Find next inspection
    const nextInspection = allSchedules
      .filter(s => s.nextDueDate >= now)
      .sort((a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime())[0];

    return {
      totalScheduled: allSchedules.length,
      current,
      dueSoon,
      overdue,
      nextInspection: nextInspection ? {
        ...nextInspection,
        daysUntilDue: Math.ceil((nextInspection.nextDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      } : null,
    };
  }

  // ==========================================================================
  // RISK ASSESSMENTS
  // ==========================================================================

  async getRiskAssessments(options?: { assessmentType?: RiskAssessmentType; status?: 'current' | 'review_needed' | 'update_required' }) {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const assessments = await prisma.riskAssessment.findMany({
      where: {
        ...(options?.assessmentType && { assessmentType: options.assessmentType }),
      },
      orderBy: { nextReviewDate: 'asc' },
    });

    return assessments
      .map(a => {
        const daysUntilReview = Math.ceil((a.nextReviewDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        let status: 'current' | 'review_needed' | 'update_required';
        if (a.nextReviewDate < now) status = 'update_required';
        else if (a.nextReviewDate <= thirtyDaysFromNow) status = 'review_needed';
        else status = 'current';

        return { ...a, daysUntilReview, status };
      })
      .filter(a => !options?.status || a.status === options.status);
  }

  async createRiskAssessment(input: RiskAssessmentInput) {
    return prisma.riskAssessment.create({
      data: {
        assessmentType: input.assessmentType,
        name: input.name,
        version: input.version,
        description: input.description,
        lastUpdated: input.lastUpdated,
        nextReviewDate: input.nextReviewDate,
        triggerConditions: input.triggerConditions || [],
        triggeredUpdates: [],
        documentUrl: input.documentUrl,
        responsiblePerson: input.responsiblePerson,
      },
    });
  }

  async updateRiskAssessment(id: string, newVersion: string, nextReviewDate: Date, documentUrl?: string) {
    const assessment = await prisma.riskAssessment.findUnique({ where: { id } });
    if (!assessment) throw new Error('Risk assessment not found');

    const updated = await prisma.riskAssessment.update({
      where: { id },
      data: {
        version: newVersion,
        lastUpdated: new Date(),
        nextReviewDate,
        documentUrl: documentUrl || assessment.documentUrl,
        triggeredUpdates: [...assessment.triggeredUpdates, `Updated to ${newVersion} on ${new Date().toISOString()}`],
      },
    });

    // Log activity
    await this.logActivity('assessment_updated', `Risk assessment updated: ${assessment.name} v${newVersion}`, undefined, id, 'risk_assessment');

    return updated;
  }

  // ==========================================================================
  // ACTIVITY LOGGING
  // ==========================================================================

  async getRecentActivity(limit: number = 20) {
    return prisma.complianceActivity.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  private async logActivity(
    type: 'gap_closed' | 'document_renewed' | 'training_completed' | 'inspection_done' | 'assessment_updated',
    description: string,
    framework?: RegulatoryFramework,
    entityId?: string,
    entityType?: string,
    userId?: string,
    userName?: string,
  ) {
    await prisma.complianceActivity.create({
      data: {
        type,
        description,
        framework,
        entityId,
        entityType,
        userId,
        userName,
      },
    });
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize default regulatory deadlines
   */
  async initializeDefaults(): Promise<void> {
    const existingCount = await prisma.regulatoryDeadline.count();
    if (existingCount > 0) {
      console.log('[ComplianceTrackerService] Deadlines already exist, skipping initialization');
      return;
    }

    const defaultDeadlines: RegulatoryDeadlineInput[] = [
      {
        framework: 'nis2',
        name: 'NIS2 Entity Registration',
        deadline: new Date('2025-04-17'),
        description: 'Register as essential/important entity with national authority',
        requirements: [
          'Complete entity classification',
          'Submit registration to BSI/national authority',
          'Designate security officer',
          'Document critical systems',
        ],
        priority: 'critical',
      },
      {
        framework: 'red',
        name: 'RED EN 18031 Cybersecurity',
        deadline: new Date('2025-08-01'),
        description: 'Radio Equipment Directive cybersecurity requirements for connected devices',
        requirements: [
          'Implement EN 18031-1 (network protection)',
          'Implement EN 18031-2 (data protection)',
          'Implement EN 18031-3 (fraud protection)',
          'Update conformity assessment',
        ],
        priority: 'high',
      },
      {
        framework: 'machinery_regulation',
        name: 'Machinery Regulation Transition',
        deadline: new Date('2027-01-20'),
        description: 'New Machinery Regulation replaces Machinery Directive 2006/42/EC',
        requirements: [
          'Update risk assessment per new Annex III',
          'Implement AI-specific requirements',
          'Update technical file per Annex IV',
          'Review essential health and safety requirements',
          'Update instructions and markings',
        ],
        priority: 'high',
      },
      {
        framework: 'ai_act',
        name: 'EU AI Act High-Risk Compliance',
        deadline: new Date('2027-08-02'),
        description: 'Full compliance for high-risk AI systems',
        requirements: [
          'Complete conformity assessment',
          'Implement risk management system (Art. 9)',
          'Establish data governance (Art. 10)',
          'Maintain technical documentation (Art. 11)',
          'Enable record-keeping/logging (Art. 12)',
          'Ensure transparency (Art. 13)',
          'Implement human oversight (Art. 14)',
          'Ensure accuracy/robustness (Art. 15)',
        ],
        priority: 'critical',
      },
      {
        framework: 'cra',
        name: 'Cyber Resilience Act',
        deadline: new Date('2027-12-11'),
        description: 'Cybersecurity requirements for products with digital elements',
        requirements: [
          'Implement security by design',
          'Vulnerability handling process',
          'Software Bill of Materials (SBOM)',
          'Security update capability',
          'Incident reporting to ENISA',
        ],
        priority: 'high',
      },
    ];

    for (const deadline of defaultDeadlines) {
      await this.createRegulatoryDeadline(deadline);
    }

    console.log('[ComplianceTrackerService] Default regulatory deadlines initialized');
  }
}

// Export singleton instance
export const complianceTrackerService = new ComplianceTrackerService();
