/**
 * @file BreachAssessmentService.ts
 * @description Service for incident risk assessment and severity classification
 * @feature incidents
 *
 * Implements risk scoring per regulatory requirements:
 * - GDPR Art. 33-34 (Breach likelihood and severity assessment)
 * - EU AI Act Art. 73 (Serious incident classification)
 */

import type {
  Incident,
  IncidentSeverity,
  IncidentType,
  RiskAssessment,
  ImpactLevel,
  LikelihoodLevel,
  RiskMatrixEntry,
  Authority,
  Regulation,
  NotificationType,
} from '../types/incident.types.js';
import { incidentRepository } from '../repositories/IncidentRepository.js';

// ============================================================================
// RISK MATRIX CONFIGURATION
// ============================================================================

/**
 * Risk matrix: Impact x Likelihood = Score
 * Score ranges: 0-20 (low), 21-50 (medium), 51-75 (high), 76-100 (critical)
 */
const RISK_MATRIX: RiskMatrixEntry[] = [
  // Negligible impact
  { impact: 'negligible', likelihood: 'rare', score: 5, severity: 'low' },
  { impact: 'negligible', likelihood: 'unlikely', score: 10, severity: 'low' },
  { impact: 'negligible', likelihood: 'possible', score: 15, severity: 'low' },
  { impact: 'negligible', likelihood: 'likely', score: 20, severity: 'low' },
  { impact: 'negligible', likelihood: 'certain', score: 25, severity: 'medium' },

  // Minor impact
  { impact: 'minor', likelihood: 'rare', score: 10, severity: 'low' },
  { impact: 'minor', likelihood: 'unlikely', score: 20, severity: 'low' },
  { impact: 'minor', likelihood: 'possible', score: 30, severity: 'medium' },
  { impact: 'minor', likelihood: 'likely', score: 40, severity: 'medium' },
  { impact: 'minor', likelihood: 'certain', score: 50, severity: 'medium' },

  // Moderate impact
  { impact: 'moderate', likelihood: 'rare', score: 20, severity: 'low' },
  { impact: 'moderate', likelihood: 'unlikely', score: 35, severity: 'medium' },
  { impact: 'moderate', likelihood: 'possible', score: 50, severity: 'medium' },
  { impact: 'moderate', likelihood: 'likely', score: 60, severity: 'high' },
  { impact: 'moderate', likelihood: 'certain', score: 70, severity: 'high' },

  // Major impact
  { impact: 'major', likelihood: 'rare', score: 40, severity: 'medium' },
  { impact: 'major', likelihood: 'unlikely', score: 55, severity: 'high' },
  { impact: 'major', likelihood: 'possible', score: 70, severity: 'high' },
  { impact: 'major', likelihood: 'likely', score: 80, severity: 'critical' },
  { impact: 'major', likelihood: 'certain', score: 90, severity: 'critical' },

  // Severe impact
  { impact: 'severe', likelihood: 'rare', score: 60, severity: 'high' },
  { impact: 'severe', likelihood: 'unlikely', score: 75, severity: 'high' },
  { impact: 'severe', likelihood: 'possible', score: 85, severity: 'critical' },
  { impact: 'severe', likelihood: 'likely', score: 95, severity: 'critical' },
  { impact: 'severe', likelihood: 'certain', score: 100, severity: 'critical' },
];

/**
 * Data categories with sensitivity weights (0-1)
 */
const DATA_CATEGORY_WEIGHTS: Record<string, number> = {
  // Special categories (GDPR Art. 9)
  health: 1.0,
  biometric: 1.0,
  genetic: 1.0,
  political: 0.9,
  religious: 0.9,
  ethnic: 0.9,
  sexual: 0.9,
  trade_union: 0.8,

  // Standard personal data
  financial: 0.8,
  location: 0.7,
  communications: 0.7,
  behavioral: 0.6,
  contact: 0.5,
  identification: 0.5,
  employment: 0.4,
  preferences: 0.3,

  // Non-personal
  operational: 0.1,
  technical: 0.1,
};

/**
 * Notification requirements by incident type and severity
 */
interface NotificationRequirement {
  regulation: Regulation;
  authority: Authority;
  notificationType: NotificationType;
  deadlineHours: number;
  condition?: (incident: Incident, assessment: RiskAssessment) => boolean;
}

