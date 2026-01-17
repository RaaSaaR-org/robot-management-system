/**
 * @file PrivacyBudgetView.tsx
 * @description Component for displaying fleet-wide privacy budget consumption
 * @feature fleetlearning
 */

import { cn } from '@/shared/utils/cn';
import { Shield, AlertTriangle, Bot, Loader2 } from 'lucide-react';
import type { RobotPrivacyBudget } from '../types/fleetlearning.types';

// ============================================================================
// TYPES
// ============================================================================

export interface PrivacyBudgetViewProps {
  budgets: RobotPrivacyBudget[];
  isLoading?: boolean;
  warningThreshold?: number;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function getBudgetStatus(budget: RobotPrivacyBudget, threshold: number) {
  const usagePercent = (budget.usedEpsilon / budget.totalEpsilon) * 100;
  if (budget.remainingEpsilon <= 0) return 'exhausted';
  if (budget.remainingEpsilon < threshold) return 'low';
  if (usagePercent > 75) return 'warning';
  return 'healthy';
}

function getStatusColor(status: string) {
  switch (status) {
    case 'exhausted':
      return 'bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800';
    case 'low':
      return 'bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800';
    case 'warning':
      return 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800';
    default:
      return 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700';
  }
}

function getProgressColor(status: string) {
  switch (status) {
    case 'exhausted':
      return 'bg-red-500';
    case 'low':
      return 'bg-orange-500';
    case 'warning':
      return 'bg-yellow-500';
    default:
      return 'bg-green-500';
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PrivacyBudgetView({
  budgets,
  isLoading = false,
  warningThreshold = 1.0,
  className,
}: PrivacyBudgetViewProps) {
  // Calculate fleet-wide stats
  const totalBudget = budgets.reduce((sum, b) => sum + b.totalEpsilon, 0);
  const usedBudget = budgets.reduce((sum, b) => sum + b.usedEpsilon, 0);
  const avgUsage = budgets.length > 0 ? (usedBudget / totalBudget) * 100 : 0;
  const lowBudgetCount = budgets.filter((b) => b.remainingEpsilon < warningThreshold).length;
  const exhaustedCount = budgets.filter((b) => b.remainingEpsilon <= 0).length;

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700',
          className
        )}
      >
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Empty state
  if (budgets.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700',
          className
        )}
      >
        <Shield className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-gray-500 dark:text-gray-400">No privacy budget data available</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700',
        className
      )}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary-600" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              Privacy Budget Overview
            </h3>
          </div>
          {(lowBudgetCount > 0 || exhaustedCount > 0) && (
            <div className="flex items-center gap-1.5 text-sm">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              <span className="text-orange-600 dark:text-orange-400">
                {exhaustedCount > 0
                  ? `${exhaustedCount} exhausted`
                  : `${lowBudgetCount} low budget`}
              </span>
            </div>
          )}
        </div>

        {/* Fleet-wide summary */}
        <div className="mt-3 grid grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Total Robots</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {budgets.length}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Avg Usage</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {avgUsage.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Low Budget</p>
            <p
              className={cn(
                'text-lg font-semibold',
                lowBudgetCount > 0
                  ? 'text-orange-600 dark:text-orange-400'
                  : 'text-gray-900 dark:text-gray-100'
              )}
            >
              {lowBudgetCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Exhausted</p>
            <p
              className={cn(
                'text-lg font-semibold',
                exhaustedCount > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-900 dark:text-gray-100'
              )}
            >
              {exhaustedCount}
            </p>
          </div>
        </div>
      </div>

      {/* Budget list */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
        {budgets
          .sort((a, b) => a.remainingEpsilon - b.remainingEpsilon)
          .map((budget) => {
            const status = getBudgetStatus(budget, warningThreshold);
            const usagePercent = (budget.usedEpsilon / budget.totalEpsilon) * 100;

            return (
              <div
                key={budget.robotId}
                className={cn('p-3 border-l-4', getStatusColor(status))}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {budget.robotId.slice(0, 12)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {budget.roundsParticipated} rounds
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', getProgressColor(status))}
                        style={{ width: `${Math.min(usagePercent, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 w-24 text-right">
                    <span className="font-medium">{budget.remainingEpsilon.toFixed(2)}</span>
                    <span className="text-gray-400"> / {budget.totalEpsilon.toFixed(1)} ε</span>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Footer */}
      <div className="p-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Privacy budget (ε) limits data contribution to preserve differential privacy
        </p>
      </div>
    </div>
  );
}
