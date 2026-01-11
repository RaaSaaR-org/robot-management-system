/**
 * @file RiskAssessmentTracker.tsx
 * @description Tracker for risk assessments and their review schedules
 * @feature compliance
 */

import { useEffect } from 'react';
import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import { RISK_ASSESSMENT_TYPE_LABELS, type RiskAssessmentType } from '../types';

export interface RiskAssessmentTrackerProps {
  className?: string;
}

/**
 * Risk Assessment Tracker
 */
export function RiskAssessmentTracker({ className }: RiskAssessmentTrackerProps) {
  const { riskAssessments, isLoadingRiskAssessments, fetchRiskAssessments } =
    useComplianceTrackerStore();

  useEffect(() => {
    fetchRiskAssessments();
  }, [fetchRiskAssessments]);

  const getStatusConfig = (status: 'current' | 'review_needed' | 'update_required') => {
    switch (status) {
      case 'current':
        return { bgColor: 'bg-green-900/20', textColor: 'text-green-400', label: 'Current' };
      case 'review_needed':
        return { bgColor: 'bg-yellow-900/20', textColor: 'text-yellow-400', label: 'Review Needed' };
      case 'update_required':
        return { bgColor: 'bg-red-900/20', textColor: 'text-red-400', label: 'Update Required' };
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoadingRiskAssessments) {
    return (
      <Card className={cn('glass-card p-6', className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-700 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  // Group assessments by type
  const assessmentsByType = riskAssessments.reduce(
    (acc, assessment) => {
      const type = assessment.assessmentType as RiskAssessmentType;
      if (!acc[type]) acc[type] = [];
      acc[type].push(assessment);
      return acc;
    },
    {} as Record<RiskAssessmentType, typeof riskAssessments>
  );

  return (
    <div className={cn('space-y-4', className)}>
      {/* Assessment Type Cards */}
      {Object.entries(assessmentsByType).length > 0 ? (
        Object.entries(assessmentsByType).map(([type, assessments]) => (
          <Card key={type} className="glass-card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/30">
              <h3 className="font-semibold text-theme-primary">
                {RISK_ASSESSMENT_TYPE_LABELS[type as RiskAssessmentType] || type}
              </h3>
            </div>
            <div className="divide-y divide-gray-700/50">
              {assessments.map((assessment) => {
                const statusConfig = getStatusConfig(assessment.status);
                return (
                  <div key={assessment.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-theme-primary">{assessment.name}</h4>
                          <span className="text-xs text-theme-tertiary">v{assessment.version}</span>
                        </div>
                        {assessment.description && (
                          <p className="text-sm text-theme-tertiary mb-2">
                            {assessment.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-theme-tertiary">
                          <span>Last Updated: {formatDate(assessment.lastUpdated)}</span>
                          <span>
                            Next Review:{' '}
                            <span
                              className={cn(
                                assessment.daysUntilReview < 0
                                  ? 'text-red-400'
                                  : assessment.daysUntilReview < 30
                                    ? 'text-yellow-400'
                                    : 'text-theme-secondary'
                              )}
                            >
                              {formatDate(assessment.nextReviewDate)} ({assessment.daysUntilReview}{' '}
                              days)
                            </span>
                          </span>
                        </div>
                      </div>
                      <span
                        className={cn(
                          'px-2 py-1 rounded text-xs font-medium flex-shrink-0 ml-4',
                          statusConfig.bgColor,
                          statusConfig.textColor
                        )}
                      >
                        {statusConfig.label}
                      </span>
                    </div>

                    {/* Trigger Conditions */}
                    {assessment.triggerConditions && assessment.triggerConditions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-700/30">
                        <div className="text-xs text-theme-tertiary mb-2">
                          Update Trigger Conditions:
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {assessment.triggerConditions.map((trigger, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-1 bg-gray-800/50 rounded text-xs text-theme-secondary"
                            >
                              {trigger}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Document Link */}
                    {assessment.documentUrl && (
                      <a
                        href={assessment.documentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                        View Document
                      </a>
                    )}

                    {/* Responsible Person */}
                    {assessment.responsiblePerson && (
                      <div className="mt-2 text-xs text-theme-tertiary">
                        Responsible: {assessment.responsiblePerson}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))
      ) : (
        <Card className="glass-card p-6 text-center">
          <p className="text-theme-tertiary">No risk assessments configured</p>
        </Card>
      )}

      {/* Info Card */}
      <Card className="glass-card p-4 border-indigo-700/30 bg-indigo-900/10">
        <h4 className="font-medium text-indigo-300 mb-2">Risk Assessment Requirements</h4>
        <ul className="text-sm text-indigo-200/80 space-y-1 list-disc list-inside">
          <li>
            <strong>AI Risk Assessment:</strong> Required for high-risk AI systems (EU AI Act Art.
            9)
          </li>
          <li>
            <strong>Machinery Risk Assessment:</strong> Per Machinery Regulation Annex III
          </li>
          <li>
            <strong>DPIA:</strong> Data Protection Impact Assessment for high-risk processing (GDPR
            Art. 35)
          </li>
          <li>
            <strong>Cybersecurity:</strong> Per CRA and NIS2 requirements
          </li>
          <li>
            <strong>Occupational Safety:</strong> DGUV workplace hazard assessments
          </li>
        </ul>
      </Card>
    </div>
  );
}