const NOTIFICATION_REQUIREMENTS: NotificationRequirement[] = [
  // AI Act notifications
  {
    regulation: 'ai_act',
    authority: 'ai_act_authority',
    notificationType: 'initial',
    deadlineHours: 2 * 24, // 2 days for serious incidents
    condition: (incident, assessment) =>
      incident.type === 'ai_malfunction' && assessment.riskScore >= 76,
  },
  {
    regulation: 'ai_act',
    authority: 'ai_act_authority',
    notificationType: 'initial',
    deadlineHours: 10 * 24, // 10 days for safety risks
    condition: (incident) => incident.type === 'safety',
  },
  {
    regulation: 'ai_act',
    authority: 'ai_act_authority',
    notificationType: 'initial',
    deadlineHours: 15 * 24, // 15 days standard
    condition: (incident) =>
      incident.type === 'ai_malfunction' && incident.severity !== 'critical',
  },

  // GDPR notifications
  {
    regulation: 'gdpr',
    authority: 'dpa',
    notificationType: 'initial',
    deadlineHours: 72, // 72 hours to DPA
    condition: (incident) => incident.type === 'data_breach',
  },
  {
    regulation: 'gdpr',
    authority: 'data_subject',
    notificationType: 'initial',
    deadlineHours: 0, // Without undue delay for high risk
    condition: (incident, assessment) =>
      incident.type === 'data_breach' && assessment.riskScore >= 51,
  },

  // NIS2 notifications
  {
    regulation: 'nis2',
    authority: 'csirt',
    notificationType: 'early_warning',
    deadlineHours: 24, // 24h early warning
    condition: (incident) => incident.type === 'security',
  },
  {
    regulation: 'nis2',
    authority: 'csirt',
    notificationType: 'initial',
    deadlineHours: 72, // 72h notification
    condition: (incident) => incident.type === 'security',
  },
  {
    regulation: 'nis2',
    authority: 'csirt',
    notificationType: 'final',
    deadlineHours: 30 * 24, // 1 month final report
    condition: (incident) => incident.type === 'security',
  },

  // CRA notifications
  {
    regulation: 'cra',
    authority: 'enisa',
    notificationType: 'initial',
    deadlineHours: 24, // 24h for exploited vulnerabilities
    condition: (incident) => incident.type === 'vulnerability',
  },
];

// ============================================================================
// BREACH ASSESSMENT SERVICE
// ============================================================================

/**
 * BreachAssessmentService - Assesses incident risk and determines notification requirements
 */
export class BreachAssessmentService {
  // ============================================================================
  // RISK ASSESSMENT
  // ============================================================================

