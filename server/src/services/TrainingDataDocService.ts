/**
 * @file TrainingDataDocService.ts
 * @description Service for EU AI Act GPAI training data documentation
 * @feature compliance
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import type {
  DatasetProvenance,
  DatasetSourceType,
  TrainingDataSummary,
  TrainingDataSummaryResponse,
  BiasAssessment,
  BiasAssessmentStatus,
  BiasTestingResults,
  CustodyTransfer,
  UpsertProvenanceDto,
  GenerateSummaryDto,
  UpdateSummaryDto,
  CreateBiasAssessmentDto,
  UpdateBiasAssessmentDto,
  SummariesDueQuery,
  SummariesDueResponse,
  ExportFormat,
  ExportedDocument,
  TrainingDocsEvent,
  TrainingDocsEventType,
} from '../types/training-docs.types.js';
import { AI_ACT_UPDATE_INTERVAL_DAYS } from '../types/training-docs.types.js';

// ============================================================================
// TRAINING DATA DOC SERVICE
// ============================================================================

/**
 * Service for managing training data documentation per EU AI Act requirements
 */
export class TrainingDataDocService extends EventEmitter {
  private static instance: TrainingDataDocService;

  private prisma: PrismaClient;

  private constructor() {
    super();
    this.prisma = new PrismaClient();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TrainingDataDocService {
    if (!TrainingDataDocService.instance) {
      TrainingDataDocService.instance = new TrainingDataDocService();
    }
    return TrainingDataDocService.instance;
  }

  // ============================================================================
  // DATASET PROVENANCE
  // ============================================================================

  /**
   * Record or update dataset provenance
   */
  async recordProvenance(
    datasetId: string,
    dto: UpsertProvenanceDto,
    recordedBy: string
  ): Promise<DatasetProvenance> {
    const now = new Date();

    // Build collection period as JSON
    const collectionPeriod = dto.collectionPeriod
      ? { start: dto.collectionPeriod.start, end: dto.collectionPeriod.end }
      : undefined;

    // Check if exists
    const existing = await this.prisma.datasetProvenance.findUnique({
      where: { datasetId },
    });

    let provenance;
    if (existing) {
      provenance = await this.prisma.datasetProvenance.update({
        where: { datasetId },
        data: {
          sourceType: dto.sourceType,
          sourceName: dto.sourceName,
          sourceUrl: dto.sourceUrl,
          collectionMethod: dto.collectionMethod,
          collectionPeriod: collectionPeriod ? JSON.parse(JSON.stringify(collectionPeriod)) : undefined,
          labelingProcedure: dto.labelingProcedure,
          annotatorInfo: dto.annotatorInfo,
          cleaningSteps: dto.cleaningSteps,
          licenseType: dto.licenseType,
          copyrightCompliance: dto.copyrightCompliance,
          chainOfCustody: dto.chainOfCustody ? JSON.parse(JSON.stringify(dto.chainOfCustody)) : undefined,
          updatedAt: now,
        },
      });
    } else {
      provenance = await this.prisma.datasetProvenance.create({
        data: {
          datasetId,
          sourceType: dto.sourceType,
          sourceName: dto.sourceName,
          sourceUrl: dto.sourceUrl,
          collectionMethod: dto.collectionMethod,
          collectionPeriod: collectionPeriod ? JSON.parse(JSON.stringify(collectionPeriod)) : undefined,
          labelingProcedure: dto.labelingProcedure,
          annotatorInfo: dto.annotatorInfo,
          cleaningSteps: dto.cleaningSteps,
          licenseType: dto.licenseType,
          copyrightCompliance: dto.copyrightCompliance,
          chainOfCustody: dto.chainOfCustody ? JSON.parse(JSON.stringify(dto.chainOfCustody)) : undefined,
          recordedBy,
        },
      });
    }

    this.emitEvent({
      type: 'provenance:recorded',
      entityId: provenance.id,
      entityType: 'provenance',
      datasetId,
      timestamp: now,
    });

    return this.toDatasetProvenance(provenance);
  }

  /**
   * Get provenance for a dataset
   */
  async getProvenance(datasetId: string): Promise<DatasetProvenance | null> {
    const provenance = await this.prisma.datasetProvenance.findUnique({
      where: { datasetId },
    });
    return provenance ? this.toDatasetProvenance(provenance) : null;
  }

  /**
   * List all provenance records
   */
  async listProvenance(sourceType?: DatasetSourceType): Promise<DatasetProvenance[]> {
    const where: Record<string, unknown> = {};
    if (sourceType) {
      where.sourceType = sourceType;
    }

    const records = await this.prisma.datasetProvenance.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    return records.map((r) => this.toDatasetProvenance(r));
  }

  // ============================================================================
  // TRAINING DATA SUMMARY
  // ============================================================================

  /**
   * Generate training data summary for a model version
   */
  async generateSummary(
    modelVersionId: string,
    dto: GenerateSummaryDto,
    generatedBy: string
  ): Promise<TrainingDataSummary> {
    const now = new Date();
    const nextUpdateDue = new Date(now);
    nextUpdateDue.setDate(nextUpdateDue.getDate() + AI_ACT_UPDATE_INTERVAL_DAYS);

    // Compute total trajectories (mock - would come from actual datasets)
    const totalTrajectories = dto.datasetIds.length * 1000;

    // Classify datasets as public or private
    const publicDatasets: string[] = [];
    const privateDatasets: string[] = [];
    for (const datasetId of dto.datasetIds) {
      const provenance = await this.prisma.datasetProvenance.findUnique({
        where: { datasetId },
      });
      if (provenance?.sourceType === 'open_source') {
        publicDatasets.push(datasetId);
      } else {
        privateDatasets.push(datasetId);
      }
    }

    const summary = await this.prisma.trainingDataSummary.create({
      data: {
        modelVersionId,
        datasetIds: dto.datasetIds,
        totalTrajectories,
        publicDatasets: publicDatasets.length > 0 ? publicDatasets : undefined,
        privateDatasets: privateDatasets.length > 0 ? privateDatasets : undefined,
        webScrapingSources: dto.webScrapingSources,
        copyrightMeasures: dto.copyrightMeasures,
        processingPurposes: dto.processingPurposes,
        knownGaps: dto.knownGaps ?? [],
        limitations: dto.limitations,
        nextUpdateDue,
        generatedBy,
      },
    });

    this.emitEvent({
      type: 'summary:generated',
      entityId: summary.id,
      entityType: 'summary',
      modelVersionId,
      timestamp: now,
    });

    return this.toTrainingDataSummary(summary);
  }

  /**
   * Get summary for a model version
   */
  async getSummary(modelVersionId: string): Promise<TrainingDataSummaryResponse | null> {
    const summary = await this.prisma.trainingDataSummary.findUnique({
      where: { modelVersionId },
    });
    if (!summary) {
      return null;
    }

    const now = new Date();
    const daysUntilDue = Math.ceil(
      (summary.nextUpdateDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    const isUpdateOverdue = now >= summary.nextUpdateDue;

    // Build enriched dataset information
    const datasetIds = summary.datasetIds as string[];
    const datasets = await Promise.all(
      datasetIds.map(async (datasetId) => {
        const provenance = await this.prisma.datasetProvenance.findUnique({
          where: { datasetId },
        });
        return {
          id: datasetId,
          name: provenance?.sourceName ?? `Dataset ${datasetId.slice(0, 8)}`,
          sourceType: (provenance?.sourceType ?? 'collected') as DatasetSourceType,
          trajectoryCount: 1000, // Mock value
          isPublic: provenance?.sourceType === 'open_source',
        };
      })
    );

    return {
      ...this.toTrainingDataSummary(summary),
      datasets,
      modelVersion: {
        id: modelVersionId,
        skillId: 'skill-' + modelVersionId.slice(0, 8),
        version: '1.0.0',
        skillName: 'Model ' + modelVersionId.slice(0, 8),
      },
      daysUntilUpdateDue: Math.max(0, daysUntilDue),
      isUpdateOverdue,
    };
  }

  /**
   * Update summary
   */
  async updateSummary(
    modelVersionId: string,
    dto: UpdateSummaryDto
  ): Promise<TrainingDataSummary | null> {
    const summary = await this.prisma.trainingDataSummary.findUnique({
      where: { modelVersionId },
    });
    if (!summary) {
      return null;
    }

    const now = new Date();
    const nextUpdateDue = new Date(now);
    nextUpdateDue.setDate(nextUpdateDue.getDate() + AI_ACT_UPDATE_INTERVAL_DAYS);

    const updateData: Record<string, unknown> = {
      lastUpdated: now,
      nextUpdateDue,
    };

    if (dto.copyrightMeasures !== undefined) {
      updateData.copyrightMeasures = dto.copyrightMeasures;
    }
    if (dto.processingPurposes !== undefined) {
      updateData.processingPurposes = dto.processingPurposes;
    }
    if (dto.knownGaps !== undefined) {
      updateData.knownGaps = dto.knownGaps;
    }
    if (dto.limitations !== undefined) {
      updateData.limitations = dto.limitations;
    }

    const updated = await this.prisma.trainingDataSummary.update({
      where: { modelVersionId },
      data: updateData,
    });

    this.emitEvent({
      type: 'summary:updated',
      entityId: updated.id,
      entityType: 'summary',
      modelVersionId,
      timestamp: now,
    });

    return this.toTrainingDataSummary(updated);
  }

  /**
   * Get summaries that are due for update
   */
  async getSummariesDue(query?: SummariesDueQuery): Promise<SummariesDueResponse> {
    const now = new Date();
    const daysAhead = query?.daysAhead ?? 30;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + daysAhead);

    const page = query?.page ?? 1;
    const limit = query?.limit ?? 50;
    const skip = (page - 1) * limit;

    const [dueSummaries, total] = await Promise.all([
      this.prisma.trainingDataSummary.findMany({
        where: {
          nextUpdateDue: { lte: cutoff },
        },
        orderBy: { nextUpdateDue: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.trainingDataSummary.count({
        where: {
          nextUpdateDue: { lte: cutoff },
        },
      }),
    ]);

    const overdueCount = await this.prisma.trainingDataSummary.count({
      where: {
        nextUpdateDue: { lt: now },
      },
    });

    return {
      summaries: dueSummaries.map((s) => ({
        modelVersionId: s.modelVersionId,
        skillName: 'Model ' + s.modelVersionId.slice(0, 8),
        version: '1.0.0',
        nextUpdateDue: s.nextUpdateDue,
        daysUntilDue: Math.ceil(
          (s.nextUpdateDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        ),
        isOverdue: s.nextUpdateDue < now,
      })),
      total,
      overdueCount,
    };
  }

  // ============================================================================
  // BIAS ASSESSMENT
  // ============================================================================

  /**
   * Create bias assessment for a model version
   */
  async createBiasAssessment(
    modelVersionId: string,
    dto: CreateBiasAssessmentDto,
    assessedBy: string
  ): Promise<BiasAssessment> {
    const now = new Date();

    // Get existing assessments to determine version number
    const existingCount = await this.prisma.biasAssessment.count({
      where: { modelVersionId },
    });
    const assessmentVersion = existingCount + 1;

    const assessment = await this.prisma.biasAssessment.create({
      data: {
        modelVersionId,
        assessmentVersion,
        demographicCoverage: dto.demographicCoverage,
        geographicCoverage: dto.geographicCoverage ?? undefined,
        taskCoverage: dto.taskCoverage ?? undefined,
        knownLimitations: dto.knownLimitations,
        potentialBiasSources: dto.potentialBiasSources,
        mitigationMeasures: dto.mitigationMeasures,
        testingResults: dto.testingResults ? JSON.parse(JSON.stringify(dto.testingResults)) : undefined,
        assessedBy,
        status: 'draft',
        notes: dto.notes ?? null,
      },
    });

    this.emitEvent({
      type: 'bias:assessed',
      entityId: assessment.id,
      entityType: 'bias_assessment',
      modelVersionId,
      timestamp: now,
    });

    return this.toBiasAssessment(assessment);
  }

  /**
   * Get latest bias assessment for a model version
   */
  async getBiasAssessment(modelVersionId: string): Promise<BiasAssessment | null> {
    const assessment = await this.prisma.biasAssessment.findFirst({
      where: { modelVersionId },
      orderBy: { assessmentVersion: 'desc' },
    });
    return assessment ? this.toBiasAssessment(assessment) : null;
  }

  /**
   * Get bias assessment history for a model version
   */
  async getBiasAssessmentHistory(modelVersionId: string): Promise<BiasAssessment[]> {
    const assessments = await this.prisma.biasAssessment.findMany({
      where: { modelVersionId },
      orderBy: { assessmentVersion: 'desc' },
    });
    return assessments.map((a) => this.toBiasAssessment(a));
  }

  /**
   * Get bias assessment by ID
   */
  async getBiasAssessmentById(assessmentId: string): Promise<BiasAssessment | null> {
    const assessment = await this.prisma.biasAssessment.findUnique({
      where: { id: assessmentId },
    });
    return assessment ? this.toBiasAssessment(assessment) : null;
  }

  /**
   * Update bias assessment
   */
  async updateBiasAssessment(
    assessmentId: string,
    dto: UpdateBiasAssessmentDto,
    reviewedBy?: string
  ): Promise<BiasAssessment | null> {
    const assessment = await this.prisma.biasAssessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment) {
      return null;
    }

    const updateData: Record<string, unknown> = {};

    if (dto.demographicCoverage !== undefined) {
      updateData.demographicCoverage = dto.demographicCoverage;
    }
    if (dto.geographicCoverage !== undefined) {
      updateData.geographicCoverage = dto.geographicCoverage;
    }
    if (dto.taskCoverage !== undefined) {
      updateData.taskCoverage = dto.taskCoverage;
    }
    if (dto.knownLimitations !== undefined) {
      updateData.knownLimitations = dto.knownLimitations;
    }
    if (dto.potentialBiasSources !== undefined) {
      updateData.potentialBiasSources = dto.potentialBiasSources;
    }
    if (dto.mitigationMeasures !== undefined) {
      updateData.mitigationMeasures = dto.mitigationMeasures;
    }
    if (dto.testingResults !== undefined) {
      updateData.testingResults = dto.testingResults;
    }
    if (dto.notes !== undefined) {
      updateData.notes = dto.notes;
    }
    if (dto.status !== undefined) {
      updateData.status = dto.status;
      if (dto.status === 'reviewed' || dto.status === 'approved') {
        updateData.reviewedBy = reviewedBy ?? null;
        updateData.reviewedDate = new Date();
      }
    }

    const updated = await this.prisma.biasAssessment.update({
      where: { id: assessmentId },
      data: updateData,
    });

    const eventType: TrainingDocsEventType =
      dto.status === 'approved'
        ? 'bias:approved'
        : dto.status === 'reviewed'
          ? 'bias:reviewed'
          : 'bias:assessed';

    this.emitEvent({
      type: eventType,
      entityId: assessmentId,
      entityType: 'bias_assessment',
      modelVersionId: assessment.modelVersionId,
      timestamp: new Date(),
    });

    return this.toBiasAssessment(updated);
  }

  // ============================================================================
  // EXPORT
  // ============================================================================

  /**
   * Export documentation for a model version
   */
  async exportDocumentation(
    modelVersionId: string,
    format: ExportFormat,
    includeProvenance: boolean = true,
    includeBiasAssessment: boolean = true
  ): Promise<ExportedDocument> {
    const summary = await this.prisma.trainingDataSummary.findUnique({
      where: { modelVersionId },
    });
    const sections: string[] = ['summary'];

    // Gather provenance for all datasets in the summary
    const provenanceRecords: DatasetProvenance[] = [];
    if (summary && includeProvenance) {
      const datasetIds = summary.datasetIds as string[];
      for (const datasetId of datasetIds) {
        const provenance = await this.prisma.datasetProvenance.findUnique({
          where: { datasetId },
        });
        if (provenance) {
          provenanceRecords.push(this.toDatasetProvenance(provenance));
        }
      }
      if (provenanceRecords.length > 0) {
        sections.push('provenance');
      }
    }

    // Get bias assessments
    const biasAssessments = includeBiasAssessment
      ? await this.getBiasAssessmentHistory(modelVersionId)
      : [];
    if (biasAssessments.length > 0) {
      sections.push('bias_assessment');
    }

    const generatedAt = new Date();
    const summaryData = summary ? this.toTrainingDataSummary(summary) : null;

    if (format === 'json') {
      return {
        modelVersionId,
        format: 'json',
        content: JSON.stringify(
          {
            modelVersionId,
            generatedAt,
            summary: summaryData,
            biasAssessments: includeBiasAssessment ? biasAssessments : undefined,
            provenanceRecords: includeProvenance ? provenanceRecords : undefined,
          },
          null,
          2
        ),
        filename: `training-docs-${modelVersionId}.json`,
        generatedAt,
        sections,
      };
    }

    // Markdown format
    let markdown = `# Training Data Documentation\n\n`;
    markdown += `**Model Version:** ${modelVersionId}\n`;
    markdown += `**Generated:** ${generatedAt.toISOString()}\n\n`;

    if (summaryData) {
      markdown += `## Training Data Summary\n\n`;
      markdown += `- **Total Trajectories:** ${summaryData.totalTrajectories}\n`;
      markdown += `- **Copyright Measures:** ${summaryData.copyrightMeasures}\n`;
      markdown += `- **Processing Purposes:** ${summaryData.processingPurposes.join(', ')}\n`;

      if (summaryData.knownGaps.length > 0) {
        markdown += `- **Known Gaps:** ${summaryData.knownGaps.join('; ')}\n`;
      }

      markdown += `\n### Datasets Used\n\n`;
      for (const datasetId of summaryData.datasetIds) {
        const provenance = provenanceRecords.find((p) => p.datasetId === datasetId);
        markdown += `- **${provenance?.sourceName ?? datasetId.slice(0, 8)}** (${provenance?.sourceType ?? 'unknown'})\n`;
      }
    }

    if (biasAssessments.length > 0 && includeBiasAssessment) {
      markdown += `\n## Bias Assessments\n\n`;
      for (const assessment of biasAssessments) {
        markdown += `### Assessment v${assessment.assessmentVersion} (${assessment.status})\n`;
        markdown += `- **Date:** ${assessment.assessmentDate.toISOString()}\n`;
        markdown += `- **Known Limitations:** ${assessment.knownLimitations.join('; ')}\n`;
        markdown += `- **Potential Bias Sources:** ${assessment.potentialBiasSources.join('; ')}\n`;
        markdown += `- **Mitigation Measures:** ${assessment.mitigationMeasures.join('; ')}\n\n`;
      }
    }

    if (provenanceRecords.length > 0 && includeProvenance) {
      markdown += `## Dataset Provenance\n\n`;
      for (const prov of provenanceRecords) {
        markdown += `### ${prov.sourceName ?? prov.datasetId}\n`;
        markdown += `- **Source Type:** ${prov.sourceType}\n`;
        if (prov.collectionMethod) markdown += `- **Collection Method:** ${prov.collectionMethod}\n`;
        if (prov.licenseType) markdown += `- **License:** ${prov.licenseType}\n`;
        markdown += `\n`;
      }
    }

    return {
      modelVersionId,
      format: 'markdown',
      content: markdown,
      filename: `training-docs-${modelVersionId}.md`,
      generatedAt,
      sections,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Convert Prisma model to DatasetProvenance type
   */
  private toDatasetProvenance(record: {
    id: string;
    datasetId: string;
    sourceType: string;
    sourceName: string | null;
    sourceUrl: string | null;
    collectionMethod: string | null;
    collectionPeriod: unknown;
    labelingProcedure: string | null;
    annotatorInfo: string | null;
    cleaningSteps: unknown;
    licenseType: string | null;
    copyrightCompliance: string | null;
    chainOfCustody: unknown;
    recordedBy: string;
    recordedAt: Date;
    updatedAt: Date;
  }): DatasetProvenance {
    const period = record.collectionPeriod as { start: string | Date; end: string | Date } | null;
    return {
      id: record.id,
      datasetId: record.datasetId,
      sourceType: record.sourceType as DatasetSourceType,
      sourceName: record.sourceName,
      sourceUrl: record.sourceUrl,
      collectionMethod: record.collectionMethod,
      collectionPeriod: period
        ? { start: new Date(period.start), end: new Date(period.end) }
        : null,
      labelingProcedure: record.labelingProcedure,
      annotatorInfo: record.annotatorInfo,
      cleaningSteps: record.cleaningSteps as string[] | null,
      licenseType: record.licenseType,
      copyrightCompliance: record.copyrightCompliance,
      chainOfCustody: record.chainOfCustody as CustodyTransfer[] | null,
      recordedBy: record.recordedBy,
      recordedAt: record.recordedAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Convert Prisma model to TrainingDataSummary type
   */
  private toTrainingDataSummary(record: {
    id: string;
    modelVersionId: string;
    datasetIds: unknown;
    totalTrajectories: number;
    publicDatasets: unknown;
    privateDatasets: unknown;
    webScrapingSources: unknown;
    copyrightMeasures: string;
    processingPurposes: unknown;
    knownGaps: unknown;
    limitations: unknown;
    generatedAt: Date;
    lastUpdated: Date;
    nextUpdateDue: Date;
    generatedBy: string;
  }): TrainingDataSummary {
    // Limitations may be a JSON array or string
    const limitationsVal = record.limitations;
    let limitations: string[] | null = null;
    if (typeof limitationsVal === 'string') {
      limitations = [limitationsVal];
    } else if (Array.isArray(limitationsVal)) {
      limitations = limitationsVal as string[];
    }

    return {
      id: record.id,
      modelVersionId: record.modelVersionId,
      datasetIds: record.datasetIds as string[],
      totalTrajectories: record.totalTrajectories,
      publicDatasets: record.publicDatasets as string[] | null,
      privateDatasets: record.privateDatasets as string[] | null,
      webScrapingSources: record.webScrapingSources as string[] | null,
      copyrightMeasures: record.copyrightMeasures,
      processingPurposes: record.processingPurposes as string[],
      knownGaps: record.knownGaps as string[],
      limitations,
      generatedAt: record.generatedAt,
      lastUpdated: record.lastUpdated,
      nextUpdateDue: record.nextUpdateDue,
      generatedBy: record.generatedBy,
    };
  }

  /**
   * Convert Prisma model to BiasAssessment type
   */
  private toBiasAssessment(record: {
    id: string;
    modelVersionId: string;
    assessmentVersion: number;
    demographicCoverage: unknown;
    geographicCoverage: unknown;
    taskCoverage: unknown;
    knownLimitations: unknown;
    potentialBiasSources: unknown;
    mitigationMeasures: unknown;
    testingResults: unknown;
    assessedBy: string;
    reviewedBy: string | null;
    assessmentDate: Date;
    reviewedDate: Date | null;
    status: string;
    notes: string | null;
  }): BiasAssessment {
    return {
      id: record.id,
      modelVersionId: record.modelVersionId,
      assessmentVersion: record.assessmentVersion,
      demographicCoverage: record.demographicCoverage as Record<string, string>,
      geographicCoverage: record.geographicCoverage as Record<string, string> | null,
      taskCoverage: record.taskCoverage as Record<string, string> | null,
      knownLimitations: record.knownLimitations as string[],
      potentialBiasSources: record.potentialBiasSources as string[],
      mitigationMeasures: record.mitigationMeasures as string[],
      testingResults: record.testingResults as BiasTestingResults | null,
      assessedBy: record.assessedBy,
      reviewedBy: record.reviewedBy,
      assessmentDate: record.assessmentDate,
      reviewedDate: record.reviewedDate,
      status: record.status as BiasAssessmentStatus,
      notes: record.notes,
    };
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  private emitEvent(event: TrainingDocsEvent): void {
    this.emit('training-docs:event', event);
    this.emit(event.type, event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const trainingDataDocService = TrainingDataDocService.getInstance();
