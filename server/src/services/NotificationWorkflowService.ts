/**
 * @file NotificationWorkflowService.ts
 * @description Service for managing incident notification workflows and templates
 * @feature incidents
 *
 * Implements notification workflow tracking for regulatory compliance:
 * - EU AI Act Art. 73 (2/10/15 day deadlines)
 * - GDPR Art. 33-34 (72 hours to DPA)
 * - NIS2 Art. 23 (24h/72h/1 month)
 * - CRA Art. 14 (24h for vulnerabilities)
 */

import {
  incidentRepository,
  incidentNotificationRepository,
  notificationTemplateRepository,
} from '../repositories/IncidentRepository.js';
import { breachAssessmentService } from './BreachAssessmentService.js';
import { alertService } from './AlertService.js';
import type {
  Incident,
  IncidentNotification,
  NotificationTemplate,
  NotificationTimeline,
  CreateNotificationInput,
  CreateTemplateInput,
  UpdateTemplateInput,
  Regulation,
  Authority,
  NotificationType,
  RiskAssessment,
} from '../types/incident.types.js';

// ============================================================================
// DEFAULT TEMPLATES
// ============================================================================

const DEFAULT_TEMPLATES: Omit<CreateTemplateInput, 'id'>[] = [
  // AI Act Templates
  {
    name: 'AI Act - Serious Incident (2 days)',
    regulation: 'ai_act',
    authority: 'ai_act_authority',
    type: 'initial',
    subject: 'Serious Incident Report - {{incidentNumber}}',
    body: `Dear AI Act Competent Authority,

We are reporting a serious incident pursuant to Article 73 of the EU AI Act.

**Incident Reference:** {{incidentNumber}}
**Incident Type:** {{type}}
**Detected At:** {{detectedAt}}
**Severity:** {{severity}}

**Description:**
{{description}}

**Affected Systems:**
- Robot ID: {{robotId}}
- System affected: RoboMindOS Fleet Management Platform

**Risk Assessment:**
- Risk Score: {{riskScore}}/100
- Affected Data Subjects: {{affectedDataSubjects}}

**Actions Taken:**
{{resolution}}

**Root Cause (if known):**
{{rootCause}}

We will provide further updates as our investigation progresses.

Sincerely,
{{organizationName}}`,
    isDefault: true,
  },
  {
    name: 'AI Act - Safety Risk (10 days)',
    regulation: 'ai_act',
    authority: 'ai_act_authority',
    type: 'initial',
    subject: 'Safety Risk Incident Report - {{incidentNumber}}',
    body: `Dear AI Act Competent Authority,

We are reporting a safety-related incident pursuant to Article 73 of the EU AI Act.

**Incident Reference:** {{incidentNumber}}
**Incident Type:** Safety Event
**Detected At:** {{detectedAt}}
**Current Status:** {{status}}

**Description:**
{{description}}

**Safety Measures Implemented:**
- Emergency stop activated: Yes
- System isolation: Complete
- Human oversight restored: Yes

**Impact Assessment:**
{{riskScore}}/100 risk score

We will provide a full incident report within the statutory period.

Sincerely,
{{organizationName}}`,
    isDefault: false,
  },

  // GDPR Templates
  {
    name: 'GDPR - DPA Notification (72h)',
    regulation: 'gdpr',
    authority: 'dpa',
    type: 'initial',
    subject: 'Personal Data Breach Notification - {{incidentNumber}}',
    body: `Dear Data Protection Authority,

Pursuant to Article 33 of the GDPR, we are notifying you of a personal data breach.

**1. Nature of the Breach**
- Reference: {{incidentNumber}}
- Detected: {{detectedAt}}
- Type: {{type}}
- Description: {{description}}

**2. Categories and Approximate Number of Data Subjects**
- Affected Data Subjects: {{affectedDataSubjects}}
- Categories: {{dataCategories}}

**3. Contact Details of DPO**
- Name: [DPO Name]
- Email: [DPO Email]
- Phone: [DPO Phone]

**4. Likely Consequences**
Based on our risk assessment (score: {{riskScore}}/100):
[Describe potential consequences]

**5. Measures Taken or Proposed**
{{resolution}}

We will provide updates as our investigation continues.

Sincerely,
Data Protection Officer
{{organizationName}}`,
    isDefault: true,
  },
  {
    name: 'GDPR - Data Subject Notification',
    regulation: 'gdpr',
    authority: 'data_subject',
    type: 'initial',
    subject: 'Important: Security Incident Affecting Your Data',
    body: `Dear [Data Subject Name],

We are writing to inform you of a security incident that may have affected your personal data.

**What Happened:**
{{description}}

**What Data Was Affected:**
{{dataCategories}}

**What We Are Doing:**
{{resolution}}

**What You Can Do:**
- Monitor your accounts for unusual activity
- Change your passwords if applicable
- Contact us with any questions

**Contact Information:**
For questions about this incident, please contact our Data Protection Officer at [DPO Email].

We apologize for any inconvenience this may cause and are committed to protecting your data.

Sincerely,
{{organizationName}}`,
    isDefault: true,
  },

  // NIS2 Templates
  {
    name: 'NIS2 - Early Warning (24h)',
    regulation: 'nis2',
    authority: 'csirt',
    type: 'early_warning',
    subject: 'NIS2 Early Warning - Significant Incident - {{incidentNumber}}',
    body: `EARLY WARNING - SIGNIFICANT INCIDENT

This is an early warning pursuant to Article 23(4) of the NIS2 Directive.

**Incident Reference:** {{incidentNumber}}
**Detected:** {{detectedAt}}
**Type:** {{type}}
**Severity:** {{severity}}

**Initial Assessment:**
{{description}}

**Suspected Cause:**
[Suspected malicious activity: Yes/No]
[Cross-border impact suspected: Yes/No]

A formal incident notification will follow within 72 hours.

{{organizationName}}`,
    isDefault: true,
  },
  {
    name: 'NIS2 - Initial Notification (72h)',
    regulation: 'nis2',
    authority: 'csirt',
    type: 'initial',
    subject: 'NIS2 Incident Notification - {{incidentNumber}}',
    body: `INCIDENT NOTIFICATION

Pursuant to Article 23(4) of the NIS2 Directive.

**1. Incident Details**
- Reference: {{incidentNumber}}
- Detection: {{detectedAt}}
- Type: {{type}}
- Current Status: {{status}}

**2. Severity and Impact**
- Risk Score: {{riskScore}}/100
- Affected Systems: [List systems]
- Service Disruption: [Duration if applicable]

**3. Initial Root Cause Assessment**
{{rootCause}}

**4. Mitigation Measures**
{{resolution}}

**5. Cross-border Impact**
[Describe any cross-border implications]

A final report will be submitted within one month.

{{organizationName}}`,
    isDefault: true,
  },
  {
    name: 'NIS2 - Final Report (1 month)',
    regulation: 'nis2',
    authority: 'csirt',
    type: 'final',
    subject: 'NIS2 Final Incident Report - {{incidentNumber}}',
    body: `FINAL INCIDENT REPORT

Pursuant to Article 23(4) of the NIS2 Directive.

**Incident Reference:** {{incidentNumber}}

**1. Detailed Description**
{{description}}

**2. Root Cause Analysis**
{{rootCause}}

**3. Severity Assessment**
- Initial Classification: {{severity}}
- Final Risk Score: {{riskScore}}/100

**4. Remediation Actions**
{{resolution}}

**5. Lessons Learned**
[Document lessons learned]

**6. Future Prevention Measures**
[Document preventive measures]

This concludes our reporting on incident {{incidentNumber}}.

{{organizationName}}`,
    isDefault: true,
  },

  // CRA Templates
  {
    name: 'CRA - Vulnerability Notification (24h)',
    regulation: 'cra',
    authority: 'enisa',
    type: 'initial',
    subject: 'CRA Vulnerability Notification - {{incidentNumber}}',
    body: `ACTIVELY EXPLOITED VULNERABILITY NOTIFICATION

Pursuant to Article 14 of the Cyber Resilience Act.

**Reference:** {{incidentNumber}}
**Detected:** {{detectedAt}}
**Product/System:** RoboMindOS Fleet Management Platform

**Vulnerability Details:**
{{description}}

**Exploitation Status:**
- Actively exploited: [Yes/No]
- Severity: {{severity}}

**Affected Components:**
[List affected components and versions]

**Mitigation:**
{{resolution}}

**Patch Status:**
[Describe patch availability and timeline]

{{organizationName}}`,
    isDefault: true,
  },
];