  /**
   * Assess risk for an incident
   */
  async assessRisk(incidentId: string, assessedBy?: string): Promise<RiskAssessment> {
    const incident = await incidentRepository.findById(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    // Determine impact level based on incident characteristics
    const impactLevel = this.calculateImpactLevel(incident);

    // Determine likelihood based on incident type and current status
    const likelihoodLevel = this.calculateLikelihoodLevel(incident);

    // Calculate risk score from matrix
    const riskScore = this.calculateRiskScore(impactLevel, likelihoodLevel);

    // Identify potential harm
    const potentialHarm = this.identifyPotentialHarm(incident);

    // Identify mitigating factors
    const mitigatingFactors = this.identifyMitigatingFactors(incident);

    const assessment: RiskAssessment = {
      incidentId,
      impactLevel,
      likelihoodLevel,
      riskScore,
      affectedDataSubjects: incident.affectedDataSubjects ?? 0,
      dataCategories: incident.dataCategories,
      potentialHarm,
      mitigatingFactors,
      assessedAt: new Date(),
      assessedBy,
    };

    // Update incident with risk score
    await incidentRepository.update(incidentId, { riskScore });

    return assessment;
  }

  /**
   * Calculate impact level based on incident characteristics
   */
  private calculateImpactLevel(incident: Incident): ImpactLevel {
    let score = 0;

    // Factor 1: Number of affected data subjects
    const subjects = incident.affectedDataSubjects ?? 0;
    if (subjects === 0) score += 0;
    else if (subjects < 10) score += 10;
    else if (subjects < 100) score += 25;
    else if (subjects < 1000) score += 50;
    else if (subjects < 10000) score += 75;
    else score += 100;

    // Factor 2: Sensitivity of data categories
    const maxSensitivity = Math.max(
      0,
      ...incident.dataCategories.map((cat) => DATA_CATEGORY_WEIGHTS[cat.toLowerCase()] ?? 0.5)
    );
    score += maxSensitivity * 50;

    // Factor 3: Incident type severity
    const typeSeverity: Record<IncidentType, number> = {
      safety: 80,
      data_breach: 60,
      ai_malfunction: 50,
      security: 40,
      vulnerability: 30,
    };
    score += (typeSeverity[incident.type] ?? 40) * 0.5;

    // Factor 4: Current severity classification
    const severityBonus: Record<IncidentSeverity, number> = {
      critical: 30,
      high: 20,
      medium: 10,
      low: 0,
    };
    score += severityBonus[incident.severity];

    // Normalize to 0-100
    const normalizedScore = Math.min(100, score / 2.8);

    // Map to impact level
    if (normalizedScore < 20) return 'negligible';
    if (normalizedScore < 40) return 'minor';
    if (normalizedScore < 60) return 'moderate';
    if (normalizedScore < 80) return 'major';
    return 'severe';
  }

  /**
   * Calculate likelihood level based on incident status and type
   */
  private calculateLikelihoodLevel(incident: Incident): LikelihoodLevel {
    // For detected incidents, likelihood is based on harm materialization
    // If already contained/resolved, likelihood of further harm is lower

    switch (incident.status) {
      case 'closed':
      case 'resolved':
        return 'rare';
      case 'contained':
        return 'unlikely';
      case 'investigating':
        return 'possible';
      case 'detected':
      default:
        // For newly detected, base on type
        switch (incident.type) {
          case 'data_breach':
            return 'likely'; // Data may already be exposed
          case 'safety':
            return 'certain'; // Safety event has occurred
          case 'ai_malfunction':
            return 'likely';
          case 'security':
            return 'possible';
          case 'vulnerability':
            return 'unlikely'; // Exploitability uncertain
          default:
            return 'possible';
        }
    }
  }

  /**
   * Calculate risk score from impact and likelihood
   */
  private calculateRiskScore(impact: ImpactLevel, likelihood: LikelihoodLevel): number {
    const entry = RISK_MATRIX.find((e) => e.impact === impact && e.likelihood === likelihood);
    return entry?.score ?? 50;
  }

  /**
   * Identify potential harm based on incident type
   */
  private identifyPotentialHarm(incident: Incident): string[] {
    const harm: string[] = [];

    switch (incident.type) {
      case 'safety':
        harm.push('Physical injury to personnel');
        harm.push('Equipment damage');
        harm.push('Operational disruption');
        break;
      case 'data_breach':
        harm.push('Identity theft or fraud');
        harm.push('Financial loss');
        harm.push('Reputational damage');
        if (
          incident.dataCategories.some((c) =>
            ['health', 'biometric', 'genetic'].includes(c.toLowerCase())
          )
        ) {
          harm.push('Discrimination based on sensitive data');
        }
        break;
      case 'ai_malfunction':
        harm.push('Incorrect automated decisions');
        harm.push('Loss of service availability');
        harm.push('Regulatory non-compliance');
        break;
      case 'security':
        harm.push('Unauthorized access to systems');
        harm.push('Data exfiltration');
        harm.push('Service disruption');
        break;
      case 'vulnerability':
        harm.push('Potential exploitation');
        harm.push('System compromise');
        break;
    }

    return harm;
  }

  /**
   * Identify mitigating factors
   */
  private identifyMitigatingFactors(incident: Incident): string[] {
    const factors: string[] = [];

    // Status-based mitigations
    if (incident.status === 'contained') {
      factors.push('Incident has been contained');
    }
    if (incident.status === 'resolved' || incident.status === 'closed') {
      factors.push('Incident has been resolved');
    }

    // Time-based mitigations
    const hoursOpen =
      (new Date().getTime() - new Date(incident.detectedAt).getTime()) / (1000 * 60 * 60);
    if (hoursOpen < 1) {
      factors.push('Rapid detection and response');
    }

    // If root cause identified
    if (incident.rootCause) {
      factors.push('Root cause has been identified');
    }

    // If resolution documented
    if (incident.resolution) {
      factors.push('Resolution has been documented');
    }

    return factors;
  }

  // ============================================================================
  // SEVERITY CLASSIFICATION
  // ============================================================================

  /**
   * Classify incident severity based on risk score
   */
  classifySeverity(riskScore: number): IncidentSeverity {
    if (riskScore >= 76) return 'critical';
    if (riskScore >= 51) return 'high';
    if (riskScore >= 21) return 'medium';
    return 'low';
  }

  /**
   * Get severity from risk matrix
   */
  getSeverityFromMatrix(impact: ImpactLevel, likelihood: LikelihoodLevel): IncidentSeverity {
    const entry = RISK_MATRIX.find((e) => e.impact === impact && e.likelihood === likelihood);
    return entry?.severity ?? 'medium';
  }

  // ============================================================================
  // NOTIFICATION REQUIREMENTS
  // ============================================================================

  /**
   * Determine required notifications based on incident and risk assessment
   */
  determineNotificationRequirements(
    incident: Incident,
    assessment: RiskAssessment
  ): NotificationRequirement[] {
    return NOTIFICATION_REQUIREMENTS.filter((req) => {
      // If no condition, always include
      if (!req.condition) return true;
      // Otherwise, check condition
      return req.condition(incident, assessment);
    });
  }

  // ============================================================================
  // RISK MATRIX ACCESS
  // ============================================================================

  /**
   * Get the full risk matrix for reference
   */
  getRiskMatrix(): RiskMatrixEntry[] {
    return [...RISK_MATRIX];
  }

  /**
   * Get data category weights
   */
  getDataCategoryWeights(): Record<string, number> {
    return { ...DATA_CATEGORY_WEIGHTS };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const breachAssessmentService = new BreachAssessmentService();
