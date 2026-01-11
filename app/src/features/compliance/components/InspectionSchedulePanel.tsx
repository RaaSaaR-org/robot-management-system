/**
 * @file InspectionSchedulePanel.tsx
 * @description Panel for DGUV Vorschrift 3 inspection scheduling
 * @feature compliance
 */

import { useEffect } from 'react';
import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import { INSPECTION_TYPE_LABELS, type InspectionType } from '../types';

export interface InspectionSchedulePanelProps {
  className?: string;
}

/**
 * Inspection Schedule Panel
 */
export function InspectionSchedulePanel({ className }: InspectionSchedulePanelProps) {
  const {
    inspectionSchedules,
    inspectionSummary,
    isLoadingInspections,
    fetchInspectionSchedules,
    fetchInspectionSummary,
  } = useComplianceTrackerStore();

  useEffect(() => {
    fetchInspectionSchedules();
    fetchInspectionSummary();
  }, [fetchInspectionSchedules, fetchInspectionSummary]);

  const getStatusConfig = (status: 'current' | 'due_soon' | 'overdue') => {
    switch (status) {
      case 'current':
        return { bgColor: 'bg-green-900/20', textColor: 'text-green-400', label: 'Current' };
      case 'due_soon':
        return { bgColor: 'bg-yellow-900/20', textColor: 'text-yellow-400', label: 'Due Soon' };
      case 'overdue':
        return { bgColor: 'bg-red-900/20', textColor: 'text-red-400', label: 'Overdue' };
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoadingInspections) {
    return (
      <Card className={cn('glass-card p-6', className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-gray-700 rounded" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Summary Cards */}
      {inspectionSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gray-800/50 p-4 text-center">
            <div className="text-2xl font-bold text-theme-primary">
              {inspectionSummary.totalScheduled}
            </div>
            <div className="text-xs text-theme-tertiary">Total Scheduled</div>
          </Card>
          <Card className="bg-green-900/20 p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{inspectionSummary.current}</div>
            <div className="text-xs text-theme-tertiary">Current</div>
          </Card>
          <Card className="bg-yellow-900/20 p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">{inspectionSummary.dueSoon}</div>
            <div className="text-xs text-theme-tertiary">Due Soon</div>
          </Card>
          <Card className="bg-red-900/20 p-4 text-center">
            <div className="text-2xl font-bold text-red-400">{inspectionSummary.overdue}</div>
            <div className="text-xs text-theme-tertiary">Overdue</div>
          </Card>
        </div>
      )}

      {/* Next Inspection Alert */}
      {inspectionSummary?.nextInspection && (
        <Card className="bg-blue-900/20 border-blue-700/50 p-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-900/50 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-sm text-blue-400 font-medium">Next Inspection Due</div>
              <div className="text-theme-primary font-semibold">
                {INSPECTION_TYPE_LABELS[
                  inspectionSummary.nextInspection.inspectionType as InspectionType
                ] || inspectionSummary.nextInspection.inspectionType}
              </div>
              <div className="text-sm text-theme-tertiary">
                {formatDate(inspectionSummary.nextInspection.nextDueDate)} (
                {inspectionSummary.nextInspection.daysUntilDue} days)
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Inspection Schedule Table */}
      <Card className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/50">
          <h3 className="font-semibold text-theme-primary">Inspection Schedule (DGUV Vorschrift 3)</h3>
        </div>
        {inspectionSchedules.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">Type</th>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">Robot</th>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">Interval</th>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">
                    Last Inspection
                  </th>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">Next Due</th>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {inspectionSchedules.map((schedule) => {
                  const statusConfig = getStatusConfig(schedule.status);
                  return (
                    <tr key={schedule.id} className="hover:bg-gray-800/30">
                      <td className="px-4 py-3">
                        <div className="font-medium text-theme-primary">
                          {INSPECTION_TYPE_LABELS[schedule.inspectionType as InspectionType] ||
                            schedule.inspectionType}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-theme-secondary">
                        {schedule.robotName || 'All Robots'}
                      </td>
                      <td className="px-4 py-3 text-theme-secondary">
                        {schedule.intervalYears === 1
                          ? 'Annual'
                          : `Every ${schedule.intervalYears} years`}
                      </td>
                      <td className="px-4 py-3 text-theme-secondary">
                        {formatDate(schedule.lastInspectionDate)}
                        {schedule.inspectorName && (
                          <div className="text-xs text-theme-tertiary">
                            by {schedule.inspectorName}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-theme-secondary">
                          {formatDate(schedule.nextDueDate)}
                        </div>
                        <div
                          className={cn(
                            'text-xs',
                            schedule.daysUntilDue < 0
                              ? 'text-red-400'
                              : schedule.daysUntilDue < 30
                                ? 'text-yellow-400'
                                : 'text-theme-tertiary'
                          )}
                        >
                          {schedule.daysUntilDue < 0
                            ? `${Math.abs(schedule.daysUntilDue)} days overdue`
                            : `${schedule.daysUntilDue} days left`}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'px-2 py-1 rounded text-xs font-medium',
                            statusConfig.bgColor,
                            statusConfig.textColor
                          )}
                        >
                          {statusConfig.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="text-theme-tertiary">No inspection schedules configured</p>
          </div>
        )}
      </Card>

      {/* DGUV Info */}
      <Card className="glass-card p-4 border-indigo-700/30 bg-indigo-900/10">
        <h4 className="font-medium text-indigo-300 mb-2">DGUV Vorschrift 3 Requirements</h4>
        <ul className="text-sm text-indigo-200/80 space-y-1 list-disc list-inside">
          <li>
            <strong>Electrical Equipment:</strong> Inspection every 4 years
          </li>
          <li>
            <strong>Force/Power Verification:</strong> Annual testing
          </li>
          <li>
            <strong>Biomechanical Limits:</strong> Annual verification
          </li>
        </ul>
      </Card>
    </div>
  );
}