// ============================================================================
// NOTIFICATION WORKFLOW SERVICE
// ============================================================================

/**
 * NotificationWorkflowService - Manages notification workflows and templates
 */
export class NotificationWorkflowService {
  private initialized = false;
  private overdueCheckInterval?: NodeJS.Timeout;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the notification service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('[NotificationWorkflowService] Initializing...');

    // Seed default templates if needed
    await this.seedDefaultTemplates();

    // Start overdue notification checker (every 5 minutes)
    this.startOverdueChecker();

    this.initialized = true;
    console.log('[NotificationWorkflowService] Initialized');
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    if (this.overdueCheckInterval) {
      clearInterval(this.overdueCheckInterval);
      this.overdueCheckInterval = undefined;
    }
    this.initialized = false;
    console.log('[NotificationWorkflowService] Shutdown complete');
  }

  /**
   * Seed default notification templates
   */
  private async seedDefaultTemplates(): Promise<void> {
    const existingTemplates = await notificationTemplateRepository.findAll();

    if (existingTemplates.length === 0) {
      console.log('[NotificationWorkflowService] Seeding default templates...');

      for (const template of DEFAULT_TEMPLATES) {
        await notificationTemplateRepository.create(template);
      }

      console.log(`[NotificationWorkflowService] Seeded ${DEFAULT_TEMPLATES.length} templates`);
    }
  }

  /**
   * Start periodic overdue notification checker
   */
  private startOverdueChecker(): void {
    // Check every 5 minutes
    this.overdueCheckInterval = setInterval(
      async () => {
        await this.checkAndMarkOverdue();
      },
      5 * 60 * 1000
    );

    // Also run immediately
    this.checkAndMarkOverdue().catch((err) => {
      console.error('[NotificationWorkflowService] Error checking overdue:', err);
    });
  }

  /**
   * Check for and mark overdue notifications
   */
  private async checkAndMarkOverdue(): Promise<void> {
    const count = await incidentNotificationRepository.markOverdue();

    if (count > 0) {
      console.log(`[NotificationWorkflowService] Marked ${count} notifications as overdue`);

      // Create alert for overdue notifications
      await alertService.createAlert({
        severity: 'error',
        title: 'Overdue Incident Notifications',
        message: `${count} incident notification(s) are now past their deadline`,
        source: 'system',
        sourceId: 'notification-workflow',
      });
    }
  }

  // ============================================================================
  // WORKFLOW CREATION
  // ============================================================================

  /**
   * Create notification workflow for an incident
   */
  async createNotificationWorkflow(
    incidentId: string,
    assessment?: RiskAssessment
  ): Promise<IncidentNotification[]> {
    const incident = await incidentRepository.findById(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    // Get or create risk assessment
    const riskAssessment =
      assessment ?? (await breachAssessmentService.assessRisk(incidentId, 'system'));

    // Determine required notifications
    const requirements = breachAssessmentService.determineNotificationRequirements(
      incident,
      riskAssessment
    );

    if (requirements.length === 0) {
      console.log(`[NotificationWorkflowService] No notifications required for ${incidentId}`);
      return [];
    }

    console.log(
      `[NotificationWorkflowService] Creating ${requirements.length} notifications for ${incident.incidentNumber}`
    );

    // Create notifications
    const notifications: CreateNotificationInput[] = requirements.map((req) => {
      const dueAt = new Date(incident.detectedAt);
      dueAt.setHours(dueAt.getHours() + req.deadlineHours);

      return {
        incidentId,
        authority: req.authority,
        regulation: req.regulation,
        notificationType: req.notificationType,
        deadlineHours: req.deadlineHours,
        dueAt,
      };
    });

    await incidentNotificationRepository.createMany(notifications);

    // Return created notifications
    return incidentNotificationRepository.findByIncidentId(incidentId);
  }

  /**
   * Get notification timeline for an incident
   */
  async getNotificationTimeline(incidentId: string): Promise<NotificationTimeline | null> {
    const incident = await incidentRepository.findById(incidentId, true);
    if (!incident) {
      return null;
    }

    const now = new Date();
    const notifications = (incident.notifications || []).map((n) => {
      const dueAt = new Date(n.dueAt);
      const hoursRemaining = (dueAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      const isOverdue = hoursRemaining < 0 && !['sent', 'acknowledged'].includes(n.status);

      return {
        ...n,
        hoursRemaining: Math.round(hoursRemaining * 10) / 10,
        isOverdue,
      };
    });

    // Sort by due date
    notifications.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

    return {
      incidentId: incident.id,
      incidentNumber: incident.incidentNumber,
      detectedAt: incident.detectedAt,
      notifications,
    };
  }

  // ============================================================================
  // NOTIFICATION MANAGEMENT
  // ============================================================================

  /**
   * Get notifications for an incident
   */
  async getNotifications(incidentId: string): Promise<IncidentNotification[]> {
    return incidentNotificationRepository.findByIncidentId(incidentId);
  }

  /**
   * Mark notification as sent
   */
  async markNotificationSent(notificationId: string, sentBy?: string): Promise<IncidentNotification | null> {
    const notification = await incidentNotificationRepository.markSent(notificationId, sentBy);

    if (notification) {
      console.log(`[NotificationWorkflowService] Notification ${notificationId} marked as sent`);
    }

    return notification;
  }

  /**
   * Update notification content
   */
  async updateNotificationContent(
    notificationId: string,
    content: string
  ): Promise<IncidentNotification | null> {
    return incidentNotificationRepository.update(notificationId, {
      content,
      status: 'draft',
    });
  }

  /**
   * Get overdue notifications
   */
  async getOverdueNotifications(): Promise<IncidentNotification[]> {
    return incidentNotificationRepository.findOverdue();
  }

  /**
   * Get pending notifications
   */
  async getPendingNotifications(): Promise<IncidentNotification[]> {
    return incidentNotificationRepository.findPending();
  }

  // ============================================================================
  // TEMPLATE CONTENT GENERATION
  // ============================================================================

  /**
   * Generate notification content from template
   */
  async generateNotificationContent(
    notificationId: string,
    templateId?: string
  ): Promise<string | null> {
    const notification = await incidentNotificationRepository.findById(notificationId);
    if (!notification) {
      return null;
    }

    const incident = await incidentRepository.findById(notification.incidentId);
    if (!incident) {
      return null;
    }

    // Get template
    let template: NotificationTemplate | null = null;
    if (templateId) {
      template = await notificationTemplateRepository.findById(templateId);
    } else {
      template = await notificationTemplateRepository.findDefault(
        notification.regulation,
        notification.authority,
        notification.notificationType
      );
    }

    if (!template) {
      return null;
    }

    // Replace placeholders
    const content = this.replacePlaceholders(template.body, incident);

    // Update notification with generated content
    await incidentNotificationRepository.update(notificationId, {
      content,
      status: 'draft',
    });

    return content;
  }

  /**
   * Replace template placeholders with incident data
   */
  private replacePlaceholders(template: string, incident: Incident): string {
    const replacements: Record<string, string> = {
      '{{incidentNumber}}': incident.incidentNumber,
      '{{type}}': incident.type,
      '{{severity}}': incident.severity,
      '{{status}}': incident.status,
      '{{title}}': incident.title,
      '{{description}}': incident.description,
      '{{rootCause}}': incident.rootCause || 'Under investigation',
      '{{resolution}}': incident.resolution || 'Remediation in progress',
      '{{detectedAt}}': new Date(incident.detectedAt).toISOString(),
      '{{robotId}}': incident.robotId || 'N/A',
      '{{riskScore}}': incident.riskScore?.toString() || 'Not assessed',
      '{{affectedDataSubjects}}': incident.affectedDataSubjects?.toString() || '0',
      '{{dataCategories}}': incident.dataCategories.join(', ') || 'N/A',
      '{{organizationName}}': 'RoboMindOS',
    };

    let content = template;
    for (const [placeholder, value] of Object.entries(replacements)) {
      content = content.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    return content;
  }

  // ============================================================================
  // TEMPLATE MANAGEMENT
  // ============================================================================

  /**
   * Get all templates
   */
  async getTemplates(): Promise<NotificationTemplate[]> {
    return notificationTemplateRepository.findAll();
  }

  /**
   * Get templates by regulation
   */
  async getTemplatesByRegulation(regulation: Regulation): Promise<NotificationTemplate[]> {
    return notificationTemplateRepository.findByRegulation(regulation);
  }

  /**
   * Get a template by ID
   */
  async getTemplate(id: string): Promise<NotificationTemplate | null> {
    return notificationTemplateRepository.findById(id);
  }

  /**
   * Create a template
   */
  async createTemplate(input: CreateTemplateInput): Promise<NotificationTemplate> {
    return notificationTemplateRepository.create(input);
  }

  /**
   * Update a template
   */
  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<NotificationTemplate | null> {
    return notificationTemplateRepository.update(id, input);
  }

  /**
   * Delete a template
   */
  async deleteTemplate(id: string): Promise<boolean> {
    return notificationTemplateRepository.delete(id);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const notificationWorkflowService = new NotificationWorkflowService();
