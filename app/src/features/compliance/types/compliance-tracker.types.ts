/**
 * @file compliance-tracker.types.ts
 * @description Type definitions for compliance monitoring dashboard
 * @feature compliance
 *
 * Regulatory frameworks tracked:
 * - EU AI Act (August 2027)
 * - Machinery Regulation (January 2027)
 * - GDPR (ongoing)
 * - NIS2 (April 2025)
 * - CRA - Cyber Resilience Act (December 2027)
 * - RED - Radio Equipment Directive EN 18031 (August 2025)
 * - DGUV - German occupational safety (ongoing)
 */

// ============================================================================
// REGULATORY FRAMEWORK TYPES
// ============================================================================

/**
 * All regulatory frameworks tracked by the system
 */
export type RegulatoryFramework =
  | 'ai_act'
  | 'machinery_regulation'
  | 'gdpr'
  | 'nis2'
  | 'cra'
  | 'red'
  | 'dguv';

/**
 * Human-readable labels for regulatory frameworks
 */
export const RegulatoryFrameworkLabels: Record<RegulatoryFramework, string> = {
  ai_act: 'EU AI Act',
  machinery_regulation: 'Machinery Regulation',
  gdpr: 'GDPR',
  nis2: 'NIS2 Directive',
  cra: 'Cyber Resilience Act',
  red: 'Radio Equipment Directive',
  dguv: 'DGUV (German Occupational Safety)',
};

/**
 * Compliance status for a deadline or requirement
 */
export type ComplianceStatus =
  | 'compliant'
  | 'in_progress'
  | 'at_risk'
  | 'overdue'
  | 'not_started'
  | 'not_applicable';

/**
 * Status labels with colors (light mode)
 */
export const ComplianceStatusConfig: Record<
  ComplianceStatus,
  { label: string; color: string; bgColor: string; textColor: string }
> = {
  compliant: { label: 'Compliant', color: 'text-green-600', bgColor: 'bg-green-900/20', textColor: 'text-green-400' },
  in_progress: { label: 'In Progress', color: 'text-blue-600', bgColor: 'bg-blue-900/20', textColor: 'text-blue-400' },
  at_risk: { label: 'At Risk', color: 'text-amber-600', bgColor: 'bg-amber-900/20', textColor: 'text-amber-400' },
  overdue: { label: 'Overdue', color: 'text-red-600', bgColor: 'bg-red-900/20', textColor: 'text-red-400' },
  not_started: { label: 'Not Started', color: 'text-gray-600', bgColor: 'bg-gray-800/50', textColor: 'text-gray-400' },
  not_applicable: { label: 'N/A', color: 'text-gray-400', bgColor: 'bg-gray-800/30', textColor: 'text-gray-500' },
};

// Alias for backwards compatibility
export const REGULATORY_FRAMEWORK_LABELS = RegulatoryFrameworkLabels;
export const COMPLIANCE_STATUS_CONFIG = ComplianceStatusConfig;

// ============================================================================
// REGULATORY DEADLINE TYPES
// ============================================================================

/**
 * A specific regulatory deadline with requirements tracking
 */
export interface RegulatoryDeadline {
  id: string;
  framework: RegulatoryFramework;
  name: string;
  deadline: string; // ISO date
  description: string;
  status: ComplianceStatus;
  requirements: string[];
  completedRequirements: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  daysUntilDeadline: number;
}

/**
 * Pre-defined regulatory deadlines
 */
