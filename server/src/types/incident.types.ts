/**
 * @file incident.types.ts
 * @description Type definitions for incident reporting infrastructure
 * @feature incidents
 *
 * Implements incident types for regulatory compliance:
 * - EU AI Act Article 73 (Serious incident reporting)
 * - GDPR Articles 33-34 (Data breach notification)
 * - NIS2 Directive Article 23 (Incident reporting)
 * - CRA Article 14 (Vulnerability handling)
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export const IncidentTypes = [
  'safety',
  'security',
  'data_breach',
  'ai_malfunction',
  'vulnerability',
] as const;

export type IncidentType = (typeof IncidentTypes)[number];

export const IncidentSeverities = ['critical', 'high', 'medium', 'low'] as const;

export type IncidentSeverity = (typeof IncidentSeverities)[number];

export const IncidentStatuses = [
  'detected',
  'investigating',
  'contained',
  'resolved',
  'closed',
] as const;

export type IncidentStatus = (typeof IncidentStatuses)[number];

export const Authorities = [
  'ai_act_authority',
  'dpa',
  'data_subject',
  'csirt',
  'enisa',
] as const;

export type Authority = (typeof Authorities)[number];

export const Regulations = ['ai_act', 'gdpr', 'nis2', 'cra'] as const;

export type Regulation = (typeof Regulations)[number];

export const NotificationTypes = [
  'early_warning',
  'initial',
  'intermediate',
  'final',
] as const;

export type NotificationType = (typeof NotificationTypes)[number];

export const NotificationStatuses = [
  'pending',
  'draft',
  'sent',
  'acknowledged',
  'overdue',
] as const;

export type NotificationStatus = (typeof NotificationStatuses)[number];

// ============================================================================
// NOTIFICATION TIMELINE CONSTANTS
// ============================================================================

/**
 * Regulatory notification deadlines in hours
 */
export const NOTIFICATION_TIMELINES: Record<
  Regulation,
  Record<string, { deadlineHours: number; type: NotificationType; authority: Authority }>
> = {
  ai_act: {
    serious_incident: { deadlineHours: 2 * 24, type: 'initial', authority: 'ai_act_authority' },
    safety_risk: { deadlineHours: 10 * 24, type: 'initial', authority: 'ai_act_authority' },
    standard: { deadlineHours: 15 * 24, type: 'initial', authority: 'ai_act_authority' },
  },
  gdpr: {
    dpa_notification: { deadlineHours: 72, type: 'initial', authority: 'dpa' },
    data_subject_high_risk: { deadlineHours: 0, type: 'initial', authority: 'data_subject' },
  },
  nis2: {
    early_warning: { deadlineHours: 24, type: 'early_warning', authority: 'csirt' },
    notification: { deadlineHours: 72, type: 'initial', authority: 'csirt' },
    final_report: { deadlineHours: 30 * 24, type: 'final', authority: 'csirt' },
  },
  cra: {
    vulnerability: { deadlineHours: 24, type: 'initial', authority: 'enisa' },
  },
};

// ============================================================================
// RISK ASSESSMENT TYPES
// ============================================================================

/**
 * Impact levels for risk assessment
 */
export const ImpactLevels = ['negligible', 'minor', 'moderate', 'major', 'severe'] as const;

export type ImpactLevel = (typeof ImpactLevels)[number];

/**
 * Likelihood levels for risk assessment
 */
export const LikelihoodLevels = ['rare', 'unlikely', 'possible', 'likely', 'certain'] as const;

export type LikelihoodLevel = (typeof LikelihoodLevels)[number];

/**
 * Risk assessment result
 */
export interface RiskAssessment {
  incidentId: string;
  impactLevel: ImpactLevel;
  likelihoodLevel: LikelihoodLevel;
  riskScore: number; // 0-100
  affectedDataSubjects: number;
  dataCategories: string[];
  potentialHarm: string[];
  mitigatingFactors: string[];
  assessedAt: Date;
  assessedBy?: string;
}

/**
 * Risk matrix entry
 */
export interface RiskMatrixEntry {
  impact: ImpactLevel;
  likelihood: LikelihoodLevel;
  score: number;
  severity: IncidentSeverity;
}

// ============================================================================
// INCIDENT TYPES
// ============================================================================

/**
 * System state snapshot captured at incident time
 */
export interface SystemSnapshot {
  capturedAt: Date;
  robots: Array<{
    id: string;
    name: string;
    status: string;
    location?: { x: number; y: number; z: number };
    operatingMode?: string;
    batteryLevel?: number;
    currentTask?: string;
  }>;
  activeAlerts: Array<{
    id: string;
    severity: string;
    title: string;
  }>;
  systemHealth: {
    serverUptime: number;
    connectedRobots: number;
    activeWebSockets: number;
  };
}

/**
 * Incident entity
 */
export interface Incident {
  id: string;
  incidentNumber: string;

  // Classification
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;

  // Description
  title: string;
  description: string;
  rootCause: string | null;
  resolution: string | null;

  // Risk Assessment
  riskScore: number | null;
  affectedDataSubjects: number | null;
  dataCategories: string[];

  // Timestamps
  detectedAt: Date;
  containedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;

