/**
 * @file TrainingCompliancePanel.tsx
 * @description Panel for DGUV training compliance tracking
 * @feature compliance
 */

import { useEffect } from 'react';
import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import { TRAINING_TYPE_LABELS, type TrainingType } from '../types';

export interface TrainingCompliancePanelProps {
  className?: string;
}

/**
 * Training Compliance Panel
 */
export function TrainingCompliancePanel({ className }: TrainingCompliancePanelProps) {
  const {
    trainingRecords,
    trainingSummary,
    isLoadingTraining,
    fetchTrainingRecords,
    fetchTrainingSummary,
  } = useComplianceTrackerStore();

  useEffect(() => {
    fetchTrainingRecords();
    fetchTrainingSummary();
  }, [fetchTrainingRecords, fetchTrainingSummary]);

  const getStatusConfig = (status: 'valid' | 'expiring_soon' | 'expired') => {
    switch (status) {
      case 'valid':
        return { bgColor: 'bg-green-900/20', textColor: 'text-green-400', label: 'Valid' };
      case 'expiring_soon':
        return { bgColor: 'bg-yellow-900/20', textColor: 'text-yellow-400', label: 'Expiring' };
      case 'expired':
        return { bgColor: 'bg-red-900/20', textColor: 'text-red-400', label: 'Expired' };
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoadingTraining) {
    return (
      <Card className={cn('glass-card p-6', className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-gray-700 rounded" />
            ))}
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-700 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Summary Cards */}
      {trainingSummary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="bg-gray-800/50 p-4 text-center">
            <div className="text-2xl font-bold text-theme-primary">
              {trainingSummary.totalRecords}
            </div>
            <div className="text-xs text-theme-tertiary">Total Records</div>
          </Card>
          <Card className="bg-gray-800/50 p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">
              {trainingSummary.totalEmployees}
            </div>
            <div className="text-xs text-theme-tertiary">Employees</div>
          </Card>
          <Card className="bg-green-900/20 p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{trainingSummary.valid}</div>
            <div className="text-xs text-theme-tertiary">Valid</div>
          </Card>
          <Card className="bg-yellow-900/20 p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">
              {trainingSummary.expiringSoon}
            </div>
            <div className="text-xs text-theme-tertiary">Expiring Soon</div>
          </Card>
          <Card className="bg-red-900/20 p-4 text-center">
            <div className="text-2xl font-bold text-red-400">{trainingSummary.expired}</div>
            <div className="text-xs text-theme-tertiary">Expired</div>
          </Card>
        </div>
      )}

      {/* Training Records Table */}
      <Card className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/50">
          <h3 className="font-semibold text-theme-primary">Training Records (DGUV)</h3>
        </div>
        {trainingRecords.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">Employee</th>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">Training</th>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">Completed</th>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">Expires</th>
                  <th className="px-4 py-3 text-left text-theme-tertiary font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {trainingRecords.map((record) => {
                  const statusConfig = getStatusConfig(record.status);
                  return (
                    <tr key={record.id} className="hover:bg-gray-800/30">
                      <td className="px-4 py-3">
                        <div className="font-medium text-theme-primary">{record.userName}</div>
                        {record.userEmail && (
                          <div className="text-xs text-theme-tertiary">{record.userEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-theme-secondary">
                        {TRAINING_TYPE_LABELS[record.trainingType as TrainingType] ||
                          record.trainingType}
                      </td>
                      <td className="px-4 py-3 text-theme-secondary">
                        {formatDate(record.completedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-theme-secondary">{formatDate(record.expiresAt)}</div>
                        <div
                          className={cn(
                            'text-xs',
                            record.daysUntilExpiry < 0
                              ? 'text-red-400'
                              : record.daysUntilExpiry < 30
                                ? 'text-yellow-400'
                                : 'text-theme-tertiary'
                          )}
                        >
                          {record.daysUntilExpiry < 0
                            ? `${Math.abs(record.daysUntilExpiry)} days overdue`
                            : `${record.daysUntilExpiry} days left`}
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
            <p className="text-theme-tertiary">No training records found</p>
          </div>
        )}
      </Card>
    </div>
  );
}
