/**
 * @file CapabilitiesSummary.tsx
 * @description Display robot capabilities per EU AI Act Art. 14(4)(a)
 * @feature oversight
 */

import { CheckCircle, XCircle, AlertTriangle, Bot, Cpu, Battery, Thermometer } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Badge } from '@/shared/components/ui/Badge';
import type { RobotCapabilitiesSummary as CapabilitiesData, RobotCapability } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface CapabilitiesSummaryProps {
  capabilities: CapabilitiesData | null;
  isLoading?: boolean;
  className?: string;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface CapabilityItemProps {
  capability: RobotCapability;
}

function CapabilityItem({ capability }: CapabilityItemProps) {
  return (
    <div className="flex items-start gap-3 py-2">
      {capability.isAvailable ? (
        <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-theme-primary">
            {capability.name}
          </span>
          {capability.confidenceLevel !== undefined && (
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                capability.confidenceLevel >= 80
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : capability.confidenceLevel >= 50
                    ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                    : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
              )}
            >
              {capability.confidenceLevel}%
            </span>
          )}
        </div>
        <p className="text-xs text-theme-muted mt-0.5">
          {capability.description}
        </p>
        {capability.limitations && capability.limitations.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {capability.limitations.map((limitation, i) => (
              <span
                key={i}
                className="text-xs px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded"
              >
                {limitation}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface MetricGaugeProps {
  label: string;
  value: number | null;
  max?: number;
  unit?: string;
  icon: typeof Battery;
  warningThreshold?: number;
  criticalThreshold?: number;
}

function MetricGauge({
  label,
  value,
  max = 100,
  unit = '%',
  icon: Icon,
  warningThreshold = 30,
  criticalThreshold = 15,
}: MetricGaugeProps) {
  const percentage = value !== null ? (value / max) * 100 : 0;
  const isCritical = value !== null && value <= criticalThreshold;
  const isWarning = value !== null && value <= warningThreshold;

  return (
    <div className="flex items-center gap-3">
      <Icon
        className={cn(
          'h-4 w-4',
          isCritical ? 'text-red-500' : isWarning ? 'text-yellow-500' : 'text-theme-muted'
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-theme-muted">{label}</span>
          <span
            className={cn(
              'font-medium',
              isCritical
                ? 'text-red-500'
                : isWarning
                  ? 'text-yellow-500'
                  : 'text-theme-secondary'
            )}
          >
            {value !== null ? `${value}${unit}` : 'N/A'}
          </span>
        </div>
        <div className="h-1.5 bg-theme-subtle rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-green-500'
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export function CapabilitiesSummary({
  capabilities,
  isLoading,
  className,
}: CapabilitiesSummaryProps) {
  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="h-6 w-32 bg-theme-elevated rounded animate-pulse" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-theme-elevated rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!capabilities) {
    return (
      <div className={cn('text-center py-8', className)}>
        <Bot className="h-12 w-12 text-theme-muted mx-auto mb-3" />
        <p className="text-theme-secondary">Select a robot to view capabilities</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-theme-muted" />
            <h3 className="font-semibold text-theme-primary">
              {capabilities.robotName}
            </h3>
          </div>
          <p className="text-sm text-theme-muted mt-1">
            {capabilities.model} {capabilities.firmware && `(v${capabilities.firmware})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              capabilities.status === 'online'
                ? 'success'
                : capabilities.status === 'offline'
                  ? 'error'
                  : 'default'
            }
          >
            {capabilities.status}
          </Badge>
          {capabilities.isInManualMode && (
            <Badge variant="warning">Manual Mode</Badge>
          )}
        </div>
      </div>

      {/* System Metrics */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-theme-secondary">System Health</h4>
        <div className="grid gap-3">
          <MetricGauge
            label="Battery"
            value={capabilities.batteryLevel}
            icon={Battery}
            warningThreshold={30}
            criticalThreshold={10}
          />
          <MetricGauge
            label="CPU Usage"
            value={capabilities.cpuUsage}
            icon={Cpu}
            warningThreshold={80}
            criticalThreshold={95}
          />
          <MetricGauge
            label="Temperature"
            value={capabilities.temperature}
            max={100}
            unit="°C"
            icon={Thermometer}
            warningThreshold={70}
            criticalThreshold={85}
          />
        </div>
      </div>

      {/* AI Confidence */}
      {(capabilities.overallConfidence !== null ||
        capabilities.recentDecisionAccuracy !== null) && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-theme-secondary">AI Metrics</h4>
          <div className="grid grid-cols-2 gap-4 p-3 bg-theme-elevated rounded-lg">
            <div>
              <p className="text-xs text-theme-muted">Overall Confidence</p>
              <p
                className={cn(
                  'text-lg font-semibold',
                  (capabilities.overallConfidence ?? 0) >= 80
                    ? 'text-green-500'
                    : (capabilities.overallConfidence ?? 0) >= 60
                      ? 'text-yellow-500'
                      : 'text-red-500'
                )}
              >
                {capabilities.overallConfidence !== null
                  ? `${capabilities.overallConfidence}%`
                  : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-xs text-theme-muted">Decision Accuracy</p>
              <p
                className={cn(
                  'text-lg font-semibold',
                  (capabilities.recentDecisionAccuracy ?? 0) >= 90
                    ? 'text-green-500'
                    : (capabilities.recentDecisionAccuracy ?? 0) >= 70
                      ? 'text-yellow-500'
                      : 'text-red-500'
                )}
              >
                {capabilities.recentDecisionAccuracy !== null
                  ? `${capabilities.recentDecisionAccuracy}%`
                  : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Capabilities */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-theme-secondary">
          Capabilities
          <span className="text-xs font-normal text-theme-muted ml-2">
            (Art. 14(4)(a))
          </span>
        </h4>
        <div className="divide-y divide-theme-subtle">
          {capabilities.capabilities.map((cap, i) => (
            <CapabilityItem key={i} capability={cap} />
          ))}
        </div>
      </div>

      {/* Active Anomalies */}
      {capabilities.activeAnomalies.length > 0 && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400 mb-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium text-sm">
              {capabilities.activeAnomalies.length} Active Anomal
              {capabilities.activeAnomalies.length === 1 ? 'y' : 'ies'}
            </span>
          </div>
          <ul className="text-sm text-red-600 dark:text-red-300 space-y-1">
            {capabilities.activeAnomalies.slice(0, 3).map((a) => (
              <li key={a.id}>• {a.description}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