  // Evidence Links
  robotId: string | null;
  complianceLogIds: string[];
  alertIds: string[];

  // System State Snapshot
  systemSnapshot: SystemSnapshot | null;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;

  // Relations (optional, when joined)
  notifications?: IncidentNotification[];
}

/**
 * Incident notification entity
 */
export interface IncidentNotification {
  id: string;
  incidentId: string;

  // Authority & Regulation
  authority: Authority;
  regulation: Regulation;

  // Notification Type & Deadline
  notificationType: NotificationType;
  deadlineHours: number;
  dueAt: Date;

  // Status
  status: NotificationStatus;
  sentAt: Date | null;
  acknowledgedAt: Date | null;

  // Content
  templateId: string | null;
  content: string | null;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  sentBy: string | null;
}

/**
 * Notification template entity
 */
export interface NotificationTemplate {
  id: string;
  name: string;
  regulation: Regulation;
  authority: Authority;
  type: NotificationType;
  subject: string;
  body: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

/**
 * Input for creating an incident
 */
export interface CreateIncidentInput {
  type: IncidentType;
  severity?: IncidentSeverity;
  title: string;
  description: string;
  robotId?: string;
  complianceLogIds?: string[];
  alertIds?: string[];
  detectedAt?: Date;
  createdBy?: string;
}

/**
 * Input for updating an incident
 */
export interface UpdateIncidentInput {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  title?: string;
  description?: string;
  rootCause?: string;
  resolution?: string;
  riskScore?: number;
  affectedDataSubjects?: number;
  dataCategories?: string[];
  containedAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
}

/**
 * Input for creating a notification
 */
export interface CreateNotificationInput {
  incidentId: string;
  authority: Authority;
  regulation: Regulation;
  notificationType: NotificationType;
  deadlineHours: number;
  dueAt: Date;
  templateId?: string;
  content?: string;
}

/**
 * Input for updating a notification
 */
export interface UpdateNotificationInput {
  status?: NotificationStatus;
  content?: string;
  sentAt?: Date;
  acknowledgedAt?: Date;
  sentBy?: string;
}

/**
 * Input for creating a notification template
 */
export interface CreateTemplateInput {
  name: string;
  regulation: Regulation;
  authority: Authority;
  type: NotificationType;
  subject: string;
  body: string;
  isDefault?: boolean;
}

/**
 * Input for updating a notification template
 */
export interface UpdateTemplateInput {
  name?: string;
  subject?: string;
  body?: string;
  isDefault?: boolean;
}

// ============================================================================
// TRIGGER TYPES
// ============================================================================

/**
 * Safety event trigger for auto-detection
 */
export interface SafetyEventTrigger {
  type: 'safety';
  eventType: 'emergency_stop' | 'protective_stop' | 'force_limit' | 'speed_limit' | 'zone_violation';
  robotId: string;
  robotName?: string;
  reason: string;
  severity: 'critical' | 'high' | 'medium';
  complianceLogId?: string;
  alertId?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Union type for all incident triggers
 */
export type IncidentTrigger = SafetyEventTrigger;

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query parameters for listing incidents
 */
export interface IncidentQueryParams {
  page?: number;
  limit?: number;
  type?: IncidentType | IncidentType[];
  severity?: IncidentSeverity | IncidentSeverity[];
  status?: IncidentStatus | IncidentStatus[];
  robotId?: string;
  startDate?: Date;
  endDate?: Date;
  sortBy?: 'detectedAt' | 'severity' | 'status' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated response for incidents
 */
export interface IncidentListResponse {
  incidents: Incident[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Query parameters for notifications
 */
export interface NotificationQueryParams {
  incidentId?: string;
  status?: NotificationStatus | NotificationStatus[];
  regulation?: Regulation;
  authority?: Authority;
  overdue?: boolean;
}

// ============================================================================
// DASHBOARD TYPES
// ============================================================================

/**
 * Incident dashboard statistics
 */
export interface IncidentDashboardStats {
  totalIncidents: number;
  openIncidents: number;
  incidentsBySeverity: Record<IncidentSeverity, number>;
  incidentsByType: Record<IncidentType, number>;
  incidentsByStatus: Record<IncidentStatus, number>;
  overdueNotifications: number;
  pendingNotifications: number;
  recentIncidents: Incident[];
  averageResolutionTimeHours: number | null;
}

/**
 * Notification timeline for an incident
 */
export interface NotificationTimeline {
  incidentId: string;
  incidentNumber: string;
  detectedAt: Date;
  notifications: Array<
    IncidentNotification & {
      hoursRemaining: number;
      isOverdue: boolean;
    }
  >;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Incident event types for WebSocket broadcasting
 */
export type IncidentEventType =
  | 'incident_created'
  | 'incident_updated'
  | 'notification_created'
  | 'notification_sent'
  | 'notification_overdue';

/**
 * Incident event payload
 */
export interface IncidentEvent {
  type: IncidentEventType;
  incident?: Incident;
  notification?: IncidentNotification;
  timestamp: Date;
}

/**
 * Callback for incident events
 */
export type IncidentEventCallback = (event: IncidentEvent) => void;
