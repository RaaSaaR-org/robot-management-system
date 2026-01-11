/**
 * @file incidents.types.ts
 * @description TypeScript type definitions for the incidents feature
 * @feature incidents
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export type IncidentType = 'safety' | 'security' | 'data_breach' | 'ai_malfunction' | 'vulnerability';
export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'detected' | 'investigating' | 'contained' | 'resolved' | 'closed';
export type Authority = 'ai_act_authority' | 'dpa' | 'data_subject' | 'csirt' | 'enisa';
export type Regulation = 'ai_act' | 'gdpr' | 'nis2' | 'cra';
export type NotificationType = 'early_warning' | 'initial' | 'intermediate' | 'final';
export type NotificationStatus = 'pending' | 'draft' | 'sent' | 'acknowledged' | 'overdue';

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  safety: 'Safety',
  security: 'Security',
  data_breach: 'Data Breach',
  ai_malfunction: 'AI Malfunction',
  vulnerability: 'Vulnerability',
};

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  detected: 'Detected',
  investigating: 'Investigating',
  contained: 'Contained',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const AUTHORITY_LABELS: Record<Authority, string> = {
  ai_act_authority: 'AI Act Authority',
  dpa: 'Data Protection Authority',
  data_subject: 'Data Subject',
  csirt: 'CSIRT',
  enisa: 'ENISA',
};

export const REGULATION_LABELS: Record<Regulation, string> = {
  ai_act: 'EU AI Act',
  gdpr: 'GDPR',
  nis2: 'NIS2',
  cra: 'Cyber Resilience Act',
};

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  early_warning: 'Early Warning',
  initial: 'Initial',
  intermediate: 'Intermediate',
  final: 'Final Report',
};

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: 'Pending',
  draft: 'Draft',
  sent: 'Sent',
  acknowledged: 'Acknowledged',
  overdue: 'Overdue',
};

export const SEVERITY_PRIORITY: Record<IncidentSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ============================================================================
// INTERFACES
// ============================================================================

export interface SystemSnapshot {
  capturedAt: string;
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

export interface IncidentNotification {
  id: string;
  incidentId: string;
  authority: Authority;
  regulation: Regulation;
  notificationType: NotificationType;
  deadlineHours: number;
  dueAt: string;
  status: NotificationStatus;
  sentAt: string | null;
  acknowledgedAt: string | null;
  templateId: string | null;
  content: string | null;
  createdAt: string;
  updatedAt: string;
  sentBy: string | null;
  hoursRemaining?: number;
  isOverdue?: boolean;
}

export interface Incident {
  id: string;
  incidentNumber: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string;
  rootCause: string | null;
  resolution: string | null;
  riskScore: number | null;
  affectedDataSubjects: number | null;
  dataCategories: string[];
  detectedAt: string;
  containedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  robotId: string | null;
  complianceLogIds: string[];
  alertIds: string[];
  systemSnapshot: SystemSnapshot | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  notifications?: IncidentNotification[];
}

export interface NotificationTemplate {
  id: string;
  name: string;
  regulation: Regulation;
  authority: Authority;
  type: NotificationType;
  subject: string;
  body: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

export interface CreateIncidentRequest {
  type: IncidentType;
  severity?: IncidentSeverity;
  title: string;
  description: string;
  robotId?: string;
  detectedAt?: string;
}

export interface UpdateIncidentRequest {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  title?: string;
  description?: string;
  rootCause?: string;
  resolution?: string;
  riskScore?: number;
  affectedDataSubjects?: number;
  dataCategories?: string[];
}

export interface IncidentListResponse {
  incidents: Incident[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface NotificationTimeline {
  incidentId: string;
  incidentNumber: string;
  detectedAt: string;
  notifications: IncidentNotification[];
}

export interface RiskAssessment {
  incidentId: string;
  impactLevel: string;
  likelihoodLevel: string;
  riskScore: number;
  affectedDataSubjects: number;
  dataCategories: string[];
  potentialHarm: string[];
  mitigatingFactors: string[];
  assessedAt: string;
  assessedBy?: string;
}

export interface DashboardStats {
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

// ============================================================================
// FILTER & PAGINATION TYPES
// ============================================================================

export interface IncidentFilters {
  type?: IncidentType[];
  severity?: IncidentSeverity[];
  status?: IncidentStatus[];
  robotId?: string;
  startDate?: string;
  endDate?: string;
}

export interface IncidentPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ============================================================================
// STORE TYPES
// ============================================================================

export interface IncidentsState {
  incidents: Incident[];
  isLoading: boolean;
  error: string | null;
  pagination: IncidentPagination;
  filters: IncidentFilters;

  selectedIncident: Incident | null;
  isLoadingDetails: boolean;

  dashboardStats: DashboardStats | null;
  isLoadingDashboard: boolean;

  templates: NotificationTemplate[];
  isLoadingTemplates: boolean;
}

export interface IncidentsActions {
  fetchIncidents: (page?: number) => Promise<void>;
  setFilters: (filters: IncidentFilters) => void;

  fetchIncident: (id: string) => Promise<void>;
  createIncident: (input: CreateIncidentRequest) => Promise<Incident>;
  updateIncident: (id: string, input: UpdateIncidentRequest) => Promise<Incident | null>;
  deleteIncident: (id: string) => Promise<boolean>;

  fetchDashboardStats: () => Promise<void>;

  markNotificationSent: (incidentId: string, notificationId: string) => Promise<void>;
  generateNotificationContent: (incidentId: string, notificationId: string, templateId?: string) => Promise<string | null>;

  fetchTemplates: () => Promise<void>;

  addIncidentFromWebSocket: (incident: Incident) => void;
  updateIncidentFromWebSocket: (incident: Incident) => void;

  reset: () => void;
}

export type IncidentsStore = IncidentsState & IncidentsActions;