export const REGULATORY_DEADLINES: Omit<RegulatoryDeadline, 'id' | 'status' | 'completedRequirements' | 'daysUntilDeadline'>[] = [
  {
    framework: 'nis2',
    name: 'NIS2 Entity Registration',
    deadline: '2025-04-17',
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
    deadline: '2025-08-01',
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
    deadline: '2027-01-20',
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
    deadline: '2027-08-02',
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
    deadline: '2027-12-11',
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

// ============================================================================
// GAP ANALYSIS TYPES
// ============================================================================

/**
 * Severity levels for compliance gaps
 */
export type GapSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Gap severity configuration with colors
 */
export const GapSeverityConfig: Record<
  GapSeverity,
  { label: string; bgColor: string; textColor: string }
> = {
  critical: { label: 'Critical', bgColor: 'bg-red-900/20', textColor: 'text-red-400' },
  high: { label: 'High', bgColor: 'bg-orange-900/20', textColor: 'text-orange-400' },
  medium: { label: 'Medium', bgColor: 'bg-yellow-900/20', textColor: 'text-yellow-400' },
  low: { label: 'Low', bgColor: 'bg-blue-900/20', textColor: 'text-blue-400' },
};

// Alias for uppercase constant naming convention
export const GAP_SEVERITY_CONFIG = GapSeverityConfig;

/**
 * A compliance gap identified through gap analysis
 */
export interface ComplianceGap {
  id: string;
  framework: RegulatoryFramework;
  requirement: string;
  articleReference: string; // e.g., "Art. 12" or "Annex IV.2"
  severity: GapSeverity;
  description: string;
  currentState: string;
  targetState: string;
  remediation: string;
  estimatedEffort: 'low' | 'medium' | 'high';
  dueDate?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Gap analysis summary for a framework
 */
export interface GapAnalysisSummary {
  framework: RegulatoryFramework;
  totalGaps: number;
  criticalGaps: number;
  highGaps: number;
  mediumGaps: number;
  lowGaps: number;
  closedGaps: number;
  complianceScore: number; // 0-100
}

// ============================================================================
// DOCUMENT EXPIRY TYPES
// ============================================================================

/**
 * Document expiry status
 */
export type DocumentExpiryStatus = 'valid' | 'expiring_soon' | 'expired';

/**
 * A document with expiry tracking
 */
export interface DocumentExpiry {
  id: string;
  documentType: string;
  name: string;
  description?: string;
  expiryDate: string;
  daysUntilExpiry: number;
  status: DocumentExpiryStatus;
  framework: RegulatoryFramework;
  documentUrl?: string;
  renewalUrl?: string;
  lastReviewedAt?: string;
  reviewedBy?: string;
}

// ============================================================================
// TRAINING COMPLIANCE TYPES (DGUV)
// ============================================================================

/**
 * Types of required training for robot operators
 */
export type TrainingType =
  | 'operator_competence'
  | 'safety_training'
  | 'emergency_response'
  | 'first_aid'
  | 'maintenance_training';

/**
 * Human-readable training type labels
 */
export const TrainingTypeLabels: Record<TrainingType, string> = {
  operator_competence: 'Operator Competence (DGUV)',
  safety_training: 'Safety Training',
  emergency_response: 'Emergency Response',
  first_aid: 'First Aid Certification',
  maintenance_training: 'Maintenance Training',
};

// Alias for uppercase constant naming convention
export const TRAINING_TYPE_LABELS = TrainingTypeLabels;

/**
 * Training expiry status
 */
export type TrainingStatus = 'valid' | 'expiring_soon' | 'expired';

/**
 * A training record for an employee
 */
export interface TrainingRecord {
  id: string;
  userId: string;
  userName: string;
  userEmail?: string;
  trainingType: TrainingType;
  completedAt: string;
  expiresAt: string;
  certificateUrl?: string;
  trainingProvider?: string;
  status: TrainingStatus;
  daysUntilExpiry: number;
}

/**
 * Training compliance summary
 */
export interface TrainingComplianceSummary {
  totalEmployees: number;
  fullyCompliant: number;
  partiallyCompliant: number;
  nonCompliant: number;
  expiringWithin30Days: number;
  expiredTrainings: number;
}

// ============================================================================
// INSPECTION SCHEDULE TYPES (DGUV Vorschrift 3)
// ============================================================================

/**
 * Types of required inspections
 */
export type InspectionType =
  | 'electrical'
  | 'force_verification'
  | 'biomechanical'
  | 'safety_function'
  | 'protective_device';

/**
 * Inspection type configuration
 */
export const InspectionTypeConfig: Record<
  InspectionType,
  { label: string; intervalYears: number; regulation: string }
> = {
  electrical: {
    label: 'Electrical Safety Inspection',
    intervalYears: 4,
    regulation: 'DGUV Vorschrift 3',
  },
  force_verification: {
    label: 'Force/Torque Verification',
    intervalYears: 1,
    regulation: 'ISO/TS 15066',
  },
  biomechanical: {
    label: 'Biomechanical Risk Assessment',
    intervalYears: 1,
    regulation: 'ISO/TS 15066',
  },
  safety_function: {
    label: 'Safety Function Test',
    intervalYears: 1,
    regulation: 'ISO 10218-1',
  },
  protective_device: {
    label: 'Protective Device Inspection',
    intervalYears: 1,
    regulation: 'ISO 10218-2',
  },
};

/**
 * Human-readable inspection type labels (shorthand)
 */
export const InspectionTypeLabels: Record<InspectionType, string> = Object.fromEntries(
  Object.entries(InspectionTypeConfig).map(([key, value]) => [key, value.label])
) as Record<InspectionType, string>;

// Alias for uppercase constant naming convention
export const INSPECTION_TYPE_LABELS = InspectionTypeLabels;

/**
 * Inspection status
 */
export type InspectionStatus = 'current' | 'due_soon' | 'overdue';

/**
 * An inspection schedule entry
 */
export interface InspectionSchedule {
  id: string;
  inspectionType: InspectionType;
  robotId?: string;
  robotName?: string;
  lastInspectionDate: string;
  nextDueDate: string;
  intervalYears: number;
  inspectorName?: string;
  inspectorCompany?: string;
  reportUrl?: string;
  status: InspectionStatus;
  daysUntilDue: number;
  notes?: string;
}

/**
 * Inspection schedule summary
 */
export interface InspectionScheduleSummary {
  totalScheduled: number;
  current: number;
  dueSoon: number;
  overdue: number;
  nextInspection?: InspectionSchedule;
}

// ============================================================================
// RISK ASSESSMENT TYPES
// ============================================================================

/**
 * Types of risk assessments
 */
export type RiskAssessmentType =
  | 'ai_risk'
  | 'machinery_risk'
  | 'dpia'
  | 'cybersecurity'
  | 'occupational';

/**
 * Risk assessment type labels
 */
export const RiskAssessmentTypeLabels: Record<RiskAssessmentType, string> = {
  ai_risk: 'AI Risk Management (Art. 9)',
  machinery_risk: 'Machinery Risk Assessment (ISO 12100)',
  dpia: 'Data Protection Impact Assessment',
  cybersecurity: 'Cybersecurity Risk Assessment',
  occupational: 'Occupational Risk Assessment (DGUV)',
};

// Alias for uppercase constant naming convention
export const RISK_ASSESSMENT_TYPE_LABELS = RiskAssessmentTypeLabels;

/**
 * Risk assessment status
 */
export type RiskAssessmentStatus = 'current' | 'review_needed' | 'update_required';

/**
 * A risk assessment tracking entry
 */
export interface RiskAssessmentTracking {
  id: string;
  assessmentType: RiskAssessmentType;
  name: string;
  version: string;
  description?: string;
  lastUpdated: string;
  nextReviewDate: string;
  triggerConditions: string[];
  triggeredUpdates: string[];
  documentUrl?: string;
  status: RiskAssessmentStatus;
  daysUntilReview: number;
  responsiblePerson?: string;
}

/**
 * Conditions that trigger risk assessment updates
 */
export const RISK_ASSESSMENT_TRIGGERS = [
  'Significant change to AI model',
  'New robot deployment',
  'Safety incident occurred',
  'Change in intended use',
  'New vulnerability discovered',
  'Regulatory requirement update',
  'Annual review deadline',
  'Change in operating environment',
] as const;

// ============================================================================
// DASHBOARD STATS TYPES
// ============================================================================

/**
 * Per-framework compliance score
 */
export interface FrameworkScore {
  framework: RegulatoryFramework;
  score: number; // 0-100
  status: ComplianceStatus;
  openItems: number;
  totalItems: number;
}

/**
 * Alert counts for dashboard
 */
export interface ComplianceAlerts {
  criticalGaps: number;
  expiringDocuments: number;
  overdueTraining: number;
  overdueInspections: number;
  upcomingDeadlines: number;
  pendingRiskReviews: number;
}

/**
 * Overall compliance dashboard statistics
 */
export interface ComplianceDashboardStats {
  overallScore: number; // 0-100
  frameworkScores: FrameworkScore[];
  alerts: ComplianceAlerts;
  recentActivity: ComplianceActivity[];
  lastUpdated: string;
}

/**
 * A recent compliance activity for the feed
 */
export interface ComplianceActivity {
  id: string;
  type: 'gap_closed' | 'document_renewed' | 'training_completed' | 'inspection_done' | 'assessment_updated';
  description: string;
  framework?: RegulatoryFramework;
  timestamp: string;
  userId?: string;
  userName?: string;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Query parameters for gap analysis
 */
export interface GapAnalysisQuery {
  framework?: RegulatoryFramework;
  severity?: GapSeverity;
  status?: 'open' | 'closed' | 'all';
}

/**
 * Query parameters for document expiry
 */
export interface DocumentExpiryQuery {
  framework?: RegulatoryFramework;
  status?: DocumentExpiryStatus;
  withinDays?: number; // Filter to documents expiring within N days
}

/**
 * Query parameters for training records
 */
export interface TrainingRecordQuery {
  userId?: string;
  trainingType?: TrainingType;
  status?: TrainingStatus;
}

/**
 * Query parameters for inspection schedules
 */
export interface InspectionScheduleQuery {
  robotId?: string;
  inspectionType?: InspectionType;
  status?: InspectionStatus;
}

/**
 * Query parameters for risk assessments
 */
export interface RiskAssessmentQuery {
  assessmentType?: RiskAssessmentType;
  status?: RiskAssessmentStatus;
}

/**
 * Report generation options
 */
export interface ComplianceReportOptions {
  framework?: RegulatoryFramework;
  includeGaps?: boolean;
  includeDocuments?: boolean;
  includeTraining?: boolean;
  includeInspections?: boolean;
  includeRiskAssessments?: boolean;
  format: 'pdf' | 'html' | 'json';
}

/**
 * Generated compliance report
 */
export interface ComplianceReport {
  id: string;
  generatedAt: string;
  generatedBy: string;
  options: ComplianceReportOptions;
  downloadUrl: string;
  expiresAt: string;
}
