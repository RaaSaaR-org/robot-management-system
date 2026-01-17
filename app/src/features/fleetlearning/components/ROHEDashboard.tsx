/**
 * @file ROHEDashboard.tsx
 * @description Dashboard component for Return on Human Effort (ROHE) metrics
 * @feature fleetlearning
 */

import { useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { Users, TrendingUp, Bot, Target, Loader2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { ROHEMetrics } from '../types/fleetlearning.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ROHEDashboardProps {
  metrics: ROHEMetrics | null;
  isLoading?: boolean;
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ROHEDashboard({ metrics, isLoading = false, className }: ROHEDashboardProps) {
  // Process metrics for display
  const processedData = useMemo(() => {
    if (!metrics) return null;

    const robotEntries = Object.entries(metrics.byRobot)
      .map(([robotId, data]) => ({
        id: robotId,
        ...data,
      }))
      .sort((a, b) => b.rohe - a.rohe);

    const taskEntries = Object.entries(metrics.byTask)
      .map(([task, data]) => ({
        task,
        ...data,
      }))
      .sort((a, b) => b.rohe - a.rohe);

    return {
      robotEntries,
      taskEntries,
      topRobots: robotEntries.slice(0, 5),
      topTasks: taskEntries.slice(0, 5),
    };
  }, [metrics]);

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
  if (!metrics || !processedData) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700',
          className
        )}
      >
        <TrendingUp className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-gray-500 dark:text-gray-400">No ROHE metrics available</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Interventions</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {metrics.totalInterventions.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Performance Gain</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                +{(metrics.performanceImprovement * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Target className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">ROHE Score</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {metrics.improvementPerIntervention.toFixed(3)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
              <Bot className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Active Robots</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {Object.keys(metrics.byRobot).length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Robot */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Bot className="w-4 h-4" />
              ROHE by Robot
            </h3>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {processedData.topRobots.map((robot, index) => (
              <div
                key={robot.id}
                className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400 w-6">
                    #{index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {robot.id.slice(0, 12)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {robot.interventions} interventions
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {robot.rohe.toFixed(4)}
                  </p>
                  <p
                    className={cn(
                      'text-xs flex items-center justify-end gap-0.5',
                      robot.improvement > 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {robot.improvement > 0 ? (
                      <ArrowUpRight className="w-3 h-3" />
                    ) : (
                      <ArrowDownRight className="w-3 h-3" />
                    )}
                    {(robot.improvement * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            ))}
            {processedData.robotEntries.length === 0 && (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                No robot data available
              </div>
            )}
          </div>
        </div>

        {/* By Task */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Target className="w-4 h-4" />
              ROHE by Task
            </h3>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {processedData.topTasks.map((task, index) => (
              <div
                key={task.task}
                className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400 w-6">
                    #{index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {task.task}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {task.interventions} interventions
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {task.rohe.toFixed(4)}
                  </p>
                  <p
                    className={cn(
                      'text-xs flex items-center justify-end gap-0.5',
                      task.improvement > 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {task.improvement > 0 ? (
                      <ArrowUpRight className="w-3 h-3" />
                    ) : (
                      <ArrowDownRight className="w-3 h-3" />
                    )}
                    {(task.improvement * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            ))}
            {processedData.taskEntries.length === 0 && (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                No task data available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Period indicator */}
      <div className="text-center text-sm text-gray-500 dark:text-gray-400">
        Data from {new Date(metrics.period.start).toLocaleDateString()} to{' '}
        {new Date(metrics.period.end).toLocaleDateString()}
      </div>
    </div>
  );
}
